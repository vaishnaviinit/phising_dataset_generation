import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { ScreenshotType } from '../types';

dotenv.config();

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}
function envNum(key: string, fallback: number): number {
  const v = process.env[key];
  return v !== undefined ? Number(v) : fallback;
}
function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined) return fallback;
  return v.toLowerCase() === 'true' || v === '1';
}

// ─── Resolve project root (where package.json lives) ─────────────────────────
function findProjectRoot(): string {
  let dir = __dirname;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export const PROJECT_ROOT = findProjectRoot();

// ─── Auto-discover CSV inside url/ dir ───────────────────────────────────────
function discoverCsv(urlDir: string, preferredFile?: string): string {
  if (!fs.existsSync(urlDir)) {
    throw new Error(`url/ directory not found at: ${urlDir}`);
  }

  const walk = (dir: string): string[] => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const csvs: string[] = [];
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) csvs.push(...walk(full));
      else if (e.isFile() && e.name.toLowerCase().endsWith('.csv')) csvs.push(full);
    }
    return csvs;
  };

  const found = walk(urlDir);
  if (found.length === 0) throw new Error(`No CSV files found in ${urlDir}`);

  if (preferredFile) {
    const match = found.find((f) => path.basename(f) === preferredFile);
    if (match) return match;
    throw new Error(`CSV_FILE="${preferredFile}" not found in ${urlDir}`);
  }

  return found[0]!;
}

const URL_DIR = path.resolve(PROJECT_ROOT, env('URL_DIR', 'url'));
const CSV_FILE = env('CSV_FILE', '');

export const config = {
  // ── Workers ──────────────────────────────────────────────────────────────
  workers: envNum('WORKERS', 6),
  headless: envBool('HEADLESS', true),

  // ── Paths ─────────────────────────────────────────────────────────────────
  urlDir: URL_DIR,
  csvPath: discoverCsv(URL_DIR, CSV_FILE || undefined),
  outputDir: path.resolve(PROJECT_ROOT, env('OUTPUT_DIR', 'dataset')),
  checkpointDir: path.resolve(PROJECT_ROOT, env('CHECKPOINT_DIR', 'checkpoints')),
  logsDir: path.resolve(PROJECT_ROOT, env('LOGS_DIR', 'logs')),
  metadataDir: path.resolve(PROJECT_ROOT, env('METADATA_DIR', 'metadata')),
  reportsDir: path.resolve(PROJECT_ROOT, env('REPORTS_DIR', 'reports')),

  // ── Timeouts ──────────────────────────────────────────────────────────────
  pageTimeoutMs: envNum('PAGE_TIMEOUT_MS', 30_000),
  screenshotTimeoutMs: envNum('SCREENSHOT_TIMEOUT_MS', 15_000),
  networkIdleTimeoutMs: envNum('NETWORK_IDLE_TIMEOUT_MS', 10_000),

  // ── Retry ─────────────────────────────────────────────────────────────────
  maxRetries: envNum('MAX_RETRIES', 3),
  retryDelayMs: envNum('RETRY_DELAY_MS', 2_000),

  // ── Checkpointing ─────────────────────────────────────────────────────────
  checkpointInterval: envNum('CHECKPOINT_INTERVAL', 50),

  // ── Screenshot capture ────────────────────────────────────────────────────
  screenshotTypes: (['desktop', 'mobile', 'fullpage', 'above_fold'] as ScreenshotType[]).filter(
    (t) => {
      const map: Record<ScreenshotType, boolean> = {
        desktop: envBool('CAPTURE_DESKTOP', true),
        mobile: envBool('CAPTURE_MOBILE', true),
        fullpage: envBool('CAPTURE_FULLPAGE', true),
        above_fold: envBool('CAPTURE_ABOVEFOLD', true),
      };
      return map[t];
    },
  ),

  // ── Viewports ─────────────────────────────────────────────────────────────
  viewport: {
    desktop: { width: 1920, height: 1080 },
    mobile: { width: 390, height: 844 }, // iPhone 13
  },

  // ── Image quality thresholds ──────────────────────────────────────────────
  quality: {
    minWidth: envNum('MIN_WIDTH', 100),
    minHeight: envNum('MIN_HEIGHT', 100),
    maxBlankRatio: envNum('MAX_BLANK_RATIO', 0.98),
    duplicateHashThreshold: envNum('DUPLICATE_HASH_THRESHOLD', 10),
  },

  // ── Anti-detection ────────────────────────────────────────────────────────
  antiDetection: envBool('ANTI_DETECTION', true),

  // ── Limits ────────────────────────────────────────────────────────────────
  maxUrls: envNum('MAX_URLS', 0), // 0 = unlimited
  labelFilter: envNum('LABEL_FILTER', -1), // -1 = both

  // ── Dataset split ─────────────────────────────────────────────────────────
  datasetSplit: {
    train: envNum('SPLIT_TRAIN', 0.7),
    validation: envNum('SPLIT_VAL', 0.15),
    test: envNum('SPLIT_TEST', 0.15),
  },
} as const;

export type Config = typeof config;
