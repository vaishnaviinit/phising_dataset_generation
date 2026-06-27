#!/usr/bin/env ts-node
/**
 * Validate existing screenshots: check for blanks, corrupted files, and quality issues.
 * Usage: npm run validate
 */
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { config } from '../config';
import { QualityChecker } from '../image/qualityChecker';
import { ScreenshotMetadata } from '../types';
import { logger } from '../logger';

async function main() {
  console.log(chalk.bold.cyan('\n  Screenshot Quality Validation'));
  console.log(chalk.gray('  ' + '─'.repeat(50)));

  const metadataFile = path.join(config.metadataDir, 'metadata.json');
  if (!fs.existsSync(metadataFile)) {
    console.log(chalk.yellow('  No metadata.json found. Run collection first.'));
    process.exit(0);
  }

  const lines = fs.readFileSync(metadataFile, 'utf8').split('\n').filter(Boolean);
  const records: ScreenshotMetadata[] = lines.map((l) => JSON.parse(l));

  const checker = new QualityChecker(config.quality);

  let missing = 0, blank = 0, small = 0, ok = 0;

  for (const record of records) {
    if (!fs.existsSync(record.screenshotPath)) {
      missing++;
      continue;
    }

    const result = await checker.validate({ type: record.screenshotType, path: record.screenshotPath });
    if (!result) {
      small++;
    } else if (result.isBlank) {
      blank++;
    } else {
      ok++;
    }
  }

  console.log(`  Total records:   ${chalk.white(records.length)}`);
  console.log(`  Valid:           ${chalk.green(ok)}`);
  console.log(`  Blank/Empty:     ${chalk.yellow(blank)}`);
  console.log(`  Too small:       ${chalk.yellow(small)}`);
  console.log(`  Missing files:   ${chalk.red(missing)}`);

  const issueRate = ((blank + small + missing) / records.length * 100).toFixed(1);
  console.log(`  Issue rate:      ${chalk.white(issueRate + '%')}`);

  console.log(chalk.green('\n  Validation complete!\n'));
}

main().catch((err) => {
  logger.error(`Validate error: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
