// ─────────────────────────────────────────────────────────────────────────────
//  Report writer for the dataset reduction pipeline
//
//  Outputs:
//    selected_dataset.csv      — CSV with same schema as Dataset.csv
//    removed_dataset.csv       — Removed URLs with reason
//    dataset_statistics.json   — Full stats as JSON
//    dataset_statistics.md     — Human-readable Markdown
//    selection_report.md       — Detailed narrative report
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import { createObjectCsvWriter } from 'csv-writer';
import { UrlRecord, RemovedRecord, ReductionStats, IndustryAllocation, BrandAllocation } from './types';
import { regionFromTld } from './urlFilter';

// ── Public entry points ───────────────────────────────────────────────────────

/** Write selected_dataset.csv using the raw CSV row from each record. */
export async function writeSelectedCsv(
  records: UrlRecord[],
  outputPath: string,
): Promise<void> {
  ensureDir(path.dirname(outputPath));

  const CSV_HEADERS = [
    'url', 'url_len', 'dom', 'dom_len', 'is_ip', 'tld', 'tld_len',
    'subdom_cnt', 'letter_cnt', 'digit_cnt', 'special_cnt', 'eq_cnt',
    'qm_cnt', 'amp_cnt', 'dot_cnt', 'dash_cnt', 'under_cnt',
    'letter_ratio', 'digit_ratio', 'spec_ratio', 'is_https', 'slash_cnt',
    'entropy', 'path_len', 'query_len', 'label',
  ];

  const writer = createObjectCsvWriter({
    path: outputPath,
    header: CSV_HEADERS.map((h) => ({ id: h, title: h })),
    append: false,
  });

  await writer.writeRecords(records.map((r) => r.raw));
}

/** Write removed_dataset.csv with removal reasons. */
export async function writeRemovedCsv(
  removed: RemovedRecord[],
  outputPath: string,
): Promise<void> {
  ensureDir(path.dirname(outputPath));

  const writer = createObjectCsvWriter({
    path: outputPath,
    header: [
      { id: 'url',      title: 'url' },
      { id: 'label',    title: 'label' },
      { id: 'domain',   title: 'domain' },
      { id: 'brand',    title: 'brand' },
      { id: 'industry', title: 'industry' },
      { id: 'reason',   title: 'reason' },
      { id: 'details',  title: 'details' },
    ],
    append: false,
  });

  await writer.writeRecords(removed);
}

// ── Statistics computation ────────────────────────────────────────────────────

/** Compute full ReductionStats from selected and removed URL lists. */
export function computeStats(
  selected: UrlRecord[],
  removed: RemovedRecord[],
  industryAllocations: IndustryAllocation[],
  brandAllocations: BrandAllocation[],
  originalLegitimate: number,
  originalPhishing: number,
): ReductionStats {
  const legit = selected.filter((r) => r.label === 0);
  const phish = selected.filter((r) => r.label === 1);

  // ── Removal reasons ───────────────────────────────────────────────────────
  const removalReasons: Record<string, number> = {};
  for (const r of removed) {
    removalReasons[r.reason] = (removalReasons[r.reason] ?? 0) + 1;
  }

  // ── Legitimate distributions ──────────────────────────────────────────────
  const brandDistLegit = topN(countBy(legit, (r) => r.brand), 30);
  const tldDistLegit   = topN(countBy(legit, (r) => r.tld), 30);

  const apexDomainsLegit = new Set(legit.map((r) => r.apexDomain));
  const tldsLegit        = new Set(legit.map((r) => r.tld));

  const avgEntropyLegit = avg(legit.map((r) => r.entropy));
  const avgUrlLenLegit  = avg(legit.map((r) => r.urlLen));
  const httpsRateLegit  = legit.length > 0
    ? legit.filter((r) => r.isHttps).length / legit.length
    : 0;

  // ── Phishing distributions ────────────────────────────────────────────────
  const tldDistPhish   = topN(countBy(phish, (r) => r.tld), 30);

  const apexDomainsPhish = new Set(phish.map((r) => r.apexDomain));
  const tldsPhish        = new Set(phish.map((r) => r.tld));

  const avgEntropyPhish = avg(phish.map((r) => r.entropy));
  const avgUrlLenPhish  = avg(phish.map((r) => r.urlLen));
  const httpsRatePhish  = phish.length > 0
    ? phish.filter((r) => r.isHttps).length / phish.length
    : 0;

  // Top phishing targets
  const phishBrandCounts = countBy(phish, (r) => r.impersonatedBrand || r.brand);
  const topPhishingTargets = Object.entries(phishBrandCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([brand, count]) => ({
      brand,
      count,
      percentage: phish.length > 0 ? parseFloat(((count / phish.length) * 100).toFixed(1)) : 0,
    }));

  return {
    generatedAt: new Date().toISOString(),
    originalCount: originalLegitimate + originalPhishing,
    originalLegitimate,
    originalPhishing,
    selectedCount: selected.length,
    selectedLegitimate: legit.length,
    selectedPhishing: phish.length,
    removedCount: removed.length,
    removalReasons,
    industryAllocations,
    brandDistributionLegitimate: brandDistLegit,
    tldDistributionLegitimate: tldDistLegit,
    uniqueDomainsLegitimate: apexDomainsLegit.size,
    uniqueTldsLegitimate: tldsLegit.size,
    httpsRateLegitimate: parseFloat((httpsRateLegit * 100).toFixed(1)),
    avgEntropyLegitimate: parseFloat(avgEntropyLegit.toFixed(3)),
    avgUrlLengthLegitimate: parseFloat(avgUrlLenLegit.toFixed(1)),
    brandAllocations,
    tldDistributionPhishing: tldDistPhish,
    uniqueDomainsPhishing: apexDomainsPhish.size,
    uniqueTldsPhishing: tldsPhish.size,
    httpsRatePhishing: parseFloat((httpsRatePhish * 100).toFixed(1)),
    avgEntropyPhishing: parseFloat(avgEntropyPhish.toFixed(3)),
    avgUrlLengthPhishing: parseFloat(avgUrlLenPhish.toFixed(1)),
    topPhishingTargets,
  };
}

// ── JSON / Markdown writers ───────────────────────────────────────────────────

export function writeStatisticsJson(stats: ReductionStats, outputPath: string): void {
  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, JSON.stringify(stats, null, 2), 'utf8');
}

export function writeStatisticsMd(stats: ReductionStats, outputPath: string): void {
  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, buildStatsMd(stats), 'utf8');
}

export function writeSelectionReport(stats: ReductionStats, outputPath: string): void {
  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, buildSelectionReport(stats), 'utf8');
}

// ── Markdown builders ─────────────────────────────────────────────────────────

function buildStatsMd(s: ReductionStats): string {
  const reductionPct = ((s.removedCount / s.originalCount) * 100).toFixed(1);

  const industryRows = s.industryAllocations
    .slice(0, 20)
    .map((i) => `| ${i.industry} | ${i.total.toLocaleString()} | ${i.allocated} | ${i.selected} |`)
    .join('\n');

  const phishBrandRows = s.brandAllocations
    .slice(0, 20)
    .map((b) => `| ${b.brand} | ${b.total} | ${b.allocated} | ${b.selected} |`)
    .join('\n');

  const tldLegitRows = Object.entries(s.tldDistributionLegitimate)
    .slice(0, 15)
    .map(([tld, count]) => `| .${tld} | ${count} | ${regionFromTld(tld)} |`)
    .join('\n');

  const tldPhishRows = Object.entries(s.tldDistributionPhishing)
    .slice(0, 15)
    .map(([tld, count]) => `| .${tld} | ${count} |`)
    .join('\n');

  const phishTargetRows = s.topPhishingTargets
    .slice(0, 15)
    .map((t) => `| ${t.brand} | ${t.count} | ${t.percentage}% |`)
    .join('\n');

  return `# Dataset Statistics — Reduction Pipeline

Generated: ${s.generatedAt}

## Overview

| Metric | Value |
|--------|-------|
| Original URLs | ${s.originalCount.toLocaleString()} |
| Original Legitimate | ${s.originalLegitimate.toLocaleString()} |
| Original Phishing | ${s.originalPhishing.toLocaleString()} |
| **Selected URLs** | **${s.selectedCount.toLocaleString()}** |
| Selected Legitimate | ${s.selectedLegitimate.toLocaleString()} |
| Selected Phishing | ${s.selectedPhishing.toLocaleString()} |
| Removed URLs | ${s.removedCount.toLocaleString()} |
| Reduction | ${reductionPct}% |

## Removal Reasons

| Reason | Count |
|--------|-------|
${Object.entries(s.removalReasons)
  .sort((a, b) => b[1] - a[1])
  .map(([r, c]) => `| ${r} | ${c.toLocaleString()} |`)
  .join('\n')}

## Legitimate URLs

| Metric | Value |
|--------|-------|
| Count | ${s.selectedLegitimate.toLocaleString()} |
| Unique Domains | ${s.uniqueDomainsLegitimate.toLocaleString()} |
| Unique TLDs | ${s.uniqueTldsLegitimate} |
| HTTPS Rate | ${s.httpsRateLegitimate}% |
| Avg Entropy | ${s.avgEntropyLegitimate} |
| Avg URL Length | ${s.avgUrlLengthLegitimate} chars |

### Industry Allocation (Top 20)

| Industry | Total | Allocated | Selected |
|----------|-------|-----------|----------|
${industryRows}

### TLD Distribution — Legitimate (Top 15)

| TLD | Count | Region |
|-----|-------|--------|
${tldLegitRows}

## Phishing URLs

| Metric | Value |
|--------|-------|
| Count | ${s.selectedPhishing.toLocaleString()} |
| Unique Domains | ${s.uniqueDomainsPhishing.toLocaleString()} |
| Unique TLDs | ${s.uniqueTldsPhishing} |
| HTTPS Rate | ${s.httpsRatePhishing}% |
| Avg Entropy | ${s.avgEntropyPhishing} |
| Avg URL Length | ${s.avgUrlLengthPhishing} chars |

### Top Phishing Targets (Impersonated Brands)

| Brand | Count | % of Phishing |
|-------|-------|---------------|
${phishTargetRows}

### Brand Allocation — Phishing (Top 20)

| Brand | Total | Cap | Selected |
|-------|-------|-----|----------|
${phishBrandRows}

### TLD Distribution — Phishing (Top 15)

| TLD | Count |
|-----|-------|
${tldPhishRows}
`;
}

function buildSelectionReport(s: ReductionStats): string {
  const reductionPct = ((s.removedCount / s.originalCount) * 100).toFixed(1);
  const legitPct = ((s.selectedLegitimate / s.selectedCount) * 100).toFixed(1);
  const phishPct = ((s.selectedPhishing / s.selectedCount) * 100).toFixed(1);

  const topPhish = s.topPhishingTargets
    .slice(0, 10)
    .map((t, i) => `  ${i + 1}. **${t.brand}** — ${t.count} URLs (${t.percentage}%)`)
    .join('\n');

  const industryBreakdown = s.industryAllocations
    .slice(0, 12)
    .map((i) => `  - **${i.industry}**: ${i.selected} selected from ${i.total.toLocaleString()} available`)
    .join('\n');

  const removalBreakdown = Object.entries(s.removalReasons)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `  - \`${reason}\`: ${count.toLocaleString()} URLs`)
    .join('\n');

  return `# Dataset Selection Report

Generated: ${s.generatedAt}

## Executive Summary

The diversity-aware reduction pipeline processed **${s.originalCount.toLocaleString()} URLs**
from the Mendeley URL-Phish dataset and selected a final training corpus of
**${s.selectedCount.toLocaleString()} URLs** — a ${reductionPct}% reduction.

The goal was not random sampling.  Every selection decision maximised:
- Brand diversity (known brands always preserved)
- Industry coverage (stratified allocation)
- TLD / geographic diversity
- URL structural variety (entropy, path complexity)
- Phishing-kit diversity (structural deduplication)

---

## Dataset Composition

| Label | Count | Share |
|-------|-------|-------|
| Legitimate | ${s.selectedLegitimate.toLocaleString()} | ${legitPct}% |
| Phishing   | ${s.selectedPhishing.toLocaleString()} | ${phishPct}% |
| **Total**  | **${s.selectedCount.toLocaleString()}** | 100% |

---

## Original Dataset

| Label | Count |
|-------|-------|
| Legitimate | ${s.originalLegitimate.toLocaleString()} |
| Phishing   | ${s.originalPhishing.toLocaleString()} |
| Total      | ${s.originalCount.toLocaleString()} |

---

## URLs Removed (${s.removedCount.toLocaleString()} total — ${reductionPct}% of original)

${removalBreakdown}

---

## Legitimate URL Strategy

### Selection Method

Legitimate URLs were selected via **industry-stratified proportional allocation**:

1. Every URL was scored on: entropy, URL length, HTTPS, path depth.
2. Priority brands (Google, Microsoft, Apple, Amazon, Indian banks, government portals, universities, etc.) received **guaranteed representation** — at least one URL per brand was force-included.
3. Remaining budget was distributed proportionally across **${s.industryAllocations.length} industry categories**.
4. Within each industry, greedy selection respected:
   - Max **4 URLs per apex domain** (prevents domain clustering)
   - Max **200 URLs per known brand** (prevents brand monopoly)

### Industry Coverage

${industryBreakdown}

### Quality Metrics

| Metric | Value |
|--------|-------|
| Unique apex domains | ${s.uniqueDomainsLegitimate.toLocaleString()} |
| Unique TLDs | ${s.uniqueTldsLegitimate} |
| HTTPS coverage | ${s.httpsRateLegitimate}% |
| Average Shannon entropy | ${s.avgEntropyLegitimate} |
| Average URL length | ${s.avgUrlLengthLegitimate} chars |

---

## Phishing URL Strategy

### Selection Method

Phishing URLs were selected via **impersonated-brand-capped structural deduplication**:

1. Every phishing URL was scored on: entropy, HTTPS, path depth, query complexity.
2. **Structural deduplication** collapsed phishing-kit clones — URLs sharing the same apex domain + path template + query parameter names (with all variable tokens masked).
3. URLs were grouped by **impersonated brand** (${s.brandAllocations.length} brands detected).
4. An adaptive per-brand cap was applied so no single brand dominates.
5. Within each brand, a **per-TLD cap** ensured geographic diversity.

### Top 10 Phishing Targets

${topPhish}

### Quality Metrics

| Metric | Value |
|--------|-------|
| Unique apex domains | ${s.uniqueDomainsPhishing.toLocaleString()} |
| Unique TLDs | ${s.uniqueTldsPhishing} |
| HTTPS phishing pages | ${s.httpsRatePhishing}% |
| Average Shannon entropy | ${s.avgEntropyPhishing} |
| Average URL length | ${s.avgUrlLengthPhishing} chars |

---

## Diversity Metrics Comparison

| Metric | Legitimate | Phishing |
|--------|-----------|---------|
| Unique Domains | ${s.uniqueDomainsLegitimate.toLocaleString()} | ${s.uniqueDomainsPhishing.toLocaleString()} |
| Unique TLDs | ${s.uniqueTldsLegitimate} | ${s.uniqueTldsPhishing} |
| HTTPS Rate | ${s.httpsRateLegitimate}% | ${s.httpsRatePhishing}% |
| Avg Entropy | ${s.avgEntropyLegitimate} | ${s.avgEntropyPhishing} |
| Avg URL Length | ${s.avgUrlLengthLegitimate} | ${s.avgUrlLengthPhishing} |

---

## Pipeline Integration

The output file \`url/selected_dataset.csv\` is a direct drop-in replacement for
the original \`Dataset.csv\`.  It uses the identical 26-column schema and will be
auto-discovered by the Playwright collection pipeline because its filename sorts
before the original dataset in the \`url/\` directory walk.

No configuration changes are required to use \`selected_dataset.csv\`.

---

*Generated by the phishing-screenshot-collector dataset reduction pipeline.*
`;
}

// ── Utility ───────────────────────────────────────────────────────────────────

function countBy<T>(arr: T[], keyFn: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of arr) {
    const k = keyFn(item);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

function topN(counts: Record<string, number>, n: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n),
  );
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}
