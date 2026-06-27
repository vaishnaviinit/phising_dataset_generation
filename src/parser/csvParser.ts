import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse';
import { createObjectCsvWriter } from 'csv-writer';
import { CsvRow, Label, QueueItem, UrlFeatures, InvalidUrlEntry } from '../types';
import { validateUrl, buildInvalidEntry } from './urlValidator';
import { normalizeUrl, ensureDir } from '../utils/helpers';
import { logger } from '../logger';

export interface ParseResult {
  items: QueueItem[];
  invalidCount: number;
  duplicateCount: number;
  totalRows: number;
}

export class CsvParser {
  private logsDir: string;

  constructor(logsDir: string) {
    this.logsDir = logsDir;
    ensureDir(logsDir);
  }

  async parse(csvPath: string, options: { maxUrls?: number; labelFilter?: number } = {}): Promise<ParseResult> {
    logger.info(`Parsing CSV: ${csvPath}`);

    const invalidEntries: InvalidUrlEntry[] = [];
    const seen = new Set<string>();
    const items: QueueItem[] = [];

    let rowNumber = 0;
    let duplicateCount = 0;

    await new Promise<void>((resolve, reject) => {
      const stream = fs.createReadStream(csvPath, { encoding: 'utf8' });
      const parser = parse({ columns: true, skip_empty_lines: true, trim: true });

      stream.pipe(parser);

      parser.on('data', (raw: Record<string, string>) => {
        rowNumber++;

        const rawUrl = raw['url'] ?? '';
        const rawLabel = raw['label'] ?? '';

        // Validate URL
        const validation = validateUrl(rawUrl, rowNumber);
        if (!validation.valid) {
          invalidEntries.push(buildInvalidEntry(rawUrl, validation.reason!, rowNumber));
          return;
        }

        // Parse label
        const labelNum = parseInt(rawLabel, 10);
        if (labelNum !== 0 && labelNum !== 1) {
          invalidEntries.push(buildInvalidEntry(rawUrl, 'invalid_label', rowNumber));
          return;
        }

        const label = labelNum as Label;

        // Apply label filter
        if (options.labelFilter !== undefined && options.labelFilter !== -1) {
          if (label !== options.labelFilter) return;
        }

        // Apply max URL limit BEFORE processing (fixes stream-buffering overshoot)
        if (options.maxUrls && items.length >= options.maxUrls) {
          if (!stream.destroyed) stream.destroy();
          return;
        }

        // Normalize and dedup
        const normalized = normalizeUrl(rawUrl);
        if (seen.has(normalized)) {
          duplicateCount++;
          return;
        }
        seen.add(normalized);

        // Extract URL features (everything except url and label)
        const urlFeatures: UrlFeatures = {};
        for (const [k, v] of Object.entries(raw)) {
          if (k !== 'url' && k !== 'label' && v !== '') {
            const num = parseFloat(v);
            urlFeatures[k] = isNaN(num) ? v : num;
          }
        }

        items.push({
          url: normalized,
          label,
          urlFeatures,
          source: 'csv',
          attemptNumber: 0,
        });
      });

      parser.on('end', resolve);
      parser.on('error', reject);
      stream.on('error', reject);
      stream.on('close', resolve);
    });

    // Write invalid URLs log
    if (invalidEntries.length > 0) {
      await this.writeInvalidLog(invalidEntries);
    }

    logger.info(
      `Parsed ${items.length} valid URLs | ${invalidEntries.length} invalid | ${duplicateCount} duplicates`,
    );

    return {
      items,
      invalidCount: invalidEntries.length,
      duplicateCount,
      totalRows: rowNumber,
    };
  }

  private async writeInvalidLog(entries: InvalidUrlEntry[]): Promise<void> {
    const filePath = path.join(this.logsDir, 'invalid_urls.csv');
    const writer = createObjectCsvWriter({
      path: filePath,
      header: [
        { id: 'rowNumber', title: 'row_number' },
        { id: 'originalUrl', title: 'url' },
        { id: 'reason', title: 'reason' },
        { id: 'rawValue', title: 'raw_value' },
      ],
      append: false,
    });
    await writer.writeRecords(entries);
    logger.info(`Invalid URLs written to ${filePath}`);
  }
}
