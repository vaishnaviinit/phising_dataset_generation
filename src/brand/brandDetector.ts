import { Page } from 'playwright';
import { BrandInfo, NavigationResult } from '../types';
import { extractDomain } from '../utils/helpers';

// Known domain → brand name mapping
const DOMAIN_MAP: Record<string, string> = {
  'amazon.com': 'Amazon', 'amazon.in': 'Amazon', 'amazon.co.uk': 'Amazon',
  'google.com': 'Google', 'google.co.in': 'Google', 'google.co.uk': 'Google',
  'microsoft.com': 'Microsoft', 'live.com': 'Microsoft', 'microsoftonline.com': 'Microsoft',
  'apple.com': 'Apple', 'icloud.com': 'Apple',
  'github.com': 'GitHub', 'github.io': 'GitHub',
  'linkedin.com': 'LinkedIn',
  'netflix.com': 'Netflix',
  'dropbox.com': 'Dropbox',
  'facebook.com': 'Facebook', 'fb.com': 'Facebook',
  'instagram.com': 'Instagram',
  'x.com': 'X', 'twitter.com': 'X',
  'reddit.com': 'Reddit',
  'wikipedia.org': 'Wikipedia',
  'adobe.com': 'Adobe', 'adobelogin.com': 'Adobe',
  'oracle.com': 'Oracle',
  'openai.com': 'OpenAI',
  'chatgpt.com': 'ChatGPT',
  'zoom.us': 'Zoom',
  'slack.com': 'Slack',
  'discord.com': 'Discord',
  'notion.so': 'Notion',
  'canva.com': 'Canva',
  'spotify.com': 'Spotify',
  'youtube.com': 'YouTube',
  'gmail.com': 'Gmail', 'mail.google.com': 'Gmail',
  'outlook.com': 'Outlook', 'outlook.live.com': 'Outlook', 'hotmail.com': 'Outlook',
  'yahoo.com': 'Yahoo', 'yahoo.co.in': 'Yahoo',
  'cloudflare.com': 'Cloudflare',
  'aws.amazon.com': 'AWS', 'amazonaws.com': 'AWS',
  'azure.microsoft.com': 'Azure',
  'digitalocean.com': 'DigitalOcean',
  'paypal.com': 'PayPal',
  'ebay.com': 'eBay',
  'twitch.tv': 'Twitch',
  'tiktok.com': 'TikTok',
  // Banking
  'onlinesbi.sbi': 'SBI', 'sbi.co.in': 'SBI',
  'hdfcbank.com': 'HDFC',
  'icicibank.com': 'ICICI',
  'axisbank.com': 'Axis Bank',
  'kotak.com': 'Kotak',
  'canarabank.com': 'Canara Bank',
  'bankofbaroda.in': 'Bank of Baroda', 'bankofbaroda.com': 'Bank of Baroda',
  'pnbindia.in': 'PNB',
  'unionbankofindia.co.in': 'Union Bank',
  'idfcfirstbank.com': 'IDFC First Bank',
  'federalbank.co.in': 'Federal Bank',
  'hsbc.co.in': 'HSBC', 'hsbc.com': 'HSBC',
  'barclays.co.uk': 'Barclays', 'barclays.com': 'Barclays',
  'chase.com': 'Chase',
  'bankofamerica.com': 'Bank of America',
  'citibank.com': 'Citibank', 'citi.com': 'Citibank',
  'wellsfargo.com': 'Wells Fargo',
  // Government
  'uidai.gov.in': 'UIDAI',
  'incometax.gov.in': 'Income Tax India',
  'passportindia.gov.in': 'Passport India',
  'digilocker.gov.in': 'DigiLocker',
  'gst.gov.in': 'GST',
  'mygov.in': 'MyGov',
  'india.gov.in': 'Government of India',
  'irs.gov': 'IRS',
  'gov.uk': 'GOV.UK',
  // Education
  'mit.edu': 'MIT', 'iitb.ac.in': 'IIT Bombay', 'iitd.ac.in': 'IIT Delhi',
  'iitm.ac.in': 'IIT Madras', 'iitk.ac.in': 'IIT Kanpur',
  'stanford.edu': 'Stanford', 'harvard.edu': 'Harvard',
  'ox.ac.uk': 'Oxford', 'cam.ac.uk': 'Cambridge',
  'coursera.org': 'Coursera', 'edx.org': 'edX', 'khanacademy.org': 'Khan Academy',
};

// Phishing impersonation patterns in domain
const PHISH_BRAND_PATTERNS: Array<{ pattern: RegExp; brand: string }> = [
  { pattern: /amazon/i, brand: 'amazon_fake' },
  { pattern: /paypal/i, brand: 'paypal_fake' },
  { pattern: /microsoft|msft|outlook|onedrive|office365/i, brand: 'microsoft_fake' },
  { pattern: /google|gmail|googl/i, brand: 'google_fake' },
  { pattern: /apple|icloud|itunes/i, brand: 'apple_fake' },
  { pattern: /facebook|fb\.com/i, brand: 'facebook_fake' },
  { pattern: /instagram/i, brand: 'instagram_fake' },
  { pattern: /netflix/i, brand: 'netflix_fake' },
  { pattern: /bank|banking|sbi|hdfc|icici|chase|wellsfargo|citibank/i, brand: 'bank_fake' },
  { pattern: /ebay/i, brand: 'ebay_fake' },
  { pattern: /dropbox/i, brand: 'dropbox_fake' },
  { pattern: /linkedin/i, brand: 'linkedin_fake' },
  { pattern: /adobe/i, brand: 'adobe_fake' },
];

export class BrandDetector {
  detect(pageUrl: string, navResult: NavigationResult, label: 0 | 1): BrandInfo {
    const domain = extractDomain(pageUrl);
    const finalDomain = extractDomain(navResult.finalUrl);

    // 1. Check domain map (most reliable)
    const domainMatch = this.lookupDomainMap(domain) || this.lookupDomainMap(finalDomain);
    if (domainMatch) {
      return {
        name: domainMatch,
        normalizedName: this.normalize(domainMatch),
        confidence: 'high',
        source: 'domain_map',
      };
    }

    // 2. For phishing URLs, try to detect the impersonated brand
    if (label === 1) {
      const combined = `${domain} ${finalDomain}`.toLowerCase();
      for (const { pattern, brand } of PHISH_BRAND_PATTERNS) {
        if (pattern.test(combined)) {
          return {
            name: brand,
            normalizedName: this.normalize(brand),
            confidence: 'medium',
            source: 'domain_map',
          };
        }
      }
    }

    // 3. Try OpenGraph site name
    if (navResult.openGraphData.siteName) {
      const name = navResult.openGraphData.siteName.trim();
      return {
        name,
        normalizedName: this.normalize(name),
        confidence: 'medium',
        source: 'og_tag',
      };
    }

    // 4. Try page title (first word before common separators)
    if (navResult.pageTitle) {
      const brand = this.extractBrandFromTitle(navResult.pageTitle);
      if (brand) {
        return {
          name: brand,
          normalizedName: this.normalize(brand),
          confidence: 'low',
          source: 'page_title',
        };
      }
    }

    // 5. Use domain apex as brand
    const apex = domain.split('.').slice(-2, -1)[0] ?? 'generic';
    return {
      name: apex,
      normalizedName: this.normalize(apex),
      confidence: 'low',
      source: 'generic',
    };
  }

  private lookupDomainMap(domain: string): string | null {
    if (DOMAIN_MAP[domain]) return DOMAIN_MAP[domain]!;
    // Try removing one subdomain level
    const parts = domain.split('.');
    if (parts.length > 2) {
      const parent = parts.slice(1).join('.');
      if (DOMAIN_MAP[parent]) return DOMAIN_MAP[parent]!;
    }
    return null;
  }

  private extractBrandFromTitle(title: string): string | null {
    const parts = title.split(/[|\-–—:]/);
    const candidate = parts[0]?.trim() ?? '';
    if (candidate.length >= 2 && candidate.length <= 40) return candidate;
    return null;
  }

  private normalize(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64);
  }
}
