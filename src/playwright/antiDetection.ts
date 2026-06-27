import { BrowserContext, Page } from 'playwright';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:125.0) Gecko/20100101 Firefox/125.0',
];

export function pickUserAgent(index: number): string {
  return USER_AGENTS[index % USER_AGENTS.length]!;
}

/** Inject stealth scripts that mask Playwright/automation detection signals. */
export async function applyStealthToPage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Hide webdriver flag
    Object.defineProperty(navigator, 'webdriver', { get: () => false });

    // Fake plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });

    // Fake languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });

    // Override permissions query
    const originalQuery = window.navigator.permissions.query.bind(navigator.permissions);
    // @ts-ignore
    window.navigator.permissions.query = (parameters: PermissionDescriptor) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
        : originalQuery(parameters);

    // Spoof chrome runtime
    // @ts-ignore
    window.chrome = { runtime: {} };

    // Prevent headless detection via screen
    Object.defineProperty(screen, 'availTop', { get: () => 0 });
    Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
  });
}

/** Apply context-level anti-detection settings. */
export function buildContextOptions(
  userAgent: string,
  viewport: { width: number; height: number },
  isMobile = false,
): Parameters<import('playwright').Browser['newContext']>[0] {
  return {
    userAgent,
    viewport,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    geolocation: { latitude: 40.7128, longitude: -74.006 },
    permissions: ['geolocation'],
    colorScheme: 'light',
    deviceScaleFactor: isMobile ? 3 : 1,
    isMobile,
    hasTouch: isMobile,
    javaScriptEnabled: true,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    },
  };
}
