// ─────────────────────────────────────────────────────────────────────────────
//  Diversity-aware URL selector
//
//  Two independent selection pipelines:
//    selectLegitimateUrls  – industry-stratified, brand-aware selection
//    selectPhishingUrls    – impersonation-brand-capped, structural-dedup
//
//  Both pipelines mutate the `removed` array with full removal records so
//  the report writer can explain every decision.
// ─────────────────────────────────────────────────────────────────────────────

import { UrlRecord, RemovedRecord, RemovalReason, IndustryAllocation, BrandAllocation } from './types';
import { PRIORITY_BRANDS } from './brandClassifier';

// ── Tuning constants ──────────────────────────────────────────────────────────

/** Maximum URLs selected per apex domain (legitimate). */
const MAX_PER_APEX_LEGIT = 4;

/** Maximum URLs selected per known brand (legitimate). */
const MAX_PER_BRAND_LEGIT = 200;

/** Hard cap for any single industry bucket (legitimate). */
const MAX_PER_INDUSTRY = 900;

/** Minimum allocation per industry if it has at least this many URLs. */
const MIN_PER_INDUSTRY = 40;

/** Hard cap for any single impersonated brand (phishing). */
const MAX_PER_BRAND_PHISHING = 300;

/** Minimum allocation per phishing brand. */
const MIN_PER_BRAND_PHISHING = 20;

// ── Scoring ───────────────────────────────────────────────────────────────────

/**
 * Diversity score for a legitimate URL.
 * Range: [0, 1] — higher is more desirable.
 */
function scoreLegit(rec: UrlRecord): number {
  // Entropy: already normalised by CSV; typical max ~5.5, remap to [0,1]
  const entropyScore = Math.min(rec.entropy / 5.5, 1);
  // Prefer HTTPS
  const httpsBonus = rec.isHttps ? 0.08 : 0;
  // Prefer URLs with real paths (not just homepage)
  const pathBonus = rec.pathLen > 1 ? 0.06 : 0;
  // Penalty for IP-address domains (less useful visually)
  const ipPenalty = rec.isIp ? 0.2 : 0;
  // Prefer moderate URL length (too short = bare homepage, too long = tracking)
  const lenScore = urlLengthScore(rec.urlLen);

  return Math.max(0, 0.50 * entropyScore + 0.20 * lenScore + httpsBonus + pathBonus - ipPenalty);
}

/**
 * Diversity score for a phishing URL.
 * Range: [0, 1] — higher is more desirable.
 */
function scorePhish(rec: UrlRecord): number {
  const entropyScore = Math.min(rec.entropy / 5.5, 1);
  // HTTPS phishing pages are more sophisticated → prefer them
  const httpsBonus = rec.isHttps ? 0.10 : 0;
  // Prefer longer paths (actual phishing kit content)
  const pathBonus = rec.pathLen > 5 ? 0.08 : rec.pathLen > 1 ? 0.04 : 0;
  // Prefer URLs with query params (active kit parameters)
  const queryBonus = rec.queryLen > 0 ? 0.06 : 0;
  // Prefer non-IP domains (branded phishing pages)
  const ipPenalty = rec.isIp ? 0.25 : 0;
  const lenScore = urlLengthScore(rec.urlLen);

  return Math.max(0, 0.45 * entropyScore + 0.15 * lenScore + httpsBonus + pathBonus + queryBonus - ipPenalty);
}

/** Map URL length to a [0,1] score. Prefer 30–120 chars. */
function urlLengthScore(len: number): number {
  if (len < 15 || len > 300) return 0;
  if (len >= 30 && len <= 120) return 1;
  if (len < 30) return (len - 15) / 15;
  return Math.max(0, (300 - len) / 180);
}

// ── Internal utility ──────────────────────────────────────────────────────────

function pushRemoved(
  removed: RemovedRecord[],
  rec: UrlRecord,
  reason: RemovalReason,
  details: string,
): void {
  removed.push({
    url: rec.url,
    label: rec.label,
    domain: rec.apexDomain,
    brand: rec.brand,
    industry: rec.industry,
    reason,
    details,
  });
}

function countMap(map: Map<string, number>, key: string): number {
  return map.get(key) ?? 0;
}

function incMap(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

// ── Legitimate URL selection ──────────────────────────────────────────────────

export interface LegitimateSelectionResult {
  selected: UrlRecord[];
  industryAllocations: IndustryAllocation[];
}

/**
 * Select a diverse subset of legitimate URLs targeting `totalTarget` count.
 *
 * Strategy:
 *   1. Compute a diversity score for every URL.
 *   2. Allocate budget per industry proportionally (with floor/ceiling).
 *   3. Force-include at least one URL per priority brand.
 *   4. Within each industry, greedily pick highest-scoring URLs while
 *      respecting per-apex and per-brand caps.
 *   5. Backfill remaining quota from the highest-scored unused URLs.
 */
export function selectLegitimateUrls(
  urls: UrlRecord[],
  totalTarget: number,
  removed: RemovedRecord[],
): LegitimateSelectionResult {
  // ── 1. Score every URL ────────────────────────────────────────────────────
  urls.forEach((r) => { r.diversityScore = scoreLegit(r); });

  // ── 2. Group by industry ──────────────────────────────────────────────────
  const byIndustry = new Map<string, UrlRecord[]>();
  for (const rec of urls) {
    const list = byIndustry.get(rec.industry) ?? [];
    list.push(rec);
    byIndustry.set(rec.industry, list);
  }

  // Sort each bucket by score descending
  for (const [, list] of byIndustry) {
    list.sort((a, b) => b.diversityScore - a.diversityScore);
  }

  // ── 3. Compute per-industry allocations ───────────────────────────────────
  const total = urls.length;
  const allocations = new Map<string, number>();
  let sumRaw = 0;

  for (const [industry, list] of byIndustry) {
    const raw = Math.ceil((list.length / total) * totalTarget);
    const alloc = Math.min(Math.max(raw, MIN_PER_INDUSTRY), MAX_PER_INDUSTRY, list.length);
    allocations.set(industry, alloc);
    sumRaw += alloc;
  }

  // Normalise to hit totalTarget (scale proportionally if over/under)
  if (sumRaw !== totalTarget && sumRaw > 0) {
    const scale = totalTarget / sumRaw;
    let adjusted = 0;
    for (const [industry, alloc] of allocations) {
      const a = Math.min(Math.round(alloc * scale), byIndustry.get(industry)!.length);
      allocations.set(industry, a);
      adjusted += a;
    }
    // Fix rounding remainder on the largest industry
    const diff = totalTarget - adjusted;
    if (diff !== 0) {
      const largest = [...allocations.entries()].sort((a, b) => b[1] - a[1])[0];
      if (largest) allocations.set(largest[0], largest[1] + diff);
    }
  }

  // ── 4. Greedy per-industry selection ─────────────────────────────────────
  const selected: UrlRecord[] = [];
  const apexCount = new Map<string, number>();
  const brandCount = new Map<string, number>();
  const selectedSet = new Set<string>();

  // Force-include priority brands first (guaranteed ≥1 per brand)
  for (const [, list] of byIndustry) {
    for (const rec of list) {
      if (PRIORITY_BRANDS.has(rec.apexDomain) && !selectedSet.has(rec.url)) {
        selected.push(rec);
        selectedSet.add(rec.url);
        incMap(apexCount, rec.apexDomain);
        incMap(brandCount, rec.brand);
        break; // one per priority brand entry in this loop pass
      }
    }
  }

  // Industry-allocated pass
  for (const [industry, limit] of allocations) {
    const bucket = byIndustry.get(industry) ?? [];
    let taken = selected.filter((r) => r.industry === industry).length;

    for (const rec of bucket) {
      if (taken >= limit) break;
      if (selectedSet.has(rec.url)) continue;

      // Per-apex cap
      if (countMap(apexCount, rec.apexDomain) >= MAX_PER_APEX_LEGIT) {
        pushRemoved(removed, rec, 'industry_cap_exceeded',
          `Apex domain ${rec.apexDomain} already has ${MAX_PER_APEX_LEGIT} URLs selected`);
        continue;
      }

      // Per-brand cap
      if (rec.isKnownBrand && countMap(brandCount, rec.brand) >= MAX_PER_BRAND_LEGIT) {
        pushRemoved(removed, rec, 'brand_cap_exceeded',
          `Brand "${rec.brand}" already has ${MAX_PER_BRAND_LEGIT} legitimate URLs selected`);
        continue;
      }

      selected.push(rec);
      selectedSet.add(rec.url);
      incMap(apexCount, rec.apexDomain);
      incMap(brandCount, rec.brand);
      taken++;
    }

    // Mark remaining as not selected (industry cap)
    for (const rec of bucket) {
      if (!selectedSet.has(rec.url)) {
        if (taken >= limit) {
          pushRemoved(removed, rec, 'low_diversity_score',
            `Industry "${industry}" quota (${limit}) reached`);
        }
      }
    }
  }

  // ── 5. Backfill to hit totalTarget if still under ─────────────────────────
  if (selected.length < totalTarget) {
    const remaining = urls
      .filter((r) => !selectedSet.has(r.url))
      .sort((a, b) => b.diversityScore - a.diversityScore);

    for (const rec of remaining) {
      if (selected.length >= totalTarget) break;
      if (countMap(apexCount, rec.apexDomain) >= MAX_PER_APEX_LEGIT) continue;
      selected.push(rec);
      selectedSet.add(rec.url);
      incMap(apexCount, rec.apexDomain);
    }
  }

  // ── Build allocation summary ──────────────────────────────────────────────
  const selByIndustry = new Map<string, number>();
  for (const r of selected) incMap(selByIndustry, r.industry);

  const industryAllocations: IndustryAllocation[] = [];
  for (const [industry, list] of byIndustry) {
    industryAllocations.push({
      industry,
      total: list.length,
      allocated: allocations.get(industry) ?? 0,
      selected: selByIndustry.get(industry) ?? 0,
    });
  }
  industryAllocations.sort((a, b) => b.selected - a.selected);

  return { selected, industryAllocations };
}

// ── Phishing URL selection ────────────────────────────────────────────────────

export interface PhishingSelectionResult {
  selected: UrlRecord[];
  brandAllocations: BrandAllocation[];
}

/**
 * Select a diverse subset of phishing URLs targeting `totalTarget` count.
 *
 * Strategy:
 *   1. Score every phishing URL.
 *   2. Remove structural duplicates (same apex + path template + query keys).
 *   3. Group by impersonated brand.
 *   4. Compute adaptive per-brand cap: target / #brands, bounded [min, max].
 *   5. Within each brand: sort by score, cap per TLD, pick top allocated.
 *   6. Backfill remaining quota from highest-scored ungrouped URLs.
 */
export function selectPhishingUrls(
  urls: UrlRecord[],
  totalTarget: number,
  removed: RemovedRecord[],
): PhishingSelectionResult {
  // ── 1. Score ──────────────────────────────────────────────────────────────
  urls.forEach((r) => { r.diversityScore = scorePhish(r); });

  // ── 2. Structural deduplication ──────────────────────────────────────────
  const sigSeen = new Map<string, string>(); // signature → first URL
  const deduplicated: UrlRecord[] = [];

  for (const rec of urls.sort((a, b) => b.diversityScore - a.diversityScore)) {
    const sig = rec.structuralSignature;
    if (sigSeen.has(sig)) {
      pushRemoved(removed, rec, 'structural_duplicate',
        `Structural signature matches ${sigSeen.get(sig)}`);
    } else {
      sigSeen.set(sig, rec.url);
      deduplicated.push(rec);
    }
  }

  // ── 3. Group by impersonated brand ────────────────────────────────────────
  const byBrand = new Map<string, UrlRecord[]>();
  for (const rec of deduplicated) {
    const list = byBrand.get(rec.impersonatedBrand) ?? [];
    list.push(rec);
    byBrand.set(rec.impersonatedBrand, list);
  }

  // ── 4. Adaptive per-brand cap ─────────────────────────────────────────────
  const numBrands = byBrand.size;
  // Start with an even split, but respect hard limits.
  const rawPerBrand = numBrands > 0 ? Math.ceil(totalTarget / numBrands) : totalTarget;
  const perBrandCap = Math.min(Math.max(rawPerBrand, MIN_PER_BRAND_PHISHING), MAX_PER_BRAND_PHISHING);

  // ── 5. Brand-aware greedy selection ──────────────────────────────────────
  const selected: UrlRecord[] = [];
  const selectedSet = new Set<string>();
  const brandAllocations: BrandAllocation[] = [];

  for (const [brand, list] of byBrand) {
    // Within the brand: also cap per-TLD so no single TLD dominates
    const tldCount = new Map<string, number>();
    const maxPerTld = Math.max(3, Math.ceil(perBrandCap / 5));

    let taken = 0;
    for (const rec of list) {
      if (taken >= perBrandCap) break;
      const tldUsed = countMap(tldCount, rec.tld);
      if (tldUsed >= maxPerTld) {
        pushRemoved(removed, rec, 'low_diversity_score',
          `TLD "${rec.tld}" already has ${maxPerTld} entries for brand "${brand}"`);
        continue;
      }
      selected.push(rec);
      selectedSet.add(rec.url);
      incMap(tldCount, rec.tld);
      taken++;
    }

    // Mark remainder as brand-cap exceeded
    for (const rec of list) {
      if (!selectedSet.has(rec.url)) {
        pushRemoved(removed, rec, 'brand_cap_exceeded',
          `Brand "${brand}" cap of ${perBrandCap} reached`);
      }
    }

    brandAllocations.push({
      brand,
      total: list.length,
      allocated: perBrandCap,
      selected: taken,
    });
  }

  brandAllocations.sort((a, b) => b.selected - a.selected);

  // ── 6. Backfill if under quota ────────────────────────────────────────────
  if (selected.length < totalTarget) {
    const overflow = deduplicated
      .filter((r) => !selectedSet.has(r.url))
      .sort((a, b) => b.diversityScore - a.diversityScore);

    const tldCount = new Map<string, number>();
    for (const r of selected) incMap(tldCount, r.tld);

    for (const rec of overflow) {
      if (selected.length >= totalTarget) break;
      selected.push(rec);
      selectedSet.add(rec.url);
    }
  }

  // Trim to exact target if we overshot (priority brands could push us over)
  const trimmed = selected.slice(0, totalTarget);

  return { selected: trimmed, brandAllocations };
}
