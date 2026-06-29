// ─────────────────────────────────────────────────────────────────────────────
//  reduceDataset.ts  —  Dataset diversity-reduction CLI script
//
//  Usage:
//    npx ts-node src/scripts/reduceDataset.ts [options]
//
//  Options:
//    --legit-target  <n>   Target count for legitimate URLs  (default: 5000)
//    --phish-target  <n>   Target count for phishing URLs    (default: 5000)
//    --csv-path      <p>   Override input CSV path
//
//  Outputs (written without modifying the original Dataset.csv):
//    url/selected_dataset.csv        — final curated dataset (pipeline-ready)
//    url/removed_dataset.csv         — excluded URLs with reasons
//    reports/dataset_statistics.json
//    reports/dataset_statistics.md
//    reports/selection_report.md
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse';
import { logger } from '../logger';
import { config, PROJECT_ROOT } from '../config';
import {
  RawCsvRow,
  UrlRecord,
  RemovedRecord,
  RemovalReason,
} from '../reduction/types';
import { classify, extractApexDomain } from '../reduction/brandClassifier';
import {
  isUrlShortener,
  isTrackingUrl,
  isRedirectChain,
  isParkingDomain,
  computeStructuralSignature,
} from '../reduction/urlFilter';
import {
  selectLegitimateUrls,
  selectPhishingUrls,
} from '../reduction/diversitySelector';
import {
  computeStats,
  writeSelectedCsv,
  writeRemovedCsv,
  writeStatisticsJson,
  writeStatisticsMd,
  writeSelectionReport,
} from '../reduction/reportWriter';

// ── CLI argument parsing ──────────────────────────────────────────────────────

function parseArgs(): { legitTarget: number; phishTarget: number; csvPath: string } {
  const args = process.argv.slice(2);
  let legitTarget = 5_000;
  let phishTarget = 5_000;
  let csvPath = config.csvPath;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--legit-target' && args[i + 1]) {
      legitTarget = parseInt(args[++i]!, 10);
    } else if (args[i] === '--phish-target' && args[i + 1]) {
      phishTarget = parseInt(args[++i]!, 10);
    } else if (args[i] === '--csv-path' && args[i + 1]) {
      csvPath = args[++i]!;
    }
  }

  return { legitTarget, phishTarget, csvPath };
}

// ── CSV streaming parser ──────────────────────────────────────────────────────

/** Stream-parse the Mendeley CSV, returning all valid rows. */
async function parseCsv(csvPath: string): Promise<RawCsvRow[]> {
  logger.info(`Parsing CSV: ${csvPath}`);

  return new Promise<RawCsvRow[]>((resolve, reject) => {
    const rows: RawCsvRow[] = [];
    const stream = fs.createReadStream(csvPath, { encoding: 'utf8' });
    const parser = parse({ columns: true, skip_empty_lines: true, trim: true });

    parser.on('data', (row: RawCsvRow) => {
      if (row.url && row.label) rows.push(row);
    });
    parser.on('end', () => resolve(rows));
    parser.on('error', reject);
    stream.on('error', reject);
    stream.pipe(parser);
  });
}

// ── URL enrichment ────────────────────────────────────────────────────────────

/** Parse numeric CSV column, returning 0 if absent or NaN. */
function num(val: string | undefined): number {
  const n = parseFloat(val ?? '0');
  return isNaN(n) ? 0 : n;
}

/** Convert a raw CSV row into a fully-enriched UrlRecord. */
function enrichRow(raw: RawCsvRow): UrlRecord | null {
  const labelRaw = parseInt(raw.label, 10);
  if (labelRaw !== 0 && labelRaw !== 1) return null;

  const url = raw.url?.trim();
  if (!url) return null;

  // Basic URL validation
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const label = labelRaw as 0 | 1;
  const dom   = raw.dom ?? parsed.hostname.replace(/^www\./, '');
  const tld   = raw.tld ?? '';

  const apexDomain = extractApexDomain(dom, tld);
  const classification = classify(apexDomain, tld, url, label);

  // Structural signature (mainly useful for phishing dedup)
  const sig = label === 1
    ? computeStructuralSignature(url, apexDomain)
    : `${apexDomain}${parsed.pathname.slice(0, 80)}`;

  return {
    raw,
    url,
    apexDomain,
    tld,
    label,
    brand:            classification.brand,
    industry:         classification.industry,
    impersonatedBrand: classification.impersonatedBrand,
    isKnownBrand:     classification.isKnownBrand,
    isIp:             raw.is_ip === '1',
    isHttps:          url.startsWith('https://'),
    entropy:          num(raw.entropy),
    urlLen:           num(raw.url_len) || url.length,
    pathLen:          num(raw.path_len),
    queryLen:         num(raw.query_len),
    dashCnt:          num(raw.dash_cnt),
    digitCnt:         num(raw.digit_cnt),
    subdomCnt:        num(raw.subdom_cnt),
    structuralSignature: sig,
    diversityScore:   0, // computed by selectors
  };
}

// ── Junk filter ───────────────────────────────────────────────────────────────

interface FilterResult {
  clean: UrlRecord[];
  removed: RemovedRecord[];
}

/**
 * Remove obviously low-quality URLs before diversity selection:
 *   - Exact URL duplicates (normalised)
 *   - URL shorteners
 *   - Tracking links
 *   - IP-address domains
 *   - Parking / placeholder pages (legitimate only)
 *   - Redirect chains
 */
function filterJunk(records: UrlRecord[]): FilterResult {
  const clean: UrlRecord[] = [];
  const removed: RemovedRecord[] = [];
  const seen = new Set<string>();

  for (const rec of records) {
    const removeWith = (reason: RemovalReason, details: string): void => {
      removed.push({ url: rec.url, label: rec.label, domain: rec.apexDomain,
        brand: rec.brand, industry: rec.industry, reason, details });
    };

    // Exact duplicate
    if (seen.has(rec.url)) {
      removeWith('exact_duplicate', 'Normalised URL seen before');
      continue;
    }
    seen.add(rec.url);

    // URL shortener
    if (isUrlShortener(rec.apexDomain)) {
      removeWith('url_shortener', `${rec.apexDomain} is a known URL-shortener domain`);
      continue;
    }

    // IP-address domain
    if (rec.isIp) {
      removeWith('ip_address_domain', 'Domain is a raw IP address');
      continue;
    }

    // Tracking link (too many tracking params)
    if (isTrackingUrl(rec.url)) {
      removeWith('tracking_url', 'URL contains predominantly tracking query parameters');
      continue;
    }

    // Redirect chain entry point
    if (isRedirectChain(rec.url)) {
      removeWith('redirect_chain', 'URL contains a redirect/return parameter pointing to another URL');
      continue;
    }

    // Parking domain (legitimate only — phishing pages might look like parking)
    if (rec.label === 0 && isParkingDomain(rec.apexDomain, rec.pathLen, rec.queryLen)) {
      removeWith('parking_domain', 'Domain appears to be a parked / placeholder page');
      continue;
    }

    clean.push(rec);
  }

  return { clean, removed };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { legitTarget, phishTarget, csvPath } = parseArgs();

  logger.info('═══════════════════════════════════════════════════════');
  logger.info('  Dataset Reduction Pipeline — Diversity Selection');
  logger.info('═══════════════════════════════════════════════════════');
  logger.info(`Input CSV      : ${csvPath}`);
  logger.info(`Target legit   : ${legitTarget.toLocaleString()}`);
  logger.info(`Target phishing: ${phishTarget.toLocaleString()}`);

  // ── 1. Parse CSV ──────────────────────────────────────────────────────────
  const rawRows = await parseCsv(csvPath);
  logger.info(`Parsed ${rawRows.length.toLocaleString()} raw rows`);

  // ── 2. Enrich rows ────────────────────────────────────────────────────────
  const allRecords: UrlRecord[] = [];
  let enrichFailures = 0;
  for (const raw of rawRows) {
    const rec = enrichRow(raw);
    if (rec) {
      allRecords.push(rec);
    } else {
      enrichFailures++;
    }
  }
  logger.info(`Enriched ${allRecords.length.toLocaleString()} records (${enrichFailures} skipped)`);

  const originalLegitimate = allRecords.filter((r) => r.label === 0).length;
  const originalPhishing   = allRecords.filter((r) => r.label === 1).length;
  logger.info(`Legitimate: ${originalLegitimate.toLocaleString()} | Phishing: ${originalPhishing.toLocaleString()}`);

  // ── 3. Junk filter ────────────────────────────────────────────────────────
  const { clean, removed: junkRemoved } = filterJunk(allRecords);
  logger.info(`After junk filter: ${clean.length.toLocaleString()} clean (${junkRemoved.length.toLocaleString()} removed)`);

  const cleanLegit = clean.filter((r) => r.label === 0);
  const cleanPhish = clean.filter((r) => r.label === 1);
  logger.info(`Clean legit: ${cleanLegit.length.toLocaleString()} | Clean phishing: ${cleanPhish.length.toLocaleString()}`);

  // ── 4. Legitimate diversity selection ─────────────────────────────────────
  logger.info(`Selecting ${legitTarget.toLocaleString()} legitimate URLs …`);
  const removedLegit: RemovedRecord[] = [];
  const { selected: selectedLegit, industryAllocations } =
    selectLegitimateUrls(cleanLegit, legitTarget, removedLegit);
  logger.info(`Selected ${selectedLegit.length.toLocaleString()} legitimate URLs`);

  // Mark unselected legit as low_diversity_score
  const selectedLegitSet = new Set(selectedLegit.map((r) => r.url));
  for (const rec of cleanLegit) {
    if (!selectedLegitSet.has(rec.url) && !removedLegit.find((r) => r.url === rec.url)) {
      removedLegit.push({
        url: rec.url, label: 0, domain: rec.apexDomain,
        brand: rec.brand, industry: rec.industry,
        reason: 'low_diversity_score',
        details: 'Not selected during diversity-stratified allocation',
      });
    }
  }

  // ── 5. Phishing diversity selection ──────────────────────────────────────
  logger.info(`Selecting ${phishTarget.toLocaleString()} phishing URLs …`);
  const removedPhish: RemovedRecord[] = [];
  const { selected: selectedPhish, brandAllocations } =
    selectPhishingUrls(cleanPhish, phishTarget, removedPhish);
  logger.info(`Selected ${selectedPhish.length.toLocaleString()} phishing URLs`);

  // Mark unselected phish (not already in removedPhish)
  const selectedPhishSet = new Set(selectedPhish.map((r) => r.url));
  for (const rec of cleanPhish) {
    if (!selectedPhishSet.has(rec.url) && !removedPhish.find((r) => r.url === rec.url)) {
      removedPhish.push({
        url: rec.url, label: 1, domain: rec.apexDomain,
        brand: rec.brand, industry: rec.industry,
        reason: 'low_diversity_score',
        details: 'Not selected during brand-capped diversity selection',
      });
    }
  }

  // ── 6. Combine results ────────────────────────────────────────────────────
  const selected  = [...selectedLegit, ...selectedPhish];

  // Backfill can re-select a URL that was earlier logged as removed — deduplicate.
  const selectedUrlSet = new Set(selected.map((r) => r.url));
  const removed = [...junkRemoved, ...removedLegit, ...removedPhish]
    .filter((r) => !selectedUrlSet.has(r.url));

  logger.info(`Final selection: ${selected.length.toLocaleString()} URLs`);
  logger.info(`Total removed  : ${removed.length.toLocaleString()} URLs`);

  // ── 7. Compute statistics ─────────────────────────────────────────────────
  const stats = computeStats(
    selected, removed,
    industryAllocations, brandAllocations,
    originalLegitimate, originalPhishing,
  );

  // ── 8. Write outputs ──────────────────────────────────────────────────────
  const urlDir     = path.resolve(PROJECT_ROOT, 'url');
  const reportsDir = path.resolve(PROJECT_ROOT, 'reports');

  const selectedCsvPath  = path.join(urlDir, 'selected_dataset.csv');
  const removedCsvPath   = path.join(urlDir, 'removed_dataset.csv');
  const statsJsonPath    = path.join(reportsDir, 'dataset_statistics.json');
  const statsMdPath      = path.join(reportsDir, 'dataset_statistics.md');
  const reportMdPath     = path.join(reportsDir, 'selection_report.md');

  logger.info('Writing output files …');

  await writeSelectedCsv(selected, selectedCsvPath);
  logger.info(`✔ ${selectedCsvPath}`);

  await writeRemovedCsv(removed, removedCsvPath);
  logger.info(`✔ ${removedCsvPath}`);

  writeStatisticsJson(stats, statsJsonPath);
  logger.info(`✔ ${statsJsonPath}`);

  writeStatisticsMd(stats, statsMdPath);
  logger.info(`✔ ${statsMdPath}`);

  writeSelectionReport(stats, reportMdPath);
  logger.info(`✔ ${reportMdPath}`);

  // ── 9. Summary ────────────────────────────────────────────────────────────
  logger.info('');
  logger.info('═══════════════════════════════════════════════════════');
  logger.info('  Selection Complete');
  logger.info('═══════════════════════════════════════════════════════');
  logger.info(`  Original  : ${(originalLegitimate + originalPhishing).toLocaleString()} URLs`);
  logger.info(`  Selected  : ${selected.length.toLocaleString()} URLs`);
  logger.info(`    Legit   : ${selectedLegit.length.toLocaleString()}`);
  logger.info(`    Phishing: ${selectedPhish.length.toLocaleString()}`);
  logger.info(`  Removed   : ${removed.length.toLocaleString()} URLs`);
  logger.info(`  Reduction : ${((removed.length / (originalLegitimate + originalPhishing)) * 100).toFixed(1)}%`);
  logger.info('');
  logger.info('  Industry coverage (top 5):');
  for (const ia of industryAllocations.slice(0, 5)) {
    logger.info(`    ${ia.industry.padEnd(18)} — ${ia.selected} selected`);
  }
  logger.info('');
  logger.info('  Top phishing targets:');
  for (const pt of stats.topPhishingTargets.slice(0, 5)) {
    logger.info(`    ${pt.brand.padEnd(22)} — ${pt.count} URLs (${pt.percentage}%)`);
  }
  logger.info('');
  logger.info(`  Diversity (legit)  : ${stats.uniqueDomainsLegitimate} domains, ${stats.uniqueTldsLegitimate} TLDs`);
  logger.info(`  Diversity (phish)  : ${stats.uniqueDomainsPhishing} domains, ${stats.uniqueTldsPhishing} TLDs`);
  logger.info('═══════════════════════════════════════════════════════');
  logger.info('');
  logger.info('  The Playwright pipeline will auto-use selected_dataset.csv');
  logger.info('  (it sorts before Dataset.csv in the url/ directory walk).');
  logger.info('');
}

main().catch((err: unknown) => {
  logger.error('reduceDataset failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
