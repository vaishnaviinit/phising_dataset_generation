import { Page, Response } from 'playwright';
import { NavigationResult, OpenGraphData } from '../types';
import { applyStealthToPage } from './antiDetection';
import { logger } from '../logger';

const ERROR_PAGE_PATTERNS = [
  /This site can't be reached/i,
  /ERR_NAME_NOT_RESOLVED/i,
  /ERR_CONNECTION_REFUSED/i,
  /ERR_CONNECTION_TIMED_OUT/i,
  /404 Not Found/i,
  /403 Forbidden/i,
  /502 Bad Gateway/i,
  /503 Service Unavailable/i,
  /Page not found/i,
  /Server Error/i,
  /This page isn't available/i,
  /Oops! That page can't be found/i,
];

const PARKED_PATTERNS = [
  /This domain is for sale/i,
  /domain.com is available/i,
  /Buy this domain/i,
  /Parked Domain/i,
  /GoDaddy Auctions/i,
  /Sedo/i,
];

const CAPTCHA_PATTERNS = [
  /captcha/i,
  /recaptcha/i,
  /hcaptcha/i,
  /I am not a robot/i,
  /verify you are human/i,
  /security check/i,
  /cloudflare.*challenge/i,
];

export class PageNavigator {
  private timeoutMs: number;
  private networkIdleMs: number;
  private enableStealth: boolean;

  constructor(timeoutMs: number, networkIdleMs: number, enableStealth: boolean) {
    this.timeoutMs = timeoutMs;
    this.networkIdleMs = networkIdleMs;
    this.enableStealth = enableStealth;
  }

  async navigate(page: Page, url: string): Promise<NavigationResult> {
    if (this.enableStealth) {
      await applyStealthToPage(page);
    }

    const redirectChain: string[] = [];
    let lastResponse: Response | null = null;
    const startTime = Date.now();

    page.on('response', (res) => {
      const status = res.status();
      if (status >= 300 && status < 400) {
        redirectChain.push(res.url());
      }
    });

    try {
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeoutMs,
      });

      lastResponse = response;

      // Wait for network to settle
      try {
        await page.waitForLoadState('networkidle', { timeout: this.networkIdleMs });
      } catch {
        // networkidle timeout is non-fatal — page may still be renderable
      }

      const loadTimeMs = Date.now() - startTime;
      const pageTitle = await page.title().catch(() => '');
      const finalUrl = page.url();
      const statusCode = lastResponse?.status() ?? 0;
      const ogData = await this.extractOpenGraph(page);

      const titleAndContent = pageTitle.toLowerCase();

      return {
        finalUrl,
        statusCode,
        redirectChain,
        pageTitle,
        loadTimeMs,
        hasSSLError: await this.hasSSLError(page),
        isParkedDomain: this.matchesPatterns(titleAndContent, PARKED_PATTERNS),
        isCaptcha: await this.detectCaptcha(page, titleAndContent),
        isErrorPage: this.matchesPatterns(titleAndContent, ERROR_PAGE_PATTERNS) || statusCode >= 400,
        openGraphData: ogData,
      };
    } catch (err) {
      const loadTimeMs = Date.now() - startTime;
      const msg = err instanceof Error ? err.message : String(err);
      logger.debug(`Navigation failed for ${url}: ${msg}`);

      return {
        finalUrl: url,
        statusCode: 0,
        redirectChain,
        pageTitle: '',
        loadTimeMs,
        hasSSLError: msg.includes('SSL') || msg.includes('certificate') || msg.includes('ERR_CERT'),
        isParkedDomain: false,
        isCaptcha: false,
        isErrorPage: true,
        openGraphData: {},
      };
    }
  }

  private async extractOpenGraph(page: Page): Promise<OpenGraphData> {
    try {
      return await page.evaluate(() => {
        const getMeta = (prop: string) =>
          document.querySelector<HTMLMetaElement>(`meta[property="${prop}"]`)?.content ??
          document.querySelector<HTMLMetaElement>(`meta[name="${prop}"]`)?.content;
        return {
          title: getMeta('og:title'),
          description: getMeta('og:description'),
          siteName: getMeta('og:site_name'),
          image: getMeta('og:image'),
        };
      });
    } catch {
      return {};
    }
  }

  private async detectCaptcha(page: Page, titleLower: string): Promise<boolean> {
    if (this.matchesPatterns(titleLower, CAPTCHA_PATTERNS)) return true;
    try {
      const hasCaptchaFrame = await page.$('iframe[src*="captcha"], iframe[src*="recaptcha"]');
      return hasCaptchaFrame !== null;
    } catch {
      return false;
    }
  }

  private async hasSSLError(page: Page): Promise<boolean> {
    try {
      const url = page.url();
      return url.startsWith('chrome-error://') || url.includes('NET::ERR_CERT');
    } catch {
      return false;
    }
  }

  private matchesPatterns(text: string, patterns: RegExp[]): boolean {
    return patterns.some((p) => p.test(text));
  }
}
