import * as crypto from 'crypto';
import * as path from 'path';
import * as url from 'url';

/** Short 8-char hex hash of a string (for unique file paths). */
export function shortHash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 8);
}

/** Sleep for ms milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Format milliseconds into human-readable duration. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

/** Format bytes to human-readable file size. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

/** Extract hostname from URL, stripping www. */
export function extractDomain(rawUrl: string): string {
  try {
    const parsed = new url.URL(rawUrl);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return rawUrl;
  }
}

/** Normalize a brand name to a safe folder name. */
export function normalizeBrandName(brand: string): string {
  return brand
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

/** Normalize a URL to canonical form (lowercase scheme+host, remove trailing /). */
export function normalizeUrl(rawUrl: string): string {
  try {
    const parsed = new url.URL(rawUrl);
    parsed.hostname = parsed.hostname.toLowerCase();
    let out = parsed.toString();
    if (out.endsWith('/') && parsed.pathname === '/') out = out.slice(0, -1);
    return out;
  } catch {
    return rawUrl.trim();
  }
}

/** Check if a string looks like a valid HTTP/HTTPS URL. */
export function isValidHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new url.URL(rawUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Build the screenshot output directory path. */
export function buildScreenshotDir(
  outputDir: string,
  label: 0 | 1,
  brandNormalized: string,
  pageType: string,
  urlHash: string,
): string {
  const category = label === 0 ? 'legitimate' : 'phishing';
  return path.join(outputDir, category, brandNormalized, pageType, urlHash);
}

/** Ensure all directories in the path exist. */
export function ensureDir(dirPath: string): void {
  const fs = require('fs') as typeof import('fs');
  fs.mkdirSync(dirPath, { recursive: true });
}

/** Compute ETA string given progress and elapsed time. */
export function computeEta(processed: number, total: number, elapsedMs: number): string {
  if (processed === 0) return 'calculating...';
  const rate = processed / elapsedMs;
  const remaining = total - processed;
  const etaMs = remaining / rate;
  return formatDuration(Math.round(etaMs));
}

/** Exponential backoff delay: base * 2^attempt (capped). */
export function backoffDelay(base: number, attempt: number, cap = 30_000): number {
  return Math.min(base * Math.pow(2, attempt), cap);
}

/** Chunk an array into batches of size n. */
export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/** Shuffle an array in place (Fisher–Yates). */
export function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
