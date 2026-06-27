#!/usr/bin/env ts-node
/**
 * Resume an interrupted collection job.
 * Reads checkpoint to skip already-processed URLs.
 * Usage: npm run resume
 */
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { CheckpointManager } from '../collector/checkpointManager';
import { logger } from '../logger';

async function main() {
  console.log(chalk.bold.cyan('\n  Resume Collection'));
  console.log(chalk.gray('  ' + '─'.repeat(50)));

  const checkpointFile = path.join(config.checkpointDir, 'progress.json');

  if (!fs.existsSync(checkpointFile)) {
    console.log(chalk.yellow('  No checkpoint found. Run `npm run collect` to start fresh.'));
    process.exit(0);
  }

  const checkpoint = new CheckpointManager(config.checkpointDir, config.checkpointInterval);
  const state = checkpoint.getState();

  console.log(`  Started at:    ${chalk.white(state.startedAt)}`);
  console.log(`  Last saved:    ${chalk.white(state.lastCheckpointAt)}`);
  console.log(`  Processed:     ${chalk.green(state.totalProcessed)}`);
  console.log(`  Failed:        ${chalk.red(state.totalFailed)}`);
  console.log(`  Screenshots:   ${chalk.blue(state.totalScreenshots)}`);
  console.log(chalk.gray('  ' + '─'.repeat(50)));
  console.log(chalk.gray('  Launching collect.ts — checkpoint will skip processed URLs...'));
  console.log();

  // Re-run the collect script (checkpoint manager handles the skip logic)
  require('./collect');
}

main().catch((err) => {
  logger.error(`Resume error: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
