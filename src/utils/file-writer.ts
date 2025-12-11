/**
 * File Writer Utility
 * 
 * Provides atomic file writing operations with proper error handling,
 * path sanitization, and directory management.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { createAgentError } from '../agents/documenter/errors.js';
import { ErrorCodes } from '../agents/documenter/errors.js';

/**
 * FileWriter class with static methods for file operations
 */
export class FileWriter {
  /**
   * Write file atomically (write to temp file, then rename)
   * Implements retry logic: retries once on failure
   * 
   * @param filePath Target file path
   * @param content File content to write
   * @throws AgentError with DOC_FILE_WRITE_FAILED if write fails after retry
   */
  static async writeFileAtomic(filePath: string, content: string): Promise<void> {
    const tempPath = `${filePath}.tmp`;
    let attempt = 0;
    const maxAttempts = 2; // Initial attempt + one retry

    while (attempt < maxAttempts) {
      try {
        // Ensure directory exists
        await this.ensureDirectoryExists(path.dirname(filePath));

        // Write to temporary file
        await fs.writeFile(tempPath, content, 'utf8');

        // Validate write success by reading back
        const written = await fs.readFile(tempPath, 'utf8');
        if (written !== content) {
          throw new Error('File content mismatch after write');
        }

        // Atomic rename
        await fs.rename(tempPath, filePath);

        // Success - return
        return;
      } catch (error) {
        attempt++;
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Clean up temp file if it exists
        try {
          await fs.unlink(tempPath).catch(() => {
            // Ignore cleanup errors
          });
        } catch {
          // Ignore cleanup errors
        }

        // If this was the last attempt, throw error
        if (attempt >= maxAttempts) {
          const agentError = createAgentError(
            ErrorCodes.DOC_FILE_WRITE_FAILED,
            `Failed to write file ${filePath} after ${maxAttempts} attempts: ${errorMessage}`,
            'error',
            true,
            { filePath, attempt, originalError: errorMessage }
          );
          logger.error(agentError.message, { code: agentError.code, context: agentError.context });
          throw agentError;
        }

        // Log retry attempt
        logger.warn(`File write failed for ${filePath}, retrying... (attempt ${attempt}/${maxAttempts})`, {
          error: errorMessage,
        });

        // Wait a bit before retry (exponential backoff: 100ms, 200ms)
        await new Promise(resolve => setTimeout(resolve, 100 * attempt));
      }
    }
  }

  /**
   * Ensure directory exists, creating it recursively if needed
   * 
   * @param dirPath Directory path to ensure exists
   * @throws AgentError with DOC_FILE_WRITE_FAILED if directory creation fails
   */
  static async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const agentError = createAgentError(
        ErrorCodes.DOC_FILE_WRITE_FAILED,
        `Failed to create directory ${dirPath}: ${errorMessage}`,
        'error',
        true,
        { dirPath, originalError: errorMessage }
      );
      logger.error(agentError.message, { code: agentError.code, context: agentError.context });
      throw agentError;
    }
  }

  /**
   * Sanitize file path by replacing invalid filesystem characters
   * 
   * Invalid characters: / \ : * ? " < > |
   * Also converts to lowercase for cross-platform compatibility
   * 
   * @param unsafePath Unsafe path string
   * @returns Sanitized path string
   */
  static sanitizePath(unsafePath: string): string {
    if (!unsafePath || unsafePath.length === 0) {
      return '_';
    }

    // Replace invalid filesystem characters with underscores
    let sanitized = unsafePath
      .replace(/[\/\\:*?"<>|]/g, '_')
      .toLowerCase();

    // Handle edge case: if result is only underscores or empty, use a default
    if (sanitized.replace(/_/g, '').length === 0) {
      sanitized = 'unnamed';
    }

    // Remove leading/trailing underscores and dots (Windows doesn't like these)
    sanitized = sanitized.replace(/^[._]+|[._]+$/g, '');

    // If empty after cleanup, use default
    if (sanitized.length === 0) {
      sanitized = 'unnamed';
    }

    return sanitized;
  }

  /**
   * Validate that a file exists and is readable
   * 
   * @param filePath File path to validate
   * @returns True if file exists and is readable, false otherwise
   */
  static async validateFileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath, fs.constants.F_OK | fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }
}
