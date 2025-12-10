/**
 * Logging Utility
 *
 * Structured JSON logging for the Tribal Knowledge system.
 */

import { createWriteStream } from 'fs';
import path from 'path';

export interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data?: any;
  error?: Error;
}

class Logger {
  private logLevel: 'debug' | 'info' | 'warn' | 'error';
  private logStream: NodeJS.WritableStream | null = null;

  constructor() {
    this.logLevel = (process.env.TRIBAL_LOG_LEVEL as any) || 'info';

    // Initialize file logging if log directory exists
    try {
      const logPath = path.join(process.cwd(), 'logs', 'tribal-knowledge.log');
      this.logStream = createWriteStream(logPath, { flags: 'a' });
    } catch (error) {
      // File logging not available, use console only
    }
  }

  debug(message: string, data?: any): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: any): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: any): void {
    this.log('warn', message, data);
  }

  error(message: string, error?: Error | any): void {
    this.log('error', message, undefined, error);
  }

  private log(level: LogEntry['level'], message: string, data?: any, error?: Error | any): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    if (data !== undefined) {
      entry.data = data;
    }

    if (error) {
      entry.error = error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name,
      } : error;
    }

    const logString = JSON.stringify(entry);

    // Console output with color coding
    const coloredMessage = this.colorizeLog(level, logString);
    console.log(coloredMessage);

    // File output
    if (this.logStream) {
      this.logStream.write(logString + '\n');
    }
  }

  private shouldLog(level: LogEntry['level']): boolean {
    const levels = ['debug', 'info', 'warn', 'error'];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex >= currentLevelIndex;
  }

  private colorizeLog(level: LogEntry['level'], message: string): string {
    const colors = {
      debug: '\x1b[36m', // Cyan
      info: '\x1b[32m',  // Green
      warn: '\x1b[33m',  // Yellow
      error: '\x1b[31m', // Red
    };

    const reset = '\x1b[0m';
    return `${colors[level]}${message}${reset}`;
  }
}

export const logger = new Logger();