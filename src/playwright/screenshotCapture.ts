import * as path from 'path';
import * as fs from 'fs';
import { Page } from 'playwright';
import { ScreenshotType } from '../types';
import { ensureDir } from '../utils/helpers';
import { logger } from '../logger';

export interface CaptureOptions {
  outputDir: string;
  types: ScreenshotType[];
  timeoutMs: number;
}

export interface RawScreenshot {
  type: ScreenshotType;
  path: string;
}

export class ScreenshotCapture {
  private options: CaptureOptions;

  constructor(options: CaptureOptions) {
    this.options = options;
  }

  async captureAll(
    desktopPage: Page,
    mobilePage: Page,
    screenshotDir: string,
  ): Promise<RawScreenshot[]> {
    const results: RawScreenshot[] = [];
    const { types } = this.options;

    ensureDir(screenshotDir);

    for (const type of types) {
      try {
        const result = await this.captureOne(desktopPage, mobilePage, type, screenshotDir);
        if (result) results.push(result);
      } catch (err) {
        logger.debug(`Screenshot ${type} failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    return results;
  }

  private async captureOne(
    desktopPage: Page,
    mobilePage: Page,
    type: ScreenshotType,
    screenshotDir: string,
  ): Promise<RawScreenshot | null> {
    const outPath = path.join(screenshotDir, `${type}.png`);

    try {
      switch (type) {
        case 'desktop':
          await desktopPage.screenshot({
            path: outPath,
            type: 'png',
            timeout: this.options.timeoutMs,
          });
          break;

        case 'mobile':
          await mobilePage.screenshot({
            path: outPath,
            type: 'png',
            timeout: this.options.timeoutMs,
          });
          break;

        case 'fullpage':
          await desktopPage.screenshot({
            path: outPath,
            type: 'png',
            fullPage: true,
            timeout: this.options.timeoutMs,
          });
          break;

        case 'above_fold': {
          // Capture only the viewport area (above the fold)
          const vp = desktopPage.viewportSize() ?? { width: 1920, height: 1080 };
          await desktopPage.screenshot({
            path: outPath,
            type: 'png',
            clip: { x: 0, y: 0, width: vp.width, height: vp.height },
            timeout: this.options.timeoutMs,
          });
          break;
        }
      }

      if (!fs.existsSync(outPath)) return null;
      const stat = fs.statSync(outPath);
      if (stat.size < 500) {
        fs.unlinkSync(outPath);
        return null;
      }

      return { type, path: outPath };
    } catch {
      return null;
    }
  }
}
