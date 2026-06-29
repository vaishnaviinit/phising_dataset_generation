// ─────────────────────────────────────────────────────────────────────────────
//  Screenshot capture — desktop-only, one file per page type
//
//  The new strategy captures exactly ONE desktop screenshot per page.
//  The caller is responsible for building the output file path (e.g.
//  `dataset/legitimate/amazon/login.png`).  No mobile / fullpage / above-fold
//  variants are created by default.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import { Page } from 'playwright';
import { ScreenshotType } from '../types';
import { ensureDir } from '../utils/helpers';
import { logger } from '../logger';

/** Minimal raw screenshot record passed to the quality checker. */
export interface RawScreenshot {
  /** In the new strategy this is always 'desktop'; the type is kept broad for
   *  backward compatibility with the validate script and quality checker. */
  type: ScreenshotType;
  path: string;
}

export class ScreenshotCapture {
  private timeoutMs: number;

  constructor(timeoutMs: number) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Capture a full-viewport desktop screenshot and save it to `filePath`.
   * Returns null if the capture failed or the resulting file is too small.
   */
  async captureDesktop(page: Page, filePath: string): Promise<RawScreenshot | null> {
    ensureDir(path.dirname(filePath));

    try {
      await page.screenshot({
        path: filePath,
        type: 'png',
        timeout: this.timeoutMs,
      });

      if (!fs.existsSync(filePath)) return null;

      const { size } = fs.statSync(filePath);
      if (size < 500) {
        fs.unlinkSync(filePath);
        return null;
      }

      return { type: 'desktop' as ScreenshotType, path: filePath };
    } catch (err) {
      logger.debug(
        `Screenshot capture failed (${filePath}): ${err instanceof Error ? err.message : err}`,
      );
      // Clean up partial file if it was written
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
      return null;
    }
  }
}
