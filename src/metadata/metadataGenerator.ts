import * as crypto from 'crypto';
import * as path from 'path';
import {
  ScreenshotMetadata,
  ScreenshotResult,
  NavigationResult,
  BrandInfo,
  PageType,
  QueueItem,
  UrlFeatures,
} from '../types';

export interface GenerateInput {
  item: QueueItem;
  navResult: NavigationResult;
  brand: BrandInfo;
  pageType: PageType;
  screenshot: ScreenshotResult;
  outputDir: string;
}

export function generateId(url: string, screenshotType: string, pageType: string): string {
  return crypto
    .createHash('sha256')
    .update(`${url}::${screenshotType}::${pageType}`)
    .digest('hex')
    .slice(0, 16);
}

export class MetadataGenerator {
  private outputDir: string;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
  }

  generate(input: GenerateInput): ScreenshotMetadata {
    const { item, navResult, brand, pageType, screenshot } = input;
    const relativePath = path.relative(this.outputDir, screenshot.path).replace(/\\/g, '/');

    return {
      id: generateId(item.url, screenshot.type, pageType),
      url: item.url,
      finalUrl: navResult.finalUrl,
      label: item.label,
      labelName: item.label === 0 ? 'legitimate' : 'phishing',
      brand: brand.name,
      brandNormalized: brand.normalizedName,
      pageType,
      screenshotType: screenshot.type,
      screenshotPath: screenshot.path,
      relativePath,
      title: navResult.pageTitle,
      timestamp: new Date().toISOString(),
      viewportWidth: screenshot.width,
      viewportHeight: screenshot.height,
      statusCode: navResult.statusCode,
      redirectCount: navResult.redirectChain.length,
      pageLoadTimeMs: navResult.loadTimeMs,
      fileSizeBytes: screenshot.fileSize,
      imageWidth: screenshot.width,
      imageHeight: screenshot.height,
      imageHash: screenshot.hash,
      isBlank: screenshot.isBlank,
      isCaptcha: screenshot.isCaptcha,
      isErrorPage: screenshot.isError,
      source: item.source,
      urlFeatures: item.urlFeatures,
    };
  }

  generateBatch(inputs: GenerateInput[]): ScreenshotMetadata[] {
    return inputs.map((i) => this.generate(i));
  }
}
