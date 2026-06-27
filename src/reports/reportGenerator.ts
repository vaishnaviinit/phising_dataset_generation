import * as fs from 'fs';
import * as path from 'path';
import { createObjectCsvWriter } from 'csv-writer';
import {
  DatasetStats,
  ScreenshotMetadata,
  PageType,
  ScreenshotType,
  FailureReason,
} from '../types';
import { ensureDir } from '../utils/helpers';
import { logger } from '../logger';

export class ReportGenerator {
  private reportsDir: string;

  constructor(reportsDir: string) {
    this.reportsDir = reportsDir;
    ensureDir(reportsDir);
  }

  generate(
    screenshots: ScreenshotMetadata[],
    totalUrls: number,
    visitedUrls: number,
    failedUrls: number,
    duplicatesRemoved: number,
  ): DatasetStats {
    const legitimate = screenshots.filter((s) => s.label === 0);
    const phishing = screenshots.filter((s) => s.label === 1);

    const pageTypeCounts = {} as Record<PageType, number>;
    const screenshotTypeCounts = {} as Record<ScreenshotType, number>;
    const failureReasons = {} as Record<FailureReason, number>;
    const brandDistribution: Record<string, number> = {};
    const brands = new Set<string>();

    let totalWidth = 0, totalHeight = 0, totalLoadTime = 0;
    let blanksRemoved = 0;

    for (const s of screenshots) {
      pageTypeCounts[s.pageType] = (pageTypeCounts[s.pageType] ?? 0) + 1;
      screenshotTypeCounts[s.screenshotType] = (screenshotTypeCounts[s.screenshotType] ?? 0) + 1;
      brandDistribution[s.brand] = (brandDistribution[s.brand] ?? 0) + 1;
      brands.add(s.brand);
      totalWidth += s.imageWidth;
      totalHeight += s.imageHeight;
      totalLoadTime += s.pageLoadTimeMs;
      if (s.isBlank) blanksRemoved++;
    }

    const count = screenshots.length || 1;

    return {
      totalUrls,
      visitedUrls,
      successfulUrls: visitedUrls - failedUrls,
      failedUrls,
      legitimateScreenshots: legitimate.length,
      phishingScreenshots: phishing.length,
      totalScreenshots: screenshots.length,
      uniqueBrands: brands.size,
      pageTypeCounts,
      screenshotTypeCounts,
      avgResolutionWidth: Math.round(totalWidth / count),
      avgResolutionHeight: Math.round(totalHeight / count),
      avgLoadTimeMs: Math.round(totalLoadTime / count),
      duplicatesRemoved,
      blanksRemoved,
      failureReasons,
      brandDistribution,
      generatedAt: new Date().toISOString(),
    };
  }

  async saveAll(stats: DatasetStats): Promise<void> {
    await Promise.all([
      this.saveJson(stats),
      this.saveCsv(stats),
      this.saveMarkdown(stats),
    ]);
    logger.info(`Reports saved to ${this.reportsDir}`);
  }

  private async saveJson(stats: DatasetStats): Promise<void> {
    const filePath = path.join(this.reportsDir, 'dataset_summary.json');
    fs.writeFileSync(filePath, JSON.stringify(stats, null, 2), 'utf8');
  }

  private async saveCsv(stats: DatasetStats): Promise<void> {
    const filePath = path.join(this.reportsDir, 'dataset_summary.csv');
    const rows = [
      { metric: 'total_urls', value: stats.totalUrls },
      { metric: 'visited_urls', value: stats.visitedUrls },
      { metric: 'successful_urls', value: stats.successfulUrls },
      { metric: 'failed_urls', value: stats.failedUrls },
      { metric: 'legitimate_screenshots', value: stats.legitimateScreenshots },
      { metric: 'phishing_screenshots', value: stats.phishingScreenshots },
      { metric: 'total_screenshots', value: stats.totalScreenshots },
      { metric: 'unique_brands', value: stats.uniqueBrands },
      { metric: 'avg_width', value: stats.avgResolutionWidth },
      { metric: 'avg_height', value: stats.avgResolutionHeight },
      { metric: 'avg_load_time_ms', value: stats.avgLoadTimeMs },
      { metric: 'duplicates_removed', value: stats.duplicatesRemoved },
      { metric: 'blanks_removed', value: stats.blanksRemoved },
    ];

    const writer = createObjectCsvWriter({
      path: filePath,
      header: [
        { id: 'metric', title: 'metric' },
        { id: 'value', title: 'value' },
      ],
    });
    await writer.writeRecords(rows);
  }

  private async saveMarkdown(stats: DatasetStats): Promise<void> {
    const filePath = path.join(this.reportsDir, 'dataset_summary.md');
    const brandTop = Object.entries(stats.brandDistribution)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([brand, count]) => `| ${brand} | ${count} |`)
      .join('\n');

    const pageTypeRows = Object.entries(stats.pageTypeCounts)
      .map(([pt, cnt]) => `| ${pt} | ${cnt} |`)
      .join('\n');

    const content = `# Dataset Summary

Generated: ${stats.generatedAt}

## Overview

| Metric | Value |
|--------|-------|
| Total URLs | ${stats.totalUrls} |
| Visited URLs | ${stats.visitedUrls} |
| Successful URLs | ${stats.successfulUrls} |
| Failed URLs | ${stats.failedUrls} |
| Total Screenshots | ${stats.totalScreenshots} |
| Legitimate Screenshots | ${stats.legitimateScreenshots} |
| Phishing Screenshots | ${stats.phishingScreenshots} |
| Unique Brands | ${stats.uniqueBrands} |

## Image Quality

| Metric | Value |
|--------|-------|
| Avg Width (px) | ${stats.avgResolutionWidth} |
| Avg Height (px) | ${stats.avgResolutionHeight} |
| Avg Load Time (ms) | ${stats.avgLoadTimeMs} |
| Duplicates Removed | ${stats.duplicatesRemoved} |
| Blanks Removed | ${stats.blanksRemoved} |

## Page Type Distribution

| Page Type | Count |
|-----------|-------|
${pageTypeRows}

## Top 20 Brands

| Brand | Screenshots |
|-------|-------------|
${brandTop}
`;

    fs.writeFileSync(filePath, content, 'utf8');
  }
}
