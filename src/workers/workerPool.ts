import { BrowserPool } from '../browser/browserPool';
import { Config } from '../config';
import { logger } from '../logger';

export interface WorkerContext {
  workerIndex: number;
  browserPool: BrowserPool;
}

export class WorkerPool {
  private browserPool: BrowserPool;
  private config: Config;
  private activeWorkers = 0;

  constructor(config: Config) {
    this.config = config;
    this.browserPool = new BrowserPool(config);
  }

  async initialize(): Promise<void> {
    await this.browserPool.initialize();
    logger.info(`Worker pool initialized with ${this.config.workers} workers`);
  }

  getWorkerContext(workerIndex: number): WorkerContext {
    return {
      workerIndex,
      browserPool: this.browserPool,
    };
  }

  getBrowserPool(): BrowserPool {
    return this.browserPool;
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down worker pool...');
    await this.browserPool.closeAll();
    logger.info('Worker pool shut down');
  }
}
