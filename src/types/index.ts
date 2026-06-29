// ─────────────────────────────────────────────────────────────────────────────
//  Central type definitions for the phishing screenshot collection pipeline
// ─────────────────────────────────────────────────────────────────────────────

export type Label = 0 | 1; // 0 = legitimate, 1 = phishing
export type PageType =
  | 'homepage'
  | 'login'
  | 'signup'
  | 'checkout'
  | 'payment'
  | 'cart'
  | 'otp'
  | 'dashboard'
  | 'account'
  | 'profile'
  | 'forgot_password'
  | 'password_reset'
  | 'settings'
  | 'unknown';
export type ScreenshotType = 'desktop' | 'mobile' | 'fullpage' | 'above_fold';
export type FailureReason =
  | 'timeout'
  | 'dns_failure'
  | 'ssl_failure'
  | 'http_error'
  | 'redirect_loop'
  | 'captcha'
  | 'blank_page'
  | 'browser_crash'
  | 'network_error'
  | 'invalid_url'
  | 'image_quality'
  | 'unknown';

// ─── CSV Row as parsed from Mendeley dataset ─────────────────────────────────
export interface CsvRow {
  url: string;
  label: Label;
  url_len?: number;
  dom?: string;
  dom_len?: number;
  is_ip?: number;
  tld?: string;
  tld_len?: number;
  subdom_cnt?: number;
  letter_cnt?: number;
  digit_cnt?: number;
  special_cnt?: number;
  eq_cnt?: number;
  qm_cnt?: number;
  amp_cnt?: number;
  dot_cnt?: number;
  dash_cnt?: number;
  under_cnt?: number;
  letter_ratio?: number;
  digit_ratio?: number;
  spec_ratio?: number;
  is_https?: number;
  slash_cnt?: number;
  entropy?: number;
  path_len?: number;
  query_len?: number;
  [key: string]: string | number | undefined;
}

// ─── URL features stored as metadata extras ──────────────────────────────────
export type UrlFeatures = Omit<CsvRow, 'url' | 'label'>;

// ─── Queue item passed to workers ────────────────────────────────────────────
export interface QueueItem {
  url: string;
  label: Label;
  urlFeatures: UrlFeatures;
  source: 'csv' | 'curated';
  attemptNumber: number;
}

// ─── Viewport configuration ──────────────────────────────────────────────────
export interface Viewport {
  width: number;
  height: number;
}

// ─── Individual screenshot result ────────────────────────────────────────────
export interface ScreenshotResult {
  type: ScreenshotType;
  path: string;
  width: number;
  height: number;
  fileSize: number;
  hash: string;
  isBlank: boolean;
  isCaptcha: boolean;
  isError: boolean;
}

// ─── Navigation result ───────────────────────────────────────────────────────
export interface NavigationResult {
  finalUrl: string;
  statusCode: number;
  redirectChain: string[];
  pageTitle: string;
  loadTimeMs: number;
  hasSSLError: boolean;
  isParkedDomain: boolean;
  isCaptcha: boolean;
  isErrorPage: boolean;
  openGraphData: OpenGraphData;
}

export interface OpenGraphData {
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;
}

// ─── Brand information ───────────────────────────────────────────────────────
export interface BrandInfo {
  name: string;
  normalizedName: string;
  confidence: 'high' | 'medium' | 'low';
  source: 'domain_map' | 'og_tag' | 'page_title' | 'favicon' | 'generic';
}

// ─── Per-screenshot metadata entry ───────────────────────────────────────────
export interface ScreenshotMetadata {
  id: string;
  url: string;
  finalUrl: string;
  label: Label;
  labelName: 'legitimate' | 'phishing';
  brand: string;
  brandNormalized: string;
  pageType: PageType;
  screenshotType: ScreenshotType;
  screenshotPath: string;
  relativePath: string;
  title: string;
  timestamp: string;
  viewportWidth: number;
  viewportHeight: number;
  statusCode: number;
  redirectCount: number;
  pageLoadTimeMs: number;
  fileSizeBytes: number;
  imageWidth: number;
  imageHeight: number;
  imageHash: string;
  isBlank: boolean;
  isCaptcha: boolean;
  isErrorPage: boolean;
  source: 'csv' | 'curated';
  urlFeatures: UrlFeatures;
}

// ─── Process result returned by each worker task ─────────────────────────────
export interface ProcessResult {
  success: boolean;
  url: string;
  screenshots: ScreenshotMetadata[];
  failureReason?: FailureReason;
  errorMessage?: string;
  statusCode?: number;
  durationMs: number;
}

// ─── Checkpoint state persisted to disk ──────────────────────────────────────
export interface CheckpointState {
  processedUrls: string[];
  failedUrls: string[];
  startedAt: string;
  lastCheckpointAt: string;
  totalProcessed: number;
  totalFailed: number;
  totalScreenshots: number;
}

// ─── Progress stats for display ──────────────────────────────────────────────
export interface ProgressStats {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  screenshots: number;
  startTime: number;
  currentUrl?: string;
}

// ─── Failed URL log entry ─────────────────────────────────────────────────────
export interface FailedUrlEntry {
  url: string;
  label: Label;
  reason: FailureReason;
  statusCode?: number;
  errorMessage: string;
  timestamp: string;
  attempt: number;
}

// ─── Invalid URL log entry ────────────────────────────────────────────────────
export interface InvalidUrlEntry {
  originalUrl: string;
  reason: string;
  rowNumber: number;
  rawValue: string;
}

// ─── Discovered page link ─────────────────────────────────────────────────────
export interface DiscoveredPage {
  url: string;
  pageType: PageType;
  linkText: string;
}

// ─── Dataset split manifest ───────────────────────────────────────────────────
export interface DatasetSplit {
  train: ScreenshotMetadata[];
  validation: ScreenshotMetadata[];
  test: ScreenshotMetadata[];
}

// ─── Dataset statistics ───────────────────────────────────────────────────────
export interface DatasetStats {
  totalUrls: number;
  visitedUrls: number;
  successfulUrls: number;
  failedUrls: number;
  legitimateScreenshots: number;
  phishingScreenshots: number;
  totalScreenshots: number;
  uniqueBrands: number;
  pageTypeCounts: Record<PageType, number>;
  screenshotTypeCounts: Record<ScreenshotType, number>;
  avgResolutionWidth: number;
  avgResolutionHeight: number;
  avgLoadTimeMs: number;
  duplicatesRemoved: number;
  blanksRemoved: number;
  failureReasons: Record<FailureReason, number>;
  brandDistribution: Record<string, number>;
  generatedAt: string;
}

// ─── Curated URL entry ────────────────────────────────────────────────────────
export interface CuratedUrl {
  url: string;
  brand: string;
  category: 'global' | 'banking' | 'government' | 'education';
  label: 0;
}
