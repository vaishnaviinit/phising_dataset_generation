import * as fs from 'fs';
import * as path from 'path';
import { createObjectCsvWriter } from 'csv-writer';
import { ScreenshotMetadata, DatasetSplit } from '../types';
import { shuffleArray, ensureDir } from '../utils/helpers';
import { logger } from '../logger';

export interface SplitConfig {
  train: number;
  validation: number;
  test: number;
}

export class DatasetSplitter {
  private config: SplitConfig;
  private outputDir: string;

  constructor(config: SplitConfig, outputDir: string) {
    this.config = config;
    this.outputDir = outputDir;
  }

  /**
   * Split screenshots into train/validation/test.
   * Stratifies by brand+label to ensure diversity.
   * Prevents duplicate leakage by grouping by URL hash before splitting.
   */
  split(screenshots: ScreenshotMetadata[]): DatasetSplit {
    // Group by URL so the same URL never appears in multiple splits
    const byUrl = new Map<string, ScreenshotMetadata[]>();
    for (const s of screenshots) {
      const existing = byUrl.get(s.url) ?? [];
      existing.push(s);
      byUrl.set(s.url, existing);
    }

    // Collect all URL groups, shuffle globally, then split.
    // Per-brand stratification breaks on single-URL groups because
    // floor(1 * 0.7) = 0 and floor(1 * 0.15) = 0, pushing all
    // single-URL brands entirely into the test set.
    const allUrlGroups = shuffleArray(Array.from(byUrl.values()));
    const total = allUrlGroups.length;
    const trainEnd = Math.floor(total * this.config.train);
    const valEnd = trainEnd + Math.floor(total * this.config.validation);

    const trainGroups = allUrlGroups.slice(0, trainEnd);
    const valGroups = allUrlGroups.slice(trainEnd, valEnd);
    const testGroups = allUrlGroups.slice(valEnd);

    const flatten = (groups: ScreenshotMetadata[][]): ScreenshotMetadata[] =>
      groups.flat();

    const result: DatasetSplit = {
      train: flatten(trainGroups),
      validation: flatten(valGroups),
      test: flatten(testGroups),
    };

    logger.info(
      `Dataset split: train=${result.train.length} val=${result.validation.length} test=${result.test.length}`,
    );
    return result;
  }

  async saveSplitManifests(split: DatasetSplit): Promise<void> {
    ensureDir(this.outputDir);

    await Promise.all([
      this.writeSplitCsv(split.train, 'train.csv'),
      this.writeSplitCsv(split.validation, 'validation.csv'),
      this.writeSplitCsv(split.test, 'test.csv'),
    ]);

    // Write summary JSON
    const summaryPath = path.join(this.outputDir, 'split_summary.json');
    fs.writeFileSync(
      summaryPath,
      JSON.stringify(
        {
          train: split.train.length,
          validation: split.validation.length,
          test: split.test.length,
          trainLegitimate: split.train.filter((s) => s.label === 0).length,
          trainPhishing: split.train.filter((s) => s.label === 1).length,
          valLegitimate: split.validation.filter((s) => s.label === 0).length,
          valPhishing: split.validation.filter((s) => s.label === 1).length,
          testLegitimate: split.test.filter((s) => s.label === 0).length,
          testPhishing: split.test.filter((s) => s.label === 1).length,
        },
        null,
        2,
      ),
      'utf8',
    );

    logger.info(`Split manifests saved to ${this.outputDir}`);
  }

  private async writeSplitCsv(records: ScreenshotMetadata[], filename: string): Promise<void> {
    const filePath = path.join(this.outputDir, filename);
    const writer = createObjectCsvWriter({
      path: filePath,
      header: [
        { id: 'id', title: 'id' },
        { id: 'relativePath', title: 'relative_path' },
        { id: 'label', title: 'label' },
        { id: 'labelName', title: 'label_name' },
        { id: 'brand', title: 'brand' },
        { id: 'pageType', title: 'page_type' },
        { id: 'screenshotType', title: 'screenshot_type' },
        { id: 'url', title: 'url' },
      ],
      append: false,
    });
    await writer.writeRecords(records);
  }
}
