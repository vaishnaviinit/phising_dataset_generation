// ─────────────────────────────────────────────────────────────────────────────
//  URL quality filter and structural-signature generator
//
//  Detects low-quality URLs (shorteners, trackers, parking domains) and
//  computes a canonical structural signature used to collapse phishing-kit
//  clones that differ only in tokens / session IDs.
// ─────────────────────────────────────────────────────────────────────────────

// ── Known URL shortener / redirect apex domains ───────────────────────────────
const SHORTENER_DOMAINS = new Set<string>([
  'bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'ow.ly', 'is.gd', 'buff.ly',
  'adf.ly', 'bitly.com', 'cutt.ly', 'rb.gy', 'short.io', 'tiny.cc',
  'v.gd', 'shorturl.at', 'clk.sh', 'snip.ly', 'bl.ink', 'lnkd.in',
  'ht.ly', 'hootsuite.com', 'kl.am', 'x.co', 'su.pr', 'tr.im',
  'migre.me', 'qr.net', 'ff.im', 'trib.al', 'dlvr.it',
]);

// ── Tracking / analytics query-parameter names ───────────────────────────────
// A URL is classified as a tracking URL if it has many of these and little else.
const TRACKING_PARAMS = new Set<string>([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'dclid', 'msclkid', 'mc_eid', 'mc_cid',
  'yclid', 'twclid', 'igshid', '_ga', '_gl', 'ref', 'source',
  'affiliate', 'aff_id', 'click_id', 'session_id', 'tracking_id',
]);

// ── Common parking / parked-page domain indicators ───────────────────────────
const PARKING_KEYWORDS = [
  'parking', 'parked', 'sedo.com', 'hugedomains.com', 'afternic.com',
  'godaddy.com', 'namecheap.com', 'dan.com', 'epik.com', 'domain.com',
  'undeveloped.com', 'uniregistry.com', 'brandbucket.com', 'bodis.com',
];

// ── Query params that suggest redirect chains ─────────────────────────────────
const REDIRECT_PARAMS = ['url', 'redirect', 'redirect_to', 'return', 'return_url',
  'next', 'forward', 'goto', 'redir', 'continue', 'dest', 'destination'];

/** Return true if the apex domain belongs to a known URL shortener service. */
export function isUrlShortener(apexDomain: string): boolean {
  return SHORTENER_DOMAINS.has(apexDomain.toLowerCase());
}

/**
 * Return true if the URL is primarily a tracking link.
 * Heuristic: ≥3 tracking params AND (tracking params / total params) > 0.5.
 */
export function isTrackingUrl(fullUrl: string): boolean {
  try {
    const parsed = new URL(fullUrl);
    const params = Array.from(parsed.searchParams.keys());
    if (params.length === 0) return false;
    const trackers = params.filter((p) => TRACKING_PARAMS.has(p.toLowerCase()));
    return trackers.length >= 3 && trackers.length / params.length > 0.5;
  } catch {
    return false;
  }
}

/**
 * Return true if the URL appears to be a redirect chain entry point.
 * A redirect chain URL contains a redirect/return param pointing to another URL.
 */
export function isRedirectChain(fullUrl: string): boolean {
  try {
    const parsed = new URL(fullUrl);
    for (const param of REDIRECT_PARAMS) {
      const val = parsed.searchParams.get(param);
      if (val && (val.startsWith('http://') || val.startsWith('https://'))) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Return true if the domain looks like a parking / placeholder page.
 * Uses known parking platform keywords in the apex domain.
 */
export function isParkingDomain(apexDomain: string, pathLen: number, queryLen: number): boolean {
  const lower = apexDomain.toLowerCase();
  // Parking platforms re-serve domains; their apex will contain these strings.
  if (PARKING_KEYWORDS.some((kw) => lower.includes(kw))) return true;
  // Trivial single-label domains with no path/query are often parked.
  if (!lower.includes('.')) return true;
  // Very short domain (1–3 chars before TLD) with no real path
  const nameBeforeTld = lower.split('.')[0] ?? '';
  if (nameBeforeTld.length <= 2 && pathLen <= 1 && queryLen === 0) return true;
  return false;
}

// ── Structural signature ──────────────────────────────────────────────────────

/**
 * Compute a canonical "structural signature" for phishing-kit deduplication.
 *
 * The signature captures the URL skeleton while masking session-specific tokens:
 *   - UUID / hex IDs → {id}
 *   - Numeric segments → {n}
 *   - Long alphanumeric tokens → {tok}
 *   - Query parameter names (values stripped, names sorted)
 *
 * Two phishing pages from the same kit deployed on different subdomains, or
 * with different victim tokens, will share the same signature.
 *
 * @param fullUrl     the full phishing URL
 * @param apexDomain  pre-extracted apex domain
 */
export function computeStructuralSignature(fullUrl: string, apexDomain: string): string {
  let pathname = '';
  let queryNames = '';

  try {
    const parsed = new URL(fullUrl);
    pathname = normalizePath(parsed.pathname);
    const params = Array.from(parsed.searchParams.keys()).sort();
    queryNames = params.length > 0 ? `?${params.join('&')}` : '';
  } catch {
    pathname = '';
  }

  return `${apexDomain}${pathname}${queryNames}`;
}

/** Replace variable path segments with typed placeholders. */
function normalizePath(pathname: string): string {
  const segments = pathname.split('/').map((seg) => {
    // UUID
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) {
      return '{uuid}';
    }
    // Long hex string (32+ chars)
    if (/^[0-9a-f]{32,}$/i.test(seg)) return '{hex}';
    // Pure numeric
    if (/^\d+$/.test(seg)) return '{n}';
    // Long alphanumeric token (12+ chars with digits)  →  variable
    if (/^[a-z0-9_\-]{12,}$/i.test(seg) && /\d/.test(seg) && /[a-z]/i.test(seg)) {
      return '{tok}';
    }
    return seg.toLowerCase();
  });
  return segments.join('/');
}

// ── Country / TLD helpers ─────────────────────────────────────────────────────

/** Map 2-letter ccTLD to region for diversity reporting. */
export function regionFromTld(tld: string): string {
  const lower = tld.toLowerCase();

  // Multi-part TLDs
  if (lower.endsWith('.in') || lower === 'in') return 'South Asia';
  if (lower.endsWith('.au') || lower === 'au') return 'Oceania';
  if (lower.endsWith('.uk') || lower === 'uk') return 'Europe';
  if (lower.endsWith('.de') || lower === 'de') return 'Europe';
  if (lower.endsWith('.fr') || lower === 'fr') return 'Europe';
  if (lower.endsWith('.nl') || lower === 'nl') return 'Europe';
  if (lower.endsWith('.it') || lower === 'it') return 'Europe';
  if (lower.endsWith('.es') || lower === 'es') return 'Europe';
  if (lower.endsWith('.pl') || lower === 'pl') return 'Europe';
  if (lower.endsWith('.ru') || lower === 'ru') return 'Europe/Asia';
  if (lower.endsWith('.cn') || lower === 'cn') return 'East Asia';
  if (lower.endsWith('.jp') || lower === 'jp') return 'East Asia';
  if (lower.endsWith('.kr') || lower === 'kr') return 'East Asia';
  if (lower.endsWith('.br') || lower === 'br') return 'Latin America';
  if (lower.endsWith('.mx') || lower === 'mx') return 'Latin America';
  if (lower.endsWith('.ar') || lower === 'ar') return 'Latin America';
  if (lower.endsWith('.za') || lower === 'za') return 'Africa';
  if (lower.endsWith('.ng') || lower === 'ng') return 'Africa';
  if (lower.endsWith('.ke') || lower === 'ke') return 'Africa';
  if (lower.endsWith('.ca') || lower === 'ca') return 'North America';
  if (lower.endsWith('.us') || lower === 'us') return 'North America';

  // Generic TLDs → group by type
  if (['com', 'net', 'org', 'info', 'biz', 'io', 'co'].includes(lower)) return 'Global';
  if (['edu', 'ac'].includes(lower.split('.')[0] ?? '')) return 'Education';
  if (['gov', 'mil'].includes(lower.split('.')[0] ?? '')) return 'Government';

  return 'Other';
}
