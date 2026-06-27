import * as winston from 'winston';
import * as path from 'path';
import * as fs from 'fs';

const LOGS_DIR = process.env['LOGS_DIR']
  ? path.resolve(process.env['LOGS_DIR'])
  : path.resolve(process.cwd(), 'logs');

fs.mkdirSync(LOGS_DIR, { recursive: true });

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp: ts, stack }) => {
  const base = `[${ts}] ${level.toUpperCase().padEnd(7)} ${message}`;
  return stack ? `${base}\n${stack}` : base;
});

export const logger = winston.createLogger({
  level: process.env['LOG_LEVEL'] ?? 'info',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat,
  ),
  transports: [
    new winston.transports.Console({
      format: combine(
        colorize({ all: true }),
        errors({ stack: true }),
        timestamp({ format: 'HH:mm:ss' }),
        logFormat,
      ),
    }),
    new winston.transports.File({
      filename: path.join(LOGS_DIR, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(LOGS_DIR, 'combined.log'),
      maxsize: 50 * 1024 * 1024,
      maxFiles: 10,
    }),
  ],
});
