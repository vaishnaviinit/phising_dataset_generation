import * as fs from 'fs';
import sharp from 'sharp';
import { RawScreenshot } from '../playwright/screenshotCapture';
import { ScreenshotResult, ScreenshotType } from '../types';
import { computeDHash } from './duplicateDetector';
import { logger } from '../logger';

export interface QualityConfig {
  minWidth: number;
  minHeight: number;
  maxBlankRatio: number;
}

export class QualityChecker {
  private config: QualityConfig;

  constructor(config: QualityConfig) {
    this.config = config;
  }

  async validate(raw: RawScreenshot): Promise<ScreenshotResult | null> {
    if (!fs.existsSync(raw.path)) return null;

    try {
      const img = sharp(raw.path);
      const meta = await img.metadata();

      const width = meta.width ?? 0;
      const height = meta.height ?? 0;
      const fileSize = fs.statSync(raw.path).size;

      if (width < this.config.minWidth || height < this.config.minHeight) {
        logger.debug(`Screenshot too small (${width}x${height}): ${raw.path}`);
        return null;
      }

      const { isBlank, isCaptcha, isError } = await this.analyzeContent(img, width, height);
      const hash = await computeDHash(raw.path);

      return {
        type: raw.type,
        path: raw.path,
        width,
        height,
        fileSize,
        hash,
        isBlank,
        isCaptcha,
        isError,
      };
    } catch (err) {
      logger.debug(`Quality check failed for ${raw.path}: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  async validateAll(raws: RawScreenshot[]): Promise<ScreenshotResult[]> {
    const results: ScreenshotResult[] = [];
    for (const raw of raws) {
      const result = await this.validate(raw);
      if (result) results.push(result);
    }
    return results;
  }

  private async analyzeContent(
    img: sharp.Sharp,
    width: number,
    height: number,
  ): Promise<{ isBlank: boolean; isCaptcha: boolean; isError: boolean }> {
    try {
      // Sample a 64x64 thumbnail for fast analysis
      const thumb = await img
        .clone()
        .resize(64, 64, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer();

      const pixels = thumb.length / 3;
      let sumR = 0, sumG = 0, sumB = 0;
      let extremeCount = 0;

      for (let i = 0; i < thumb.length; i += 3) {
        const r = thumb[i]!;
        const g = thumb[i + 1]!;
        const b = thumb[i + 2]!;
        sumR += r; sumG += g; sumB += b;
        // Count near-white or near-black pixels
        const brightness = (r + g + b) / 3;
        if (brightness > 245 || brightness < 10) extremeCount++;
      }

      const avgR = sumR / pixels;
      const avgG = sumG / pixels;
      const avgB = sumB / pixels;
      const overallBrightness = (avgR + avgG + avgB) / 3;
      const extremeRatio = extremeCount / pixels;

      const isBlank =
        extremeRatio > this.config.maxBlankRatio ||
        (overallBrightness > 248) || // almost all white
        (overallBrightness < 7);     // almost all black

      return { isBlank, isCaptcha: false, isError: false };
    } catch {
      return { isBlank: false, isCaptcha: false, isError: false };
    }
  }
}
