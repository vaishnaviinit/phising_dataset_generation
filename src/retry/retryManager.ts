import { FailureReason } from '../types';
import { backoffDelay, sleep } from '../utils/helpers';
import { logger } from '../logger';

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
}

/** Map error messages to structured failure reasons. */
export function classifyError(err: Error | unknown): { reason: FailureReason; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (lower.includes('timeout') || lower.includes('timed out')) {
    return { reason: 'timeout', message: msg };
  }
  if (lower.includes('dns') || lower.includes('name_not_resolved') || lower.includes('getaddrinfo')) {
    return { reason: 'dns_failure', message: msg };
  }
  if (lower.includes('ssl') || lower.includes('certificate') || lower.includes('err_cert')) {
    return { reason: 'ssl_failure', message: msg };
  }
  if (lower.includes('err_too_many_redirects') || lower.includes('redirect')) {
    return { reason: 'redirect_loop', message: msg };
  }
  if (lower.includes('net::') || lower.includes('connection') || lower.includes('econnrefused')) {
    return { reason: 'network_error', message: msg };
  }
  if (lower.includes('captcha') || lower.includes('challenge')) {
    return { reason: 'captcha', message: msg };
  }
  if (lower.includes('crashed') || lower.includes('browser')) {
    return { reason: 'browser_crash', message: msg };
  }

  return { reason: 'unknown', message: msg };
}

/** Determine if a failure is worth retrying. */
export function isRetryable(reason: FailureReason): boolean {
  const nonRetryable: FailureReason[] = [
    'dns_failure',
    'ssl_failure',
    'invalid_url',
    'captcha',
    'blank_page',
  ];
  return !nonRetryable.includes(reason);
}

export class RetryManager {
  private opts: RetryOptions;

  constructor(opts: RetryOptions) {
    this.opts = opts;
  }

  /** Execute fn with automatic retry and exponential backoff. */
  async execute<T>(
    fn: () => Promise<T>,
    context: string,
  ): Promise<{ result: T | null; error: { reason: FailureReason; message: string } | null }> {
    let lastError: { reason: FailureReason; message: string } | null = null;

    for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = backoffDelay(this.opts.baseDelayMs, attempt - 1);
          logger.debug(`Retry ${attempt}/${this.opts.maxRetries} for ${context} in ${delay}ms`);
          await sleep(delay);
        }
        const result = await fn();
        return { result, error: null };
      } catch (err) {
        lastError = classifyError(err);
        logger.debug(`Attempt ${attempt + 1} failed for ${context}: ${lastError.reason}`);

        if (!isRetryable(lastError.reason)) {
          logger.debug(`Non-retryable error for ${context}: ${lastError.reason}`);
          break;
        }
      }
    }

    return { result: null, error: lastError };
  }
}
