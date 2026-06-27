import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createObjectCsvWriter } = require('csv-writer');
import { ScreenshotMetadata } from '../types';
import { ensureDir } from '../utils/helpers';
import { logger } from '../logger';

export class MetadataStore {
  private records: ScreenshotMetadata[] = [];
  private metadataDir: string;
  private flushInterval: number;
  private lastFlushCount = 0;

  constructor(metadataDir: string, flushInterval = 100) {
    this.metadataDir = metadataDir;
    this.flushInterval = flushInterval;
    ensureDir(metadataDir);
  }

  add(record: ScreenshotMetadata): void {
    this.records.push(record);
    if (this.records.length - this.lastFlushCount >= this.flushInterval) {
      this.flushToDisk().catch((e) => logger.error(`Metadata flush error: ${e}`));
      this.lastFlushCount = this.records.length;
    }
  }

  addBatch(records: ScreenshotMetadata[]): void {
    records.forEach((r) => this.add(r));
  }

  async flushToDisk(): Promise<void> {
    await this.writeJson();
    await this.writeCsv();
  }

  async finalFlush(): Promise<void> {
    logger.info(`Flushing ${this.records.length} metadata records to disk...`);
    await this.flushToDisk();
  }

  private async writeJson(): Promise<void> {
    const filePath = path.join(this.metadataDir, 'metadata.json');
    try {
      // Write as JSON Lines (one record per line) for streaming reads
      const lines = this.records.map((r) => JSON.stringify(r)).join('\n');
      fs.writeFileSync(filePath, lines, 'utf8');
    } catch (err) {
      logger.error(`Failed to write metadata JSON: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async writeCsv(): Promise<void> {
    const filePath = path.join(this.metadataDir, 'metadata.csv');
    if (this.records.length === 0) return;

    try {
      const writer = createObjectCsvWriter({
        path: filePath,
        header: [
          { id: 'id', title: 'id' },
          { id: 'url', title: 'url' },
          { id: 'finalUrl', title: 'final_url' },
          { id: 'label', title: 'label' },
          { id: 'labelName', title: 'label_name' },
          { id: 'brand', title: 'brand' },
          { id: 'brandNormalized', title: 'brand_normalized' },
          { id: 'pageType', title: 'page_type' },
          { id: 'screenshotType', title: 'screenshot_type' },
          { id: 'relativePath', title: 'relative_path' },
          { id: 'title', title: 'title' },
          { id: 'timestamp', title: 'timestamp' },
          { id: 'viewportWidth', title: 'viewport_width' },
          { id: 'viewportHeight', title: 'viewport_height' },
          { id: 'statusCode', title: 'status_code' },
          { id: 'redirectCount', title: 'redirect_count' },
          { id: 'pageLoadTimeMs', title: 'page_load_time_ms' },
          { id: 'fileSizeBytes', title: 'file_size_bytes' },
          { id: 'imageWidth', title: 'image_width' },
          { id: 'imageHeight', title: 'image_height' },
          { id: 'imageHash', title: 'image_hash' },
          { id: 'isBlank', title: 'is_blank' },
          { id: 'isCaptcha', title: 'is_captcha' },
          { id: 'isErrorPage', title: 'is_error_page' },
          { id: 'source', title: 'source' },
        ],
        append: false,
      });

      await writer.writeRecords(this.records);
    } catch (err) {
      logger.error(`Failed to write metadata CSV: ${err instanceof Error ? err.message : err}`);
    }
  }

  getRecords(): ScreenshotMetadata[] {
    return [...this.records];
  }

  getCount(): number {
    return this.records.length;
  }
}
