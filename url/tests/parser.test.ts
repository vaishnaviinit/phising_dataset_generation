import { validateUrl, buildInvalidEntry } from '../src/parser/urlValidator';
import { normalizeUrl, isValidHttpUrl, extractDomain, shortHash } from '../src/utils/helpers';

describe('URL Validator', () => {
  it('accepts valid HTTPS URL', () => {
    const result = validateUrl('https://www.amazon.com/products?id=123', 1);
    expect(result.valid).toBe(true);
  });

  it('accepts valid HTTP URL', () => {
    const result = validateUrl('http://example.com', 1);
    expect(result.valid).toBe(true);
  });

  it('rejects empty string', () => {
    const result = validateUrl('', 1);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('empty_url');
  });

  it('rejects non-HTTP URL (ftp)', () => {
    const result = validateUrl('ftp://files.example.com', 1);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('invalid_url_format');
  });

  it('rejects localhost', () => {
    const result = validateUrl('http://localhost:3000', 1);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('private_or_loopback_address');
  });

  it('rejects private IP', () => {
    const result = validateUrl('http://192.168.1.1/admin', 1);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('private_or_loopback_address');
  });

  it('rejects malformed URL', () => {
    const result = validateUrl('not-a-url', 1);
    expect(result.valid).toBe(false);
  });
});

describe('URL Helpers', () => {
  it('normalizes URL to lowercase hostname', () => {
    const url = normalizeUrl('HTTPS://WWW.EXAMPLE.COM/path');
    expect(url).toBe('https://www.example.com/path');
  });

  it('strips trailing slash from root path', () => {
    const url = normalizeUrl('https://example.com/');
    expect(url).toBe('https://example.com');
  });

  it('identifies valid HTTP URLs', () => {
    expect(isValidHttpUrl('https://google.com')).toBe(true);
    expect(isValidHttpUrl('http://example.org')).toBe(true);
    expect(isValidHttpUrl('ftp://files.org')).toBe(false);
    expect(isValidHttpUrl('not-a-url')).toBe(false);
  });

  it('extracts domain without www', () => {
    expect(extractDomain('https://www.amazon.com/products')).toBe('amazon.com');
    expect(extractDomain('https://github.com')).toBe('github.com');
    expect(extractDomain('https://sub.example.co.uk/path')).toBe('sub.example.co.uk');
  });

  it('produces consistent 8-char hash', () => {
    const h = shortHash('https://example.com');
    expect(h).toHaveLength(8);
    expect(h).toBe(shortHash('https://example.com'));
    expect(h).not.toBe(shortHash('https://other.com'));
  });
});
