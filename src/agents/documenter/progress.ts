/**
 * Progress File Utilities
 * 
 * Handles atomic writes and reads of progress files for checkpoint recovery.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { logger } from '../../utils/logger.js';
import type {
  DocumenterProgress,
  WorkUnitProgress,
} from './types.js';

// Get progress directory - support test environment override
function getProgressDir(): string {
  if (process.env.TEST_PROGRESS_DIR) {
    return path.join(process.env.TEST_PROGRESS_DIR, 'progress');
  }
  return path.join(process.cwd(), 'progress');
}

function getDocumenterProgressFile(): string {
  return path.join(getProgressDir(), 'documenter-progress.json');
}

/**
 * Save documenter progress with atomic write
 * 
 * Uses write-to-temp-then-rename pattern to ensure atomicity.
 * 
 * @param progress Progress data to save
 */
export async function saveDocumenterProgress(progress: DocumenterProgress): Promise<void> {
  const progressDir = getProgressDir();
  const progressFile = getDocumenterProgressFile();
  const tempPath = `${progressFile}.tmp`;
  
  try {
    // Ensure directory exists
    await fs.mkdir(progressDir, { recursive: true });
    
    // Write to temp file
    await fs.writeFile(tempPath, JSON.stringify(progress, null, 2), 'utf-8');
    
    // Atomic rename
    await fs.rename(tempPath, progressFile);
    
  } catch (error) {
    // Log error but don't throw (progress save failures shouldn't stop processing)
    logger.error('Failed to save documenter progress', {
      error: error instanceof Error ? error.message : String(error),
      path: getDocumenterProgressFile(),
    });
    
    // Clean up temp file if it exists
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Load documenter progress from file
 * 
 * @returns DocumenterProgress or null if file doesn't exist
 */
export async function loadDocumenterProgress(): Promise<DocumenterProgress | null> {
  try {
    const progressFile = getDocumenterProgressFile();
    const content = await fs.readFile(progressFile, 'utf-8');
    const progress = JSON.parse(content) as DocumenterProgress;
    
    // Basic validation
    if (!progress.schema_version || !progress.status) {
      logger.warn('Invalid progress file structure', { progress });
      return null;
    }
    
    return progress;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // File doesn't exist - this is normal for first run
      return null;
    }
    
    // Corrupted file - log warning and return null
    logger.warn('Failed to load documenter progress (corrupted file?)', {
      error: error instanceof Error ? error.message : String(error),
      path: getDocumenterProgressFile(),
    });
    
    return null;
  }
}

/**
 * Save work unit progress with atomic write
 * 
 * @param workUnitId Work unit identifier
 * @param progress Work unit progress data
 */
export async function saveWorkUnitProgress(
  workUnitId: string,
  progress: WorkUnitProgress
): Promise<void> {
  const progressDir = getProgressDir();
  const workUnitDir = path.join(progressDir, 'work_units', workUnitId);
  const progressFile = path.join(workUnitDir, 'progress.json');
  const tempPath = `${progressFile}.tmp`;
  
  try {
    // Ensure directory exists
    await fs.mkdir(workUnitDir, { recursive: true });
    
    // Write to temp file
    await fs.writeFile(tempPath, JSON.stringify(progress, null, 2), 'utf-8');
    
    // Atomic rename
    await fs.rename(tempPath, progressFile);
    
  } catch (error) {
    // Log error but don't throw
    logger.error('Failed to save work unit progress', {
      error: error instanceof Error ? error.message : String(error),
      workUnitId,
      path: progressFile,
    });
    
    // Clean up temp file if it exists
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Load work unit progress from file
 * 
 * @param workUnitId Work unit identifier
 * @returns WorkUnitProgress or null if file doesn't exist
 */
export async function loadWorkUnitProgress(
  workUnitId: string
): Promise<WorkUnitProgress | null> {
  const progressDir = getProgressDir();
  const progressFile = path.join(progressDir, 'work_units', workUnitId, 'progress.json');
  
  try {
    const content = await fs.readFile(progressFile, 'utf-8');
    const progress = JSON.parse(content) as WorkUnitProgress;
    
    // Basic validation
    if (!progress.work_unit_id || progress.work_unit_id !== workUnitId) {
      logger.warn('Invalid work unit progress file structure', { workUnitId, progress });
      return null;
    }
    
    return progress;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // File doesn't exist - this is normal for first run
      return null;
    }
    
    // Corrupted file - log warning and return null
    logger.warn('Failed to load work unit progress (corrupted file?)', {
      error: error instanceof Error ? error.message : String(error),
      workUnitId,
      path: progressFile,
    });
    
    return null;
  }
}

/**
 * Update LLM token usage in documenter stats
 * 
 * @param progress Documenter progress to update
 * @param tokens Token usage from LLM call
 */
export function updateTokenUsage(
  progress: DocumenterProgress,
  tokens: { prompt: number; completion: number; total: number }
): void {
  progress.stats.llm_tokens_used += tokens.total;
  
  // Log periodic token usage (every 10k tokens)
  if (progress.stats.llm_tokens_used % 10000 < tokens.total) {
    logger.info(`Total LLM tokens used: ${progress.stats.llm_tokens_used}`);
  }
  
  // Warn if token usage is very high
  if (progress.stats.llm_tokens_used > 100000) {
    logger.warn(`High cumulative token usage: ${progress.stats.llm_tokens_used} tokens`);
  }
}

/**
 * Update LLM timing in documenter stats
 * 
 * @param progress Documenter progress to update
 * @param durationMs Duration of LLM call in milliseconds
 */
export function updateLLMTiming(
  progress: DocumenterProgress,
  durationMs: number
): void {
  progress.stats.llm_time_ms += durationMs;
}

/**
 * Update database query timing in documenter stats
 * 
 * @param progress Documenter progress to update
 * @param durationMs Duration of database query in milliseconds
 */
export function updateDBQueryTiming(
  progress: DocumenterProgress,
  durationMs: number
): void {
  progress.stats.db_query_time_ms += durationMs;
}

