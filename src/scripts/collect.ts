#!/usr/bin/env ts-node
/**
 * Main collection script.
 * Usage: npm run collect [-- --max-urls 100 --workers 4]
 */
import chalk from 'chalk';
import { config } from '../config';
import { CsvParser } from '../parser/csvParser';
import { BrowserPool } from '../browser/browserPool';
import { WorkerPool } from '../workers/workerPool';
import { TaskQueue } from '../workers/taskQueue';
import { ScreenshotCollector } from '../collector/screenshotCollector';
import { CheckpointManager } from '../collector/checkpointManager';
import { MetadataStore } from '../metadata/metadataStore';
import { FileStorage } from '../storage/fileStorage';
import { ReportGenerator } from '../reports/reportGenerator';
import { DatasetSplitter } from '../reports/datasetSplitter';
import { DuplicateDetector } from '../image/duplicateDetector';
import { ProgressTracker } from '../utils/progress';
import { CURATED_URLS } from '../data/curatedUrls';
import { QueueItem, Label } from '../types';
import { ensureDir } from '../utils/helpers';
import { logger } from '../logger';

// ─── Parse CLI args ───────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i]?.startsWith('--') && args[i + 1]) {
      const key = args[i]!.slice(2);
      opts[key] = args[i + 1]!;
      i++;
    }
  }
  return opts;
}

async function main() {
  const args = parseArgs();
  const maxUrls = args['max-urls'] ? parseInt(args['max-urls'], 10) : config.maxUrls;
  const workers = args['workers'] ? parseInt(args['workers'], 10) : config.workers;

  console.log(chalk.bold.cyan('\n  Phishing Screenshot Collection Pipeline'));
  console.log(chalk.gray('  ' + '─'.repeat(50)));
  console.log(`  CSV:     ${chalk.white(config.csvPath)}`);
  console.log(`  Output:  ${chalk.white(config.outputDir)}`);
  console.log(`  Workers: ${chalk.white(workers)}`);
  console.log(`  Limit:   ${chalk.white(maxUrls === 0 ? 'unlimited' : maxUrls)}`);
  console.log(chalk.gray('  ' + '─'.repeat(50) + '\n'));

  // Ensure directories exist
  for (const dir of [config.outputDir, config.logsDir, config.metadataDir, config.reportsDir]) {
    ensureDir(dir);
  }

  // ── Parse CSV ──────────────────────────────────────────────────────────────
  const parser = new CsvParser(config.logsDir);
  const parseResult = await parser.parse(config.csvPath, {
    maxUrls: maxUrls || undefined,
    labelFilter: config.labelFilter,
  });

  // ── Merge curated URLs ─────────────────────────────────────────────────────
  const curatedItems: QueueItem[] = CURATED_URLS.map((c) => ({
    url: c.url,
    label: c.label as Label,
    urlFeatures: {},
    source: 'curated',
    attemptNumber: 0,
  }));

  const allItems: QueueItem[] = [...parseResult.items, ...curatedItems];
  logger.info(`Total items to process: ${allItems.length} (CSV: ${parseResult.items.length}, Curated: ${curatedItems.length})`);

  // ── Initialize subsystems ──────────────────────────────────────────────────
  const checkpoint = new CheckpointManager(config.checkpointDir, config.checkpointInterval);
  const metaStore = new MetadataStore(config.metadataDir);
  const fileStorage = new FileStorage(config.logsDir);
  const workerPool = new WorkerPool({ ...config, workers });
  const browserPool = workerPool.getBrowserPool();

  await workerPool.initialize();

  const collector = new ScreenshotCollector(
    { ...config, workers },
    browserPool,
    metaStore,
    fileStorage,
    checkpoint,
  );

  const progress = new ProgressTracker(allItems.length);
  progress.start();

  // ── Graceful shutdown handler ──────────────────────────────────────────────
  let shutdownRequested = false;
  const shutdown = async (signal: string) => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    progress.stop();
    logger.info(`\n${signal} received — saving checkpoint and shutting down...`);
    checkpoint.forceSave();
    await metaStore.finalFlush();
    await fileStorage.flushFailedUrls();
    await workerPool.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // ── Process all items ──────────────────────────────────────────────────────
  const queue = new TaskQueue<QueueItem>(workers);
  await queue.processAll(allItems, async (item, workerIndex) => {
    if (shutdownRequested) return;
    await collector.processItem(item, workerIndex, progress);
  });

  // ── Final flush & report ───────────────────────────────────────────────────
  progress.stop();
  progress.printSummary();

  checkpoint.forceSave();
  await metaStore.finalFlush();
  await fileStorage.flushFailedUrls();

  // Duplicate detection
  const dupDetector = new DuplicateDetector(config.quality.duplicateHashThreshold);
  const { uniqueScreenshots, removedCount } = dupDetector.findDuplicates(metaStore.getRecords());

  // Generate reports
  const reporter = new ReportGenerator(config.reportsDir);
  const stats = reporter.generate(
    uniqueScreenshots,
    allItems.length,
    checkpoint.getProcessedCount() + checkpoint.getFailedCount(),
    checkpoint.getFailedCount(),
    removedCount,
  );
  await reporter.saveAll(stats);

  // Dataset split
  const splitter = new DatasetSplitter(config.datasetSplit, config.reportsDir);
  const split = splitter.split(uniqueScreenshots);
  await splitter.saveSplitManifests(split);

  await workerPool.shutdown();

  console.log(chalk.bold.green('\n  Collection complete!'));
  console.log(`  Reports: ${chalk.cyan(config.reportsDir)}`);
  console.log(`  Dataset: ${chalk.cyan(config.outputDir)}\n`);
}

main().catch((err) => {
  logger.error(`Fatal error: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
