#!/usr/bin/env ts-node
/**
 * Validate the CSV dataset without running collection.
 * Reports invalid URLs, duplicates, and label distribution.
 * Usage: npm run validate-csv
 */
import chalk from 'chalk';
import { config } from '../config';
import { CsvParser } from '../parser/csvParser';
import { logger } from '../logger';

async function main() {
  console.log(chalk.bold.cyan('\n  CSV Validation'));
  console.log(chalk.gray('  ' + '─'.repeat(50)));
  console.log(`  File: ${chalk.white(config.csvPath)}\n`);

  const parser = new CsvParser(config.logsDir);
  const result = await parser.parse(config.csvPath);

  const legitimate = result.items.filter((i) => i.label === 0);
  const phishing = result.items.filter((i) => i.label === 1);

  console.log(chalk.bold('  Results'));
  console.log(`  Total rows:     ${chalk.white(result.totalRows)}`);
  console.log(`  Valid URLs:     ${chalk.green(result.items.length)}`);
  console.log(`  Invalid URLs:   ${chalk.red(result.invalidCount)}`);
  console.log(`  Duplicates:     ${chalk.yellow(result.duplicateCount)}`);
  console.log(`  Legitimate:     ${chalk.blue(legitimate.length)}`);
  console.log(`  Phishing:       ${chalk.magenta(phishing.length)}`);

  const ratio = phishing.length / (legitimate.length || 1);
  console.log(`  Phish ratio:    ${chalk.white((ratio * 100).toFixed(1) + '%')}`);

  if (result.invalidCount > 0) {
    console.log(chalk.yellow(`\n  Invalid URLs logged to logs/invalid_urls.csv`));
  }

  console.log(chalk.green('\n  Validation complete!\n'));
}

main().catch((err) => {
  logger.error(`Validation error: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
