import * as fs from 'fs';
import * as path from 'path';
import { CheckpointState } from '../types';
import { ensureDir } from '../utils/helpers';
import { logger } from '../logger';

const CHECKPOINT_FILE = 'progress.json';

export class CheckpointManager {
  private filePath: string;
  private state: CheckpointState;
  private processedSet: Set<string>;
  private failedSet: Set<string>;
  private interval: number;
  private counter = 0;

  constructor(checkpointDir: string, interval = 50) {
    ensureDir(checkpointDir);
    this.filePath = path.join(checkpointDir, CHECKPOINT_FILE);
    this.interval = interval;
    const loaded = this.load();
    this.state = loaded;
    this.processedSet = new Set(loaded.processedUrls);
    this.failedSet = new Set(loaded.failedUrls);
  }

  isProcessed(url: string): boolean {
    return this.processedSet.has(url);
  }

  isFailed(url: string): boolean {
    return this.failedSet.has(url);
  }

  markSuccess(url: string, screenshotCount: number): void {
    this.processedSet.add(url);
    this.state.totalProcessed++;
    this.state.totalScreenshots += screenshotCount;
    this.counter++;
    if (this.counter >= this.interval) {
      this.save();
      this.counter = 0;
    }
  }

  markFailed(url: string): void {
    this.failedSet.add(url);
    this.state.totalFailed++;
    this.counter++;
    if (this.counter >= this.interval) {
      this.save();
      this.counter = 0;
    }
  }

  save(): void {
    try {
      this.state.processedUrls = Array.from(this.processedSet);
      this.state.failedUrls = Array.from(this.failedSet);
      this.state.lastCheckpointAt = new Date().toISOString();
      fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (err) {
      logger.warn(`Checkpoint save failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  forceSave(): void {
    this.save();
    logger.info(
      `Checkpoint saved: ${this.state.totalProcessed} processed, ${this.state.totalFailed} failed`,
    );
  }

  getProcessedCount(): number {
    return this.processedSet.size;
  }

  getFailedCount(): number {
    return this.failedSet.size;
  }

  getState(): CheckpointState {
    return { ...this.state };
  }

  private load(): CheckpointState {
    if (!fs.existsSync(this.filePath)) {
      return this.defaultState();
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      return JSON.parse(raw) as CheckpointState;
    } catch {
      logger.warn(`Could not load checkpoint from ${this.filePath}, starting fresh`);
      return this.defaultState();
    }
  }

  private defaultState(): CheckpointState {
    return {
      processedUrls: [],
      failedUrls: [],
      startedAt: new Date().toISOString(),
      lastCheckpointAt: new Date().toISOString(),
      totalProcessed: 0,
      totalFailed: 0,
      totalScreenshots: 0,
    };
  }
}
