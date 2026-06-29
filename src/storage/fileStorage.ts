// ─────────────────────────────────────────────────────────────────────────────
//  File storage helpers
//
//  New folder layout (one screenshot per page type, no hash subdirectory):
//
//    dataset/
//      legitimate/
//        amazon/
//          homepage.png
//          login.png
//          signup.png
//      phishing/
//        paypal/
//          homepage.png
//          login.png
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import { FailedUrlEntry } from '../types';
import { createObjectCsvWriter } from 'csv-writer';
import { ensureDir } from '../utils/helpers';
import { logger } from '../logger';

export class FileStorage {
  private logsDir: string;
  private failedUrls: FailedUrlEntry[] = [];
  private flushInterval: number;
  private lastFlushCount = 0;

  constructor(logsDir: string, flushInterval = 50) {
    this.logsDir = logsDir;
    this.flushInterval = flushInterval;
    ensureDir(logsDir);
  }

  logFailedUrl(entry: FailedUrlEntry): void {
    this.failedUrls.push(entry);
    if (this.failedUrls.length - this.lastFlushCount >= this.flushInterval) {
      this.flushFailedUrls().catch((e) => logger.error(`Failed URL flush error: ${e}`));
      this.lastFlushCount = this.failedUrls.length;
    }
  }

  async flushFailedUrls(): Promise<void> {
    if (this.failedUrls.length === 0) return;

    const filePath = path.join(this.logsDir, 'failed_urls.csv');
    try {
      const writer = createObjectCsvWriter({
        path: filePath,
        header: [
          { id: 'url',          title: 'url' },
          { id: 'label',        title: 'label' },
          { id: 'reason',       title: 'reason' },
          { id: 'statusCode',   title: 'status_code' },
          { id: 'errorMessage', title: 'error_message' },
          { id: 'timestamp',    title: 'timestamp' },
          { id: 'attempt',      title: 'attempt' },
        ],
        append: false,
      });
      await writer.writeRecords(this.failedUrls);
    } catch (err) {
      logger.error(`Failed to write failed_urls.csv: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Create top-level label directories. */
  ensureOutputDirs(baseDir: string): void {
    ensureDir(path.join(baseDir, 'legitimate'));
    ensureDir(path.join(baseDir, 'phishing'));
  }

  /**
   * Return (and create) the brand directory for a given label + normalised brand name.
   * Path: `{outputDir}/legitimate|phishing/{brandNormalized}/`
   */
  buildBrandDir(
    outputDir: string,
    label: 0 | 1,
    brandNormalized: string,
  ): string {
    const category = label === 0 ? 'legitimate' : 'phishing';
    const dir = path.join(outputDir, category, brandNormalized);
    ensureDir(dir);
    return dir;
  }

  /**
   * Return the full file path for a single page-type screenshot.
   * Path: `{outputDir}/legitimate|phishing/{brand}/{pageType}.png`
   *
   * The directory is created automatically; the file itself is NOT created.
   */
  buildScreenshotFilePath(
    outputDir: string,
    label: 0 | 1,
    brandNormalized: string,
    pageType: string,
  ): string {
    const dir = this.buildBrandDir(outputDir, label, brandNormalized);
    return path.join(dir, `${pageType}.png`);
  }

  getFailedCount(): number {
    return this.failedUrls.length;
  }
}
