#!/usr/bin/env ts-node
/**
 * Scan existing metadata and remove near-duplicate screenshots.
 * Uses dHash perceptual hashing.
 * Usage: npm run deduplicate
 */
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { config } from '../config';
import { DuplicateDetector } from '../image/duplicateDetector';
import { ScreenshotMetadata } from '../types';
import { logger } from '../logger';

async function main() {
  console.log(chalk.bold.cyan('\n  Duplicate Detection & Removal'));
  console.log(chalk.gray('  ' + '─'.repeat(50)));

  const metadataFile = path.join(config.metadataDir, 'metadata.json');

  if (!fs.existsSync(metadataFile)) {
    console.log(chalk.yellow('  No metadata.json found. Run collection first.'));
    process.exit(0);
  }

  // Load metadata (JSON Lines format)
  const lines = fs.readFileSync(metadataFile, 'utf8').split('\n').filter(Boolean);
  const screenshots: ScreenshotMetadata[] = lines.map((l) => JSON.parse(l));

  console.log(`  Loaded ${chalk.white(screenshots.length)} screenshot records`);
  console.log(`  Hash threshold: ${chalk.white(config.quality.duplicateHashThreshold)}\n`);

  const detector = new DuplicateDetector(config.quality.duplicateHashThreshold);
  const { uniqueScreenshots, duplicateGroups, removedCount } = detector.findDuplicates(screenshots);

  console.log(`  Unique screenshots:  ${chalk.green(uniqueScreenshots.length)}`);
  console.log(`  Duplicate groups:    ${chalk.yellow(duplicateGroups.length)}`);
  console.log(`  Duplicates found:    ${chalk.red(removedCount)}`);

  if (removedCount === 0) {
    console.log(chalk.green('\n  No duplicates found.\n'));
    return;
  }

  // Ask for confirmation before deletion
  console.log(chalk.yellow(`\n  Will delete ${removedCount} duplicate files. Continue? [y/N]`));

  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.once('data', async (data) => {
    process.stdin.pause();
    if (data.toString().trim().toLowerCase() === 'y') {
      const deleted = await detector.deleteDuplicateFiles(duplicateGroups);
      console.log(chalk.green(`\n  Deleted ${deleted} duplicate files.\n`));
    } else {
      console.log(chalk.gray('\n  Aborted.\n'));
    }
  });
}

main().catch((err) => {
  logger.error(`Dedup error: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
