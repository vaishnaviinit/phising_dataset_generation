// ─────────────────────────────────────────────────────────────────────────────
//  Types for the dataset reduction / diversity-selection pipeline
// ─────────────────────────────────────────────────────────────────────────────

/** Raw CSV row exactly as parsed from Dataset.csv (all string values). */
export interface RawCsvRow {
  url: string;
  url_len: string;
  dom: string;
  dom_len: string;
  is_ip: string;
  tld: string;
  tld_len: string;
  subdom_cnt: string;
  letter_cnt: string;
  digit_cnt: string;
  special_cnt: string;
  eq_cnt: string;
  qm_cnt: string;
  amp_cnt: string;
  dot_cnt: string;
  dash_cnt: string;
  under_cnt: string;
  letter_ratio: string;
  digit_ratio: string;
  spec_ratio: string;
  is_https: string;
  slash_cnt: string;
  entropy: string;
  path_len: string;
  query_len: string;
  label: string;
  [key: string]: string;
}

/** Why a URL was removed from the final dataset. */
export type RemovalReason =
  | 'exact_duplicate'
  | 'url_shortener'
  | 'tracking_url'
  | 'ip_address_domain'
  | 'structural_duplicate'
  | 'brand_cap_exceeded'
  | 'industry_cap_exceeded'
  | 'low_diversity_score'
  | 'parking_domain'
  | 'redirect_chain'
  | 'blocked_domain';

/** Parsed, enriched URL record used throughout the selection pipeline. */
export interface UrlRecord {
  /** Original raw CSV row (preserved so we can write it to selected_dataset.csv unchanged). */
  raw: RawCsvRow;
  /** Normalised URL (lowercase scheme+host, trailing slash removed). */
  url: string;
  /** Apex domain derived from the dom field, e.g. "hdfcbank.com". */
  apexDomain: string;
  /** TLD as provided by the CSV, e.g. "co.uk", "edu.au", "gov.in". */
  tld: string;
  /** 0 = legitimate, 1 = phishing. */
  label: 0 | 1;
  /** Detected brand name (legitimate) or generic industry label. */
  brand: string;
  /** Broad industry category. */
  industry: string;
  /** For phishing URLs: the brand being impersonated (e.g. "PayPal"). */
  impersonatedBrand: string;
  /** True if domain matches a curated known-brand list. */
  isKnownBrand: boolean;
  // ── Pre-parsed numeric features (from CSV columns) ───────────────────────
  isIp: boolean;
  isHttps: boolean;
  entropy: number;
  urlLen: number;
  pathLen: number;
  queryLen: number;
  dashCnt: number;
  digitCnt: number;
  subdomCnt: number;
  // ── Computed fields ───────────────────────────────────────────────────────
  /** Canonical path+query template used to detect phishing-kit clones. */
  structuralSignature: string;
  /** Composite diversity score in [0, 1] used to rank candidates. */
  diversityScore: number;
}

/** Record of a URL that was excluded, with the reason. */
export interface RemovedRecord {
  url: string;
  label: number;
  domain: string;
  brand: string;
  industry: string;
  reason: RemovalReason;
  details: string;
}

/** Per-brand selection summary (phishing). */
export interface BrandAllocation {
  brand: string;
  total: number;
  allocated: number;
  selected: number;
}

/** Per-industry selection summary (legitimate). */
export interface IndustryAllocation {
  industry: string;
  total: number;
  allocated: number;
  selected: number;
}

/** Complete statistics emitted as JSON / Markdown reports. */
export interface ReductionStats {
  generatedAt: string;
  // ── Overall counts ────────────────────────────────────────────────────────
  originalCount: number;
  originalLegitimate: number;
  originalPhishing: number;
  selectedCount: number;
  selectedLegitimate: number;
  selectedPhishing: number;
  removedCount: number;
  removalReasons: Record<string, number>;
  // ── Legitimate URL breakdown ──────────────────────────────────────────────
  industryAllocations: IndustryAllocation[];
  brandDistributionLegitimate: Record<string, number>;
  tldDistributionLegitimate: Record<string, number>;
  uniqueDomainsLegitimate: number;
  uniqueTldsLegitimate: number;
  httpsRateLegitimate: number;
  avgEntropyLegitimate: number;
  avgUrlLengthLegitimate: number;
  // ── Phishing URL breakdown ────────────────────────────────────────────────
  brandAllocations: BrandAllocation[];
  tldDistributionPhishing: Record<string, number>;
  uniqueDomainsPhishing: number;
  uniqueTldsPhishing: number;
  httpsRatePhishing: number;
  avgEntropyPhishing: number;
  avgUrlLengthPhishing: number;
  topPhishingTargets: Array<{ brand: string; count: number; percentage: number }>;
}
