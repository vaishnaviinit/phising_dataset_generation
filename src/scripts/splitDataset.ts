#!/usr/bin/env ts-node
/**
 * Generate train/validation/test split manifests from collected metadata.
 * Usage: npm run split
 */
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { config } from '../config';
import { DatasetSplitter } from '../reports/datasetSplitter';
import { ScreenshotMetadata } from '../types';
import { logger } from '../logger';

async function main() {
  console.log(chalk.bold.cyan('\n  Dataset Split Generator'));
  console.log(chalk.gray('  ' + '─'.repeat(50)));

  const metadataFile = path.join(config.metadataDir, 'metadata.json');

  if (!fs.existsSync(metadataFile)) {
    console.log(chalk.yellow('  No metadata.json found. Run collection first.'));
    process.exit(0);
  }

  const lines = fs.readFileSync(metadataFile, 'utf8').split('\n').filter(Boolean);
  const screenshots: ScreenshotMetadata[] = lines.map((l) => JSON.parse(l));

  console.log(`  Records loaded:  ${chalk.white(screenshots.length)}`);
  console.log(`  Split ratio:     ${chalk.white(
    `${(config.datasetSplit.train * 100).toFixed(0)}% / ${(config.datasetSplit.validation * 100).toFixed(0)}% / ${(config.datasetSplit.test * 100).toFixed(0)}%`,
  )}`);

  const splitter = new DatasetSplitter(config.datasetSplit, config.reportsDir);
  const split = splitter.split(screenshots);

  console.log(`\n  Train:           ${chalk.green(split.train.length)}`);
  console.log(`  Validation:      ${chalk.yellow(split.validation.length)}`);
  console.log(`  Test:            ${chalk.blue(split.test.length)}`);

  await splitter.saveSplitManifests(split);

  console.log(chalk.green(`\n  Split manifests saved to ${config.reportsDir}\n`));
}

main().catch((err) => {
  logger.error(`Split error: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
