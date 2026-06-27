import { BrandDetector } from '../src/brand/brandDetector';
import { NavigationResult } from '../src/types';

function makeNav(overrides: Partial<NavigationResult> = {}): NavigationResult {
  return {
    finalUrl: 'https://example.com',
    statusCode: 200,
    redirectChain: [],
    pageTitle: '',
    loadTimeMs: 1000,
    hasSSLError: false,
    isParkedDomain: false,
    isCaptcha: false,
    isErrorPage: false,
    openGraphData: {},
    ...overrides,
  };
}

describe('BrandDetector', () => {
  const detector = new BrandDetector();

  it('identifies Amazon from domain', () => {
    const brand = detector.detect('https://www.amazon.com/dp/B08', makeNav({ finalUrl: 'https://www.amazon.com/dp/B08' }), 0);
    expect(brand.name).toBe('Amazon');
    expect(brand.confidence).toBe('high');
    expect(brand.source).toBe('domain_map');
  });

  it('identifies GitHub from domain', () => {
    const brand = detector.detect('https://github.com/user/repo', makeNav({ finalUrl: 'https://github.com' }), 0);
    expect(brand.name).toBe('GitHub');
  });

  it('uses OG site name when domain not in map', () => {
    const brand = detector.detect(
      'https://unknown-shop.com',
      makeNav({ openGraphData: { siteName: 'My Shop' } }),
      0,
    );
    expect(brand.name).toBe('My Shop');
    expect(brand.source).toBe('og_tag');
  });

  it('falls back to page title', () => {
    const brand = detector.detect(
      'https://some-site.com',
      makeNav({ pageTitle: 'AcmeCorp - Home' }),
      0,
    );
    expect(brand.name).toBe('AcmeCorp');
    expect(brand.source).toBe('page_title');
  });

  it('detects phishing brand from domain keyword', () => {
    const brand = detector.detect(
      'https://amazon-secure-login.suspicious.com',
      makeNav({ finalUrl: 'https://amazon-secure-login.suspicious.com' }),
      1,
    );
    expect(brand.name).toBe('amazon_fake');
  });

  it('normalizes brand name safely', () => {
    const brand = detector.detect(
      'https://bank-of-america.fake.com',
      makeNav(),
      1,
    );
    expect(brand.normalizedName).toMatch(/^[a-z0-9_]+$/);
  });
});
