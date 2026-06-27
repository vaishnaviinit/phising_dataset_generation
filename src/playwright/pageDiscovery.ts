import { Page } from 'playwright';
import { DiscoveredPage, PageType } from '../types';
import { logger } from '../logger';

// Text patterns matched against link text and href
const PAGE_PATTERNS: Array<{ type: PageType; patterns: RegExp[] }> = [
  {
    type: 'login',
    patterns: [/\b(sign\s*in|log\s*in|login|my\s*account)\b/i, /\/login|\/signin|\/auth\/sign_in/i],
  },
  {
    type: 'signup',
    patterns: [/\b(sign\s*up|register|create\s*(an?\s*)?account|join\s*free|get\s*started)\b/i, /\/register|\/signup|\/sign-up/i],
  },
  {
    type: 'forgot_password',
    patterns: [/\b(forgot|reset)\s*password\b/i, /\/forgot[-_]password|\/reset[-_]password/i],
  },
  {
    type: 'checkout',
    patterns: [/\b(checkout|check\s*out|place\s*order|proceed\s*to\s*(pay|checkout))\b/i, /\/checkout|\/cart/i],
  },
  {
    type: 'payment',
    patterns: [/\b(payment|pay\s*now|billing|credit\s*card)\b/i, /\/payment|\/pay|\/billing/i],
  },
  {
    type: 'otp',
    patterns: [/\b(otp|verify|verification|two.factor|2fa)\b/i, /\/otp|\/verify|\/2fa/i],
  },
  {
    type: 'account',
    patterns: [/\b(my\s*account|profile|account\s*settings|dashboard)\b/i, /\/account|\/profile|\/dashboard/i],
  },
];

export function identifyPageType(url: string, title: string): PageType {
  const combined = `${url} ${title}`.toLowerCase();

  for (const { type, patterns } of PAGE_PATTERNS) {
    if (patterns.some((p) => p.test(combined))) return type;
  }

  // Default to homepage if path is just /
  try {
    const parsed = new URL(url);
    if (parsed.pathname === '/' || parsed.pathname === '') return 'homepage';
  } catch {
    // ignore
  }

  return 'unknown';
}

export class PageDiscovery {
  private maxPages: number;

  constructor(maxPages = 4) {
    this.maxPages = maxPages;
  }

  async discoverPages(page: Page, baseUrl: string): Promise<DiscoveredPage[]> {
    const discovered: DiscoveredPage[] = [];

    try {
      const links = await page.evaluate((): Array<{ href: string; text: string }> => {
        const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
        return anchors.slice(0, 200).map((a) => ({
          href: a.href ?? '',
          text: (a.innerText ?? a.textContent ?? '').trim().toLowerCase(),
        }));
      });

      const base = new URL(baseUrl);

      for (const link of links) {
        if (discovered.length >= this.maxPages) break;
        if (!link.href || link.href === baseUrl) continue;

        // Only follow same-origin links
        try {
          const parsed = new URL(link.href);
          if (parsed.hostname !== base.hostname) continue;
        } catch {
          continue;
        }

        const combined = `${link.href} ${link.text}`;
        for (const { type, patterns } of PAGE_PATTERNS) {
          if (
            patterns.some((p) => p.test(combined)) &&
            !discovered.find((d) => d.pageType === type)
          ) {
            discovered.push({
              url: link.href,
              pageType: type,
              linkText: link.text,
            });
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
