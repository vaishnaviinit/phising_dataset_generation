import { Browser, BrowserContext, chromium } from 'playwright';
import { buildContextOptions, pickUserAgent } from '../playwright/antiDetection';
import { logger } from '../logger';
import { Config } from '../config';

export interface PooledContext {
  context: BrowserContext;
  browserId: number;
  contextId: string;
}

export class BrowserPool {
  private browsers: Browser[] = [];
  private config: Config;
  private initialized = false;
  private workerIndex = 0;

  constructor(config: Config) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    logger.info(`Launching ${this.config.workers} browser instance(s)...`);

    for (let i = 0; i < this.config.workers; i++) {
      const browser = await chromium.launch({
        headless: this.config.headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-sync',
          '--disable-translate',
          '--mute-audio',
          '--no-default-browser-check',
          '--disable-features=TranslateUI',
          '--disable-infobars',
        ],
      });
      this.browsers.push(browser);
      logger.debug(`Browser ${i + 1} launched`);
    }

    this.initialized = true;
    logger.info(`Browser pool ready (${this.config.workers} browsers)`);
  }

  /** Create a new isolated context for a task. Caller must close it when done. */
  async createContext(
    workerIdx: number,
    isMobile = false,
  ): Promise<BrowserContext> {
    if (!this.initialized) await this.initialize();

    const browser = this.browsers[workerIdx % this.browsers.length]!;
    const ua = pickUserAgent(workerIdx);
    const viewport = isMobile
      ? this.config.viewport.mobile
      : this.config.viewport.desktop;

    const ctxOptions = this.config.antiDetection
      ? buildContextOptions(ua, viewport, isMobile)
      : { viewport, ignoreHTTPSErrors: true };

    const context = await browser.newContext(ctxOptions);

    // Block unnecessary resource types to speed up loading
    await context.route('**/*', (route) => {
      const blocked = ['font', 'media'];
      if (blocked.includes(route.request().resourceType())) {
        route.abort();
      } else {
        route.continue();
      }
    });

    return context;
  }

  async closeAll(): Promise<void> {
    logger.info('Closing browser pool...');
    for (const browser of this.browsers) {
      try {
        await browser.close();
      } catch {
        // ignore
      }
    }
    this.browsers = [];
    this.initialized = false;
    logger.info('Browser pool closed');
  }

  getBrowserCount(): number {
    return this.browsers.length;
  }
}
