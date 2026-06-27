import * as fs from 'fs';
import sharp from 'sharp';
import { ScreenshotMetadata } from '../types';
import { logger } from '../logger';

/**
 * dHash (difference hash): resize to 9x8 grayscale, compare adjacent columns.
 * Returns 64-bit hash as 16-char hex string.
 */
export async function computeDHash(imagePath: string): Promise<string> {
  try {
    const pixels = await sharp(imagePath)
      .resize(9, 8, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();

    let hash = BigInt(0);
    let bit = BigInt(0);

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const left = pixels[row * 9 + col]!;
        const right = pixels[row * 9 + col + 1]!;
        if (left > right) {
          hash |= BigInt(1) << bit;
        }
        bit++;
      }
    }

    return hash.toString(16).padStart(16, '0');
  } catch {
    return '0'.repeat(16);
  }
}

/** Hamming distance between two hex-encoded 64-bit hashes. */
export function hammingDistance(hashA: string, hashB: string): number {
  const a = BigInt('0x' + hashA);
  const b = BigInt('0x' + hashB);
  let diff = a ^ b;
  let count = 0;
  while (diff > BigInt(0)) {
    if (diff & BigInt(1)) count++;
    diff >>= BigInt(1);
  }
  return count;
}

export interface DuplicateGroup {
  canonical: string;
  duplicates: string[];
}

export class DuplicateDetector {
  private threshold: number;

  constructor(threshold = 10) {
    this.threshold = threshold;
  }

  /** Find near-duplicate screenshots within a metadata array. */
  findDuplicates(screenshots: ScreenshotMetadata[]): {
    uniqueScreenshots: ScreenshotMetadata[];
    duplicateGroups: DuplicateGroup[];
    removedCount: number;
  } {
    const kept: ScreenshotMetadata[] = [];
    const groups: DuplicateGroup[] = [];
    const removed = new Set<string>();

    for (let i = 0; i < screenshots.length; i++) {
      const a = screenshots[i]!;
      if (removed.has(a.screenshotPath)) continue;

      const group: DuplicateGroup = { canonical: a.screenshotPath, duplicates: [] };

      for (let j = i + 1; j < screenshots.length; j++) {
        const b = screenshots[j]!;
        if (removed.has(b.screenshotPath)) continue;

        if (
          a.screenshotType === b.screenshotType &&
          hammingDistance(a.imageHash, b.imageHash) <= this.threshold
        ) {
          group.duplicates.push(b.screenshotPath);
          removed.add(b.screenshotPath);
        }
      }

      kept.push(a);
      if (group.duplicates.length > 0) groups.push(group);
    }

    logger.info(`Duplicate detection: ${removed.size} duplicates found across ${groups.length} groups`);

    return {
      uniqueScreenshots: kept,
      duplicateGroups: groups,
      removedCount: removed.size,
    };
  }

  /** Delete duplicate image files from disk. */
  async deleteDuplicateFiles(groups: DuplicateGroup[]): Promise<number> {
    let deleted = 0;
    for (const group of groups) {
      for (const dupeFile of group.duplicates) {
        try {
          if (fs.existsSync(dupeFile)) {
            fs.unlinkSync(dupeFile);
            deleted++;
          }
        } catch (err) {
          logger.warn(`Could not delete duplicate ${dupeFile}: ${err instanceof Error ? err.message : err}`);
        }
      }
    }
    return deleted;
  }
}
