import { QueueItem } from '../types';
import { logger } from '../logger';

/**
 * Lightweight async semaphore for concurrency control.
 * Replaces p-queue to avoid ESM-only dependency issues.
 */
class Semaphore {
  private permits: number;
  private waiters: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }
}

export type TaskFn<T> = (item: T, workerIndex: number) => Promise<void>;

export class TaskQueue<T> {
  private semaphore: Semaphore;
  private concurrency: number;
  private workerCounter = 0;
  private pending = 0;
  private completed = 0;
  private failed = 0;

  constructor(concurrency: number) {
    this.concurrency = concurrency;
    this.semaphore = new Semaphore(concurrency);
  }

  /** Process all items with bounded concurrency. */
  async processAll(items: T[], fn: TaskFn<T>): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const item of items) {
      const workerIndex = this.workerCounter++ % this.concurrency;

      const task = async () => {
        await this.semaphore.acquire();
        this.pending++;
        try {
          await fn(item, workerIndex);
          this.completed++;
        } catch (err) {
          this.failed++;
          logger.error(`Task error: ${err instanceof Error ? err.message : err}`);
        } finally {
          this.pending--;
          this.semaphore.release();
        }
      };

      promises.push(task());
    }

    await Promise.all(promises);
  }

  getStats() {
    return {
      pending: this.pending,
      completed: this.completed,
      failed: this.failed,
    };
  }
}
