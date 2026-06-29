// ─────────────────────────────────────────────────────────────────────────────
//  Page discovery — finds secondary pages (login, signup, checkout, …) on a
//  site and filters out duplicates before handing them back to the collector.
//
//  Key behaviours:
//   • Only same-origin links are followed.
//   • Each page type is discovered at most once per URL.
//   • A caller-supplied `visitedUrls` set prevents capturing the same final
//     URL twice (e.g. "Sign In" and "Log In" that both go to /login).
//   • Discovery per page type can be toggled via PageDiscoveryConfig.
// ─────────────────────────────────────────────────────────────────────────────

import { Page } from 'playwright';
import { DiscoveredPage, PageType } from '../types';
import { logger } from '../logger';

// ── Configuration ─────────────────────────────────────────────────────────────

export interface PageDiscoveryConfig {
  login:          boolean;
  signup:         boolean;
  forgotPassword: boolean;
  checkout:       boolean;
  payment:        boolean;
  account:        boolean;
  profile:        boolean;
  dashboard:      boolean;
}

// ── Pattern table ─────────────────────────────────────────────────────────────
// Ordered from most specific to least specific so early patterns win.

interface PatternEntry {
  type: PageType;
  /** Key in PageDiscoveryConfig that gates discovery of this type. */
  configKey: keyof PageDiscoveryConfig;
  /** Matched against the combined string "{href} {linkText}". */
  patterns: RegExp[];
}

const PAGE_PATTERNS: PatternEntry[] = [
  // ── Login ──────────────────────────────────────────────────────────────────
  {
    type: 'login',
    configKey: 'login',
    patterns: [
      /\b(sign[\s-]?in|log[\s-]?in|login)\b/i,
      /\/(login|signin|sign-in|auth\/sign_in|user\/login|account\/login)\b/i,
    ],
  },
  // ── Signup / Register ─────────────────────────────────────────────────────
  {
    type: 'signup',
    configKey: 'signup',
    patterns: [
      /\b(sign[\s-]?up|register|create[\s-]+(an?\s*)?account|join[\s-]*free|get[\s-]*started)\b/i,
      /\/(register|signup|sign-up|create[-_]account|join)\b/i,
    ],
  },
  // ── Forgot / Reset Password ────────────────────────────────────────────────
  {
    type: 'forgot_password',
    configKey: 'forgotPassword',
    patterns: [
      /\b(forgot[\s-]*password|reset[\s-]*password|password[\s-]*reset|trouble[\s-]*signing)\b/i,
      /\/(forgot[-_]password|reset[-_]password|password[-_]reset|recover)\b/i,
    ],
  },
  // ── Checkout ──────────────────────────────────────────────────────────────
  {
    type: 'checkout',
    configKey: 'checkout',
    patterns: [
      /\b(checkout|check[\s-]*out|place[\s-]*order|proceed[\s-]*to[\s-]*(pay|checkout))\b/i,
      /\/(checkout|check-out|order\/review)\b/i,
    ],
  },
  // ── Cart ──────────────────────────────────────────────────────────────────
  {
    type: 'cart',
    configKey: 'checkout', // governed by the same flag as checkout
    patterns: [
      /\b(cart|shopping[\s-]*cart|basket|view[\s-]*cart|my[\s-]*cart)\b/i,
      /\/(cart|basket|shopping[-_]cart)\b/i,
    ],
  },
  // ── Payment ───────────────────────────────────────────────────────────────
  {
    type: 'payment',
    configKey: 'payment',
    patterns: [
      /\b(payment|pay[\s-]*now|billing|credit[\s-]*card|add[\s-]*payment)\b/i,
      /\/(payment|pay|billing|credit-card)\b/i,
    ],
  },
  // ── Account ───────────────────────────────────────────────────────────────
  {
    type: 'account',
    configKey: 'account',
    patterns: [
      /\b(my[\s-]*account|account[\s-]*settings|account[\s-]*overview)\b/i,
      /\/(my[-_]account|account\/settings|account\/overview)\b/i,
    ],
  },
  // ── Profile ───────────────────────────────────────────────────────────────
  {
    type: 'profile',
    configKey: 'profile',
    patterns: [
      /\b(my[\s-]*profile|edit[\s-]*profile|user[\s-]*profile)\b/i,
      /\/(profile|my[-_]profile|user\/profile|settings\/profile)\b/i,
    ],
  },
  // ── Dashboard ─────────────────────────────────────────────────────────────
  {
    type: 'dashboard',
    configKey: 'dashboard',
    patterns: [
      /\bdashboard\b/i,
      /\/(dashboard|home|overview|console|panel)\b/i,
    ],
  },
];

// ── identifyPageType (unchanged API) ─────────────────────────────────────────

/** Identify the page type from a URL + title string. */
export function identifyPageType(url: string, title: string): PageType {
  const combined = `${url} ${title}`.toLowerCase();

  for (const { type, patterns } of PAGE_PATTERNS) {
    if (patterns.some((p) => p.test(combined))) return type;
  }

  try {
    const parsed = new URL(url);
    if (parsed.pathname === '/' || parsed.pathname === '') return 'homepage';
  } catch {
    // ignore
  }

  return 'unknown';
}

// ── PageDiscovery class ───────────────────────────────────────────────────────

export class PageDiscovery {
  private config: PageDiscoveryConfig;
  private maxPages: number;

  constructor(config: PageDiscoveryConfig, maxPages = 8) {
    this.config = config;
    this.maxPages = maxPages;
  }

  /**
   * Discover secondary pages linked from `page`.
   *
   * @param page        Already-navigated Playwright page for the homepage.
   * @param baseUrl     The URL that was navigated to (used for same-origin check).
   * @param visitedUrls Set of URLs already captured; prevents URL duplicates.
   *                    The caller is responsible for maintaining this set across
   *                    the full life of a URL session.
   */
  async discoverPages(
    page: Page,
    baseUrl: string,
    visitedUrls: Set<string>,
  ): Promise<DiscoveredPage[]> {
    const discovered: DiscoveredPage[] = [];
    const discoveredTypes = new Set<PageType>();

    try {
      // Collect all anchor hrefs + visible text from the rendered DOM
      const links = await page.evaluate((): Array<{ href: string; text: string }> => {
        const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
        return anchors.slice(0, 300).map((a) => ({
          href: a.href ?? '',
          text: (a.innerText ?? a.textContent ?? '').trim().toLowerCase(),
        }));
      });

      let base: URL;
      try {
        base = new URL(baseUrl);
      } catch {
        return discovered;
      }

      for (const link of links) {
        if (discovered.length >= this.maxPages) break;
        if (!link.href) continue;

        // Only same-origin links
        let parsed: URL;
        try {
          parsed = new URL(link.href);
          if (parsed.hostname !== base.hostname) continue;
        } catch {
          continue;
        }

        // Normalise to remove fragments (same page, different anchor)
        parsed.hash = '';
        const normalised = parsed.toString();

        // Skip URLs already captured or queued this session
        if (visitedUrls.has(normalised)) continue;

        // Match against pattern table
        const combined = `${normalised} ${link.text}`;
        for (const { type, configKey, patterns } of PAGE_PATTERNS) {
          // Respect per-type discovery flag
          if (!this.config[configKey]) continue;
          // Discover each type at most once
          if (discoveredTypes.has(type)) continue;

          if (patterns.some((p) => p.test(combined))) {
            discovered.push({ url: normalised, pageType: type, linkText: link.text });
            discoveredTypes.add(type);
            // Don't add to visitedUrls here — caller does that after navigation
            break;
          }
        }
      }
    } catch (err) {
      logger.debug(`Page discovery error: ${err instanceof Error ? err.message : err}`);
    }

    return discovered;
  }
}
