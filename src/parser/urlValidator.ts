import { InvalidUrlEntry } from '../types';
import { isValidHttpUrl } from '../utils/helpers';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

const BLOCKED_PATTERNS = [
  /^localhost/i,
  /^127\.\d+\.\d+\.\d+/,
  /^0\.0\.0\.0/,
  /^192\.168\./,
  /^10\.\d+\.\d+\.\d+/,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^::1$/,
];

export function validateUrl(raw: string, rowNumber: number): ValidationResult {
  if (!raw || raw.trim() === '') {
    return { valid: false, reason: 'empty_url' };
  }

  const trimmed = raw.trim();

  if (!isValidHttpUrl(trimmed)) {
    return { valid: false, reason: 'invalid_url_format' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: 'url_parse_error' };
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(parsed.hostname)) {
      return { valid: false, reason: 'private_or_loopback_address' };
    }
  }

  if (parsed.hostname.length === 0) {
    return { valid: false, reason: 'empty_hostname' };
  }

  if (parsed.hostname.length > 253) {
    return { valid: false, reason: 'hostname_too_long' };
  }

  return { valid: true };
}

export function buildInvalidEntry(
  rawValue: string,
  reason: string,
  rowNumber: number,
): InvalidUrlEntry {
  return {
    originalUrl: rawValue,
    reason,
    rowNumber,
    rawValue,
  };
}
