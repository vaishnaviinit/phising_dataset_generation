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
          { id: 'url', title: 'url' },
          { id: 'label', title: 'label' },
          { id: 'reason', title: 'reason' },
          { id: 'statusCode', title: 'status_code' },
          { id: 'errorMessage', title: 'error_message' },
          { id: 'timestamp', title: 'timestamp' },
          { id: 'attempt', title: 'attempt' },
        ],
        append: false,
      });
      await writer.writeRecords(this.failedUrls);
    } catch (err) {
      logger.error(`Failed to write failed_urls.csv: ${err instanceof Error ? err.message : err}`);
    }
  }

  ensureOutputDirs(baseDir: string): void {
    const dirs = [
      path.join(baseDir, 'legitimate'),
      path.join(baseDir, 'phishing'),
    ];
    for (const dir of dirs) {
      ensureDir(dir);
    }
  }

  buildScreenshotPath(
    outputDir: string,
    label: 0 | 1,
    brandNormalized: string,
    pageType: string,
    urlHash: string,
  ): string {
    const category = label === 0 ? 'legitimate' : 'phishing';
    const dir = path.join(outputDir, category, brandNormalized, pageType, urlHash);
    ensureDir(dir);
    return dir;
  }

  getFailedCount(): number {
    return this.failedUrls.length;
  }
}
