import * as cliProgress from 'cli-progress';
import chalk from 'chalk';
import { ProgressStats } from '../types';
import { computeEta, formatDuration } from './helpers';

export class ProgressTracker {
  private bar: cliProgress.SingleBar;
  private stats: ProgressStats;

  constructor(total: number) {
    this.stats = {
      total,
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      screenshots: 0,
      startTime: Date.now(),
    };

    this.bar = new cliProgress.SingleBar(
      {
        format:
          chalk.cyan('{bar}') +
          ' {percentage}% | ' +
          chalk.green('✓ {succeeded}') +
          ' ' +
          chalk.red('✗ {failed}') +
          ' ' +
          chalk.yellow('⏭ {skipped}') +
          ' | ' +
          chalk.blue('📸 {screenshots}') +
          ' | ETA: {eta} | {currentUrl}',
        barCompleteChar: '█',
        barIncompleteChar: '░',
        hideCursor: true,
        clearOnComplete: false,
        stopOnComplete: false,
      },
      cliProgress.Presets.shades_classic,
    );
  }

  start(): void {
    this.bar.start(this.stats.total, 0, {
      succeeded: 0,
      failed: 0,
      skipped: 0,
      screenshots: 0,
      eta: 'calculating...',
      currentUrl: '',
    });
  }

  update(delta: Partial<ProgressStats> & { currentUrl?: string }): void {
    if (delta.succeeded !== undefined) this.stats.succeeded += delta.succeeded;
    if (delta.failed !== undefined) this.stats.failed += delta.failed;
    if (delta.skipped !== undefined) this.stats.skipped += delta.skipped;
    if (delta.screenshots !== undefined) this.stats.screenshots += delta.screenshots;

    this.stats.processed = this.stats.succeeded + this.stats.failed + this.stats.skipped;

    const elapsed = Date.now() - this.stats.startTime;
    const eta = computeEta(this.stats.processed, this.stats.total, elapsed);

    this.bar.update(this.stats.processed, {
      succeeded: this.stats.succeeded,
      failed: this.stats.failed,
      skipped: this.stats.skipped,
      screenshots: this.stats.screenshots,
      eta,
      currentUrl: (delta.currentUrl ?? '').slice(0, 50),
    });
  }

  stop(): void {
    this.bar.stop();
  }

  getStats(): ProgressStats {
    return { ...this.stats };
  }

  printSummary(): void {
    const elapsed = Date.now() - this.stats.startTime;
    console.log('\n' + chalk.bold('─'.repeat(70)));
    console.log(chalk.bold.cyan('  Collection Summary'));
    console.log(chalk.bold('─'.repeat(70)));
    console.log(`  Total URLs     : ${chalk.white(this.stats.total)}`);
    console.log(`  Processed      : ${chalk.white(this.stats.processed)}`);
    console.log(`  Succeeded      : ${chalk.green(this.stats.succeeded)}`);
    console.log(`  Failed         : ${chalk.red(this.stats.failed)}`);
    console.log(`  Skipped        : ${chalk.yellow(this.stats.skipped)}`);
    console.log(`  Screenshots    : ${chalk.blue(this.stats.screenshots)}`);
    console.log(`  Duration       : ${chalk.white(formatDuration(elapsed))}`);
    console.log(chalk.bold('─'.repeat(70)));
  }
}
