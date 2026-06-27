import { BrowserContext } from 'playwright';
import { Config } from '../config';
import { QueueItem, ProcessResult, FailureReason, DiscoveredPage, PageType } from '../types';
import { BrowserPool } from '../browser/browserPool';
import { PageNavigator } from '../playwright/pageNavigator';
import { ScreenshotCapture } from '../playwright/screenshotCapture';
import { PageDiscovery, identifyPageType } from '../playwright/pageDiscovery';
import { BrandDetector } from '../brand/brandDetector';
import { QualityChecker } from '../image/qualityChecker';
import { MetadataGenerator, GenerateInput } from '../metadata/metadataGenerator';
import { MetadataStore } from '../metadata/metadataStore';
import { FileStorage } from '../storage/fileStorage';
import { CheckpointManager } from './checkpointManager';
import { RetryManager } from '../retry/retryManager';
import { ProgressTracker } from '../utils/progress';
import { shortHash } from '../utils/helpers';
import { applyStealthToPage } from '../playwright/antiDetection';

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

    this.capture = new ScreenshotCapture({
      outputDir: config.outputDir,
      types: config.screenshotTypes,
      timeoutMs: config.screenshotTimeoutMs,
    });

    this.discovery = new PageDiscovery(4);
    this.brandDetector = new BrandDetector();
    this.qualityChecker = new QualityChecker(config.quality);
    this.metaGenerator = new MetadataGenerator(config.outputDir);

    this.retry = new RetryManager({
      maxRetries: config.maxRetries,
      baseDelayMs: config.retryDelayMs,
    });
  }

  /** Process a single URL item — the unit of work for each worker task. */
  async processItem(
    item: QueueItem,
    workerIndex: number,
    progress: ProgressTracker,
  ): Promise<ProcessResult> {
    const startMs = Date.now();

    // Skip already processed
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

    // Record failure
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

  private async collectScreenshots(
    item: QueueItem,
    workerIndex: number,
  ): Promise<ProcessResult> {
    const urlHash = shortHash(item.url);

    // Create desktop and mobile contexts
    let desktopCtx: BrowserContext | null = null;
    let mobileCtx: BrowserContext | null = null;

    try {
      desktopCtx = await this.browserPool.createContext(workerIndex, false);
      mobileCtx = await this.browserPool.createContext(workerIndex, true);

      const desktopPage = await desktopCtx.newPage();
      const mobilePage = await mobileCtx.newPage();

      if (this.config.antiDetection) {
        await applyStealthToPage(desktopPage);
        await applyStealthToPage(mobilePage);
      }

      // Navigate both pages concurrently
      const [desktopNav] = await Promise.all([
        this.navigator.navigate(desktopPage, item.url),
        this.navigator.navigate(mobilePage, item.url),
      ]);

      // Reject error / captcha / parked pages
      if (desktopNav.isErrorPage) {
        const code = desktopNav.statusCode;
        const reason: FailureReason = code === 404 ? 'http_error' : code === 0 ? 'network_error' : 'http_error';
        throw Object.assign(new Error(`Error page: HTTP ${code}`), { reason });
      }
      if (desktopNav.isCaptcha) {
        throw Object.assign(new Error('CAPTCHA detected'), { reason: 'captcha' });
      }
      if (desktopNav.isParkedDomain) {
        throw Object.assign(new Error('Parked domain'), { reason: 'blank_page' });
      }

      // Detect brand and page type
      const brand = this.brandDetector.detect(item.url, desktopNav, item.label);
      const pageType = identifyPageType(desktopNav.finalUrl, desktopNav.pageTitle) as PageType;

      // Build screenshot directory
      const screenshotDir = this.fileStorage.buildScreenshotPath(
        this.config.outputDir,
        item.label,
        brand.normalizedName,
        pageType,
        urlHash,
      );

      // Capture screenshots
      const rawScreenshots = await this.capture.captureAll(desktopPage, mobilePage, screenshotDir);

      // Quality check
      const validScreenshots = await this.qualityChecker.validateAll(rawScreenshots);

      if (validScreenshots.length === 0) {
        throw Object.assign(new Error('All screenshots failed quality check'), {
          reason: 'image_quality',
        });
      }

      // Generate and store metadata for each screenshot
      const metadataEntries = validScreenshots.map((ss) => {
        const input: GenerateInput = {
          item,
          navResult: desktopNav,
          brand,
          pageType,
          screenshot: ss,
          outputDir: this.config.outputDir,
        };
        return this.metaGenerator.generate(input);
      });
      this.metaStore.addBatch(metadataEntries);

      // Discover sub-pages only for legitimate sites (phishing usually one-pagers)
      if (item.label === 0) {
        const discoveredPages = await this.discovery.discoverPages(desktopPage, item.url);
        await this.captureDiscoveredPages(
          item,
          workerIndex,
          discoveredPages,
          brand,
        );
      }

      return {
        success: true,
        url: item.url,
        screenshots: metadataEntries,
        durationMs: 0,
      };
    } finally {
      await desktopCtx?.close().catch(() => {});
      await mobileCtx?.close().catch(() => {});
    }
  }

  private async captureDiscoveredPages(
    item: QueueItem,
    workerIndex: number,
    pages: DiscoveredPage[],
    brand: ReturnType<BrandDetector['detect']>,
  ): Promise<void> {
    for (const discovered of pages.slice(0, 3)) {
      let ctx: BrowserContext | null = null;
      try {
        ctx = await this.browserPool.createContext(workerIndex, false);
        const page = await ctx.newPage();
        if (this.config.antiDetection) await applyStealthToPage(page);

        const nav = await this.navigator.navigate(page, discovered.url);
        if (nav.isErrorPage || nav.isCaptcha) continue;

        const pageHash = shortHash(discovered.url);
        const screenshotDir = this.fileStorage.buildScreenshotPath(
          this.config.outputDir,
          item.label,
          brand.normalizedName,
          discovered.pageType,
          pageHash,
        );

        // Only desktop page for discovered sub-pages
        const dummyMobilePage = page; // reuse same page (only desktop types captured)
        const captureTypes = this.config.screenshotTypes.filter(
          (t) => t === 'desktop' || t === 'fullpage' || t === 'above_fold',
        );
        const captureTool = new ScreenshotCapture({
          outputDir: this.config.outputDir,
          types: captureTypes,
          timeoutMs: this.config.screenshotTimeoutMs,
        });

        const raws = await captureTool.captureAll(page, dummyMobilePage, screenshotDir);
        const valid = await this.qualityChecker.validateAll(raws);

        const subItem: QueueItem = {
          ...item,
          url: discovered.url,
          attemptNumber: 0,
        };

        const metas = valid.map((ss) =>
          this.metaGenerator.generate({
            item: subItem,
            navResult: nav,
            brand,
            pageType: discovered.pageType,
            screenshot: ss,
            outputDir: this.config.outputDir,
          }),
        );
        this.metaStore.addBatch(metas);
      } catch {
        // Sub-page failures are non-fatal
      } finally {
        await ctx?.close().catch(() => {});
      }
    }
  }
}
