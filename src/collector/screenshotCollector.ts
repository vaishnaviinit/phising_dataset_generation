// ─────────────────────────────────────────────────────────────────────────────
//  Screenshot collector — memory-optimised, page-diversity strategy
//
//  Memory model (8 GB machine):
//    • ONE browser process per worker   (BrowserPool — never re-launched)
//    • ONE BrowserContext per URL       (fresh cookies/storage, clean isolation)
//    • ONE Page open at any time       (homepage page closed before sub-pages)
//    • Pages are closed immediately after each screenshot
//    • Context is closed after all pages for a URL are done → full GC
//
//  Per URL the collector:
//    1. Opens a fresh context, creates one Page → homepage.
//    2. Captures ONE desktop screenshot → `{brand}/homepage.png`
//    3. Discovers secondary pages (login, signup, checkout, …).
//    4. Closes the homepage Page (frees ~30 MB renderer memory).
//    5. For each discovered page: open Page → navigate → capture → close Page.
//    6. Closes the context (cookies + cache released).
//
//  Duplicate guards (three layers):
//    • File guard  — file already exists on disk → skip (resume-safe).
//    • URL guard   — final URL after redirects already visited → skip.
//    • Hash guard  — dHash Hamming distance ≤ 5 → delete + skip.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import { BrowserContext, Page } from 'playwright';
import { Config } from '../config';
import { QueueItem, ProcessResult, FailureReason, PageType } from '../types';
import { BrowserPool } from '../browser/browserPool';
import { PageNavigator } from '../playwright/pageNavigator';
import { ScreenshotCapture } from '../playwright/screenshotCapture';
import { PageDiscovery, identifyPageType } from '../playwright/pageDiscovery';
import { BrandDetector } from '../brand/brandDetector';
import { QualityChecker } from '../image/qualityChecker';
import { hammingDistance } from '../image/duplicateDetector';
import { MetadataGenerator, GenerateInput } from '../metadata/metadataGenerator';
import { MetadataStore } from '../metadata/metadataStore';
import { FileStorage } from '../storage/fileStorage';
import { CheckpointManager } from './checkpointManager';
import { RetryManager } from '../retry/retryManager';
import { ProgressTracker } from '../utils/progress';
import { applyStealthToPage } from '../playwright/antiDetection';

/** Maximum Hamming distance to consider two page screenshots as duplicates. */
const HASH_DISTANCE_THRESHOLD = 5;

export class ScreenshotCollector {
  private config: Config;
  private browserPool: BrowserPool;
  private navigator: PageNavigator;
  private capture: ScreenshotCapture;
  private discovery: PageDiscovery;
  private brandDetector: BrandDetector;
  private qualityChecker: QualityChecker;
  private metaGenerator: MetadataGenerator;
  private metaStore: MetadataStore;
  private fileStorage: FileStorage;
  private checkpoint: CheckpointManager;
  private retry: RetryManager;

  constructor(
    config: Config,
    browserPool: BrowserPool,
    metaStore: MetadataStore,
    fileStorage: FileStorage,
    checkpoint: CheckpointManager,
  ) {
    this.config = config;
    this.browserPool = browserPool;
    this.metaStore = metaStore;
    this.fileStorage = fileStorage;
    this.checkpoint = checkpoint;

    this.navigator = new PageNavigator(
      config.pageTimeoutMs,
      config.networkIdleTimeoutMs,
      config.antiDetection,
    );

    this.capture = new ScreenshotCapture(config.screenshotTimeoutMs);

    this.discovery = new PageDiscovery(
      config.pageDiscovery,
      config.maxSubPagesPerUrl,
    );

    this.brandDetector = new BrandDetector();
    this.qualityChecker = new QualityChecker(config.quality);
    this.metaGenerator = new MetadataGenerator(config.outputDir);

    this.retry = new RetryManager({
      maxRetries: config.maxRetries,
      baseDelayMs: config.retryDelayMs,
    });
  }

  // ── Public entry point ────────────────────────────────────────────────────

  async processItem(
    item: QueueItem,
    workerIndex: number,
    progress: ProgressTracker,
  ): Promise<ProcessResult> {
    const startMs = Date.now();

    if (this.checkpoint.isProcessed(item.url)) {
      progress.update({ skipped: 1, currentUrl: item.url });
      return { success: true, url: item.url, screenshots: [], durationMs: 0 };
    }

    progress.update({ currentUrl: item.url });

    const { result, error } = await this.retry.execute(
      () => this.collectScreenshots(item, workerIndex),
      item.url,
    );

    const durationMs = Date.now() - startMs;

    if (result) {
      this.checkpoint.markSuccess(item.url, result.screenshots.length);
      progress.update({
        succeeded: 1,
        screenshots: result.screenshots.length,
        currentUrl: item.url,
      });
      return { ...result, durationMs };
    }

    const reason = error?.reason ?? 'unknown';
    this.checkpoint.markFailed(item.url);
    this.fileStorage.logFailedUrl({
      url: item.url,
      label: item.label,
      reason: reason as FailureReason,
      errorMessage: error?.message ?? 'unknown',
      timestamp: new Date().toISOString(),
      attempt: this.config.maxRetries + 1,
    });

    progress.update({ failed: 1, currentUrl: item.url });
    return {
      success: false,
      url: item.url,
      screenshots: [],
      failureReason: reason as FailureReason,
      errorMessage: error?.message,
      durationMs,
    };
  }

  // ── Core collection logic ─────────────────────────────────────────────────

  private async collectScreenshots(
    item: QueueItem,
    workerIndex: number,
  ): Promise<ProcessResult> {
    // ONE context per URL.  All pages for this URL live in this context.
    // Closing the context at the end releases cookies, cache, and all pages.
    let ctx: BrowserContext | null = null;

    try {
      ctx = await this.browserPool.createContext(workerIndex, false);

      // ── 1. Homepage ───────────────────────────────────────────────────────
      const nav = await this.navigateFresh(ctx, item.url);

      if (nav.isErrorPage) {
        const code = nav.nav.statusCode;
        const reason: FailureReason =
          code === 404 ? 'http_error' : code === 0 ? 'network_error' : 'http_error';
        throw Object.assign(new Error(`Error page: HTTP ${code}`), { reason });
      }
      if (nav.nav.isCaptcha) {
        throw Object.assign(new Error('CAPTCHA detected'), { reason: 'captcha' });
      }
      if (nav.nav.isParkedDomain) {
        throw Object.assign(new Error('Parked domain'), { reason: 'blank_page' });
      }

      // ── 2. Brand detection ────────────────────────────────────────────────
      const brand = this.brandDetector.detect(item.url, nav.nav, item.label);
      const pageType = identifyPageType(nav.nav.finalUrl, nav.nav.pageTitle) as PageType;

      const visitedFinalUrls = new Set<string>([nav.nav.finalUrl]);
      const capturedHashes: string[] = [];
      const allMetas: ReturnType<MetadataGenerator['generate']>[] = [];

      // ── 3. Capture homepage ───────────────────────────────────────────────
      const homepagePath = this.fileStorage.buildScreenshotFilePath(
        this.config.outputDir, item.label, brand.normalizedName, 'homepage',
      );

      if (!fs.existsSync(homepagePath)) {
        const raw = await this.capture.captureDesktop(nav.page, homepagePath);
        if (raw) {
          const validated = await this.qualityChecker.validate(raw);
          if (!validated || validated.isBlank) {
            if (fs.existsSync(homepagePath)) fs.unlinkSync(homepagePath);
            throw Object.assign(
              new Error('Homepage quality check failed'),
              { reason: 'image_quality' },
            );
          }
          capturedHashes.push(validated.hash);
          allMetas.push(this.metaGenerator.generate({
            item, navResult: nav.nav, brand, pageType, screenshot: validated,
            outputDir: this.config.outputDir,
          }));
        }
      }

      // ── 4. Discover secondary pages (while homepage is still loaded) ───────
      const discoveredPages = await this.discovery.discoverPages(
        nav.page, item.url, visitedFinalUrls,
      );

      // Close homepage page NOW — frees ~30 MB renderer memory before sub-pages
      await nav.page.close().catch(() => {});

      // ── 5. Capture sub-pages (new Page per sub-page, same Context) ─────────
      for (const discovered of discoveredPages) {
        const subPath = this.fileStorage.buildScreenshotFilePath(
          this.config.outputDir, item.label, brand.normalizedName, discovered.pageType,
        );

        // File guard: page type already captured for this brand (resume-safe)
        if (fs.existsSync(subPath)) continue;

        // Open a new Page in the SAME context (no new browser process spawned)
        const subPage = await ctx.newPage().catch(() => null as Page | null);
        if (!subPage) continue;

        try {
          if (this.config.antiDetection) await applyStealthToPage(subPage);

          const subNav = await this.navigator.navigate(subPage, discovered.url);

          // Skip broken / bot-protected / parked sub-pages (non-fatal)
          if (subNav.isErrorPage || subNav.isCaptcha || subNav.isParkedDomain) continue;

          // URL guard: redirect landed on a page we already captured
          if (visitedFinalUrls.has(subNav.finalUrl)) continue;
          visitedFinalUrls.add(subNav.finalUrl);

          const raw = await this.capture.captureDesktop(subPage, subPath);
          if (!raw) continue;

          const validated = await this.qualityChecker.validate(raw);
          if (!validated || validated.isBlank) {
            if (fs.existsSync(subPath)) fs.unlinkSync(subPath);
            continue;
          }

          // Hash guard: visually identical to a page already captured this session
          if (capturedHashes.some((h) => hammingDistance(h, validated.hash) <= HASH_DISTANCE_THRESHOLD)) {
            fs.unlinkSync(subPath);
            continue;
          }
          capturedHashes.push(validated.hash);

          allMetas.push(this.metaGenerator.generate({
            item: { ...item, url: discovered.url, attemptNumber: 0 },
            navResult: subNav,
            brand,
            pageType: discovered.pageType,
            screenshot: validated,
            outputDir: this.config.outputDir,
          }));
        } catch {
          // Sub-page failures are intentionally non-fatal
          if (fs.existsSync(subPath)) {
            try { fs.unlinkSync(subPath); } catch { /* ignore */ }
          }
        } finally {
          // Close Page immediately — gives back renderer memory before next page
          await subPage.close().catch(() => {});
        }
      }

      this.metaStore.addBatch(allMetas);
      return { success: true, url: item.url, screenshots: allMetas, durationMs: 0 };

    } finally {
      // Closing the context releases all pages, cookies, JS heap, and cache
      await ctx?.close().catch(() => {});
    }
  }

  // ── Helper: open a page, apply stealth, navigate ──────────────────────────

  private async navigateFresh(
    ctx: BrowserContext,
    url: string,
  ): Promise<{ page: Page; nav: Awaited<ReturnType<PageNavigator['navigate']>>; isErrorPage: boolean }> {
    const page = await ctx.newPage();
    if (this.config.antiDetection) await applyStealthToPage(page);
    const nav = await this.navigator.navigate(page, url);
    return { page, nav, isErrorPage: nav.isErrorPage };
  }
}
