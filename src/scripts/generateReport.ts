#!/usr/bin/env ts-node
/**
 * Generate dataset statistics report from existing metadata.
 * Usage: npm run report
 */
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { config } from '../config';
import { ReportGenerator } from '../reports/reportGenerator';
import { DuplicateDetector } from '../image/duplicateDetector';
import { ScreenshotMetadata } from '../types';
import { logger } from '../logger';

async function main() {
  console.log(chalk.bold.cyan('\n  Dataset Report Generator'));
  console.log(chalk.gray('  ' + '─'.repeat(50)));

  const metadataFile = path.join(config.metadataDir, 'metadata.json');

  if (!fs.existsSync(metadataFile)) {
    console.log(chalk.yellow('  No metadata.json found. Run collection first.'));
    process.exit(0);
  }

  const lines = fs.readFileSync(metadataFile, 'utf8').split('\n').filter(Boolean);
  const screenshots: ScreenshotMetadata[] = lines.map((l) => JSON.parse(l));

  console.log(`  Loaded ${chalk.white(screenshots.length)} records`);

  // Run duplicate detection
  const detector = new DuplicateDetector(config.quality.duplicateHashThreshold);
  const { uniqueScreenshots, removedCount } = detector.findDuplicates(screenshots);

  // Load failed URL count from log
  const failedLogPath = path.join(config.logsDir, 'failed_urls.csv');
  let failedCount = 0;
  if (fs.existsSync(failedLogPath)) {
    const lines2 = fs.readFileSync(failedLogPath, 'utf8').split('\n');
    failedCount = Math.max(0, lines2.length - 2); // subtract header + possible trailing newline
  }

  const reporter = new ReportGenerator(config.reportsDir);
  const stats = reporter.generate(uniqueScreenshots, 0, screenshots.length, failedCount, removedCount);
  await reporter.saveAll(stats);

  console.log(`\n  Total screenshots:   ${chalk.green(stats.totalScreenshots)}`);
  console.log(`  Legitimate:          ${chalk.blue(stats.legitimateScreenshots)}`);
  console.log(`  Phishing:            ${chalk.red(stats.phishingScreenshots)}`);
  console.log(`  Unique brands:       ${chalk.yellow(stats.uniqueBrands)}`);
  console.log(`  Duplicates removed:  ${chalk.gray(stats.duplicatesRemoved)}`);

  console.log(chalk.green(`\n  Reports saved to ${config.reportsDir}\n`));
}

main().catch((err) => {
  logger.error(`Report error: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
