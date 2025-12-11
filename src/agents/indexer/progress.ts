/**
 * Progress and Resume Support Module
 *
 * Handles checkpoint saving, progress tracking, and resume from checkpoint.
 */

import { promises as fs } from 'fs';
import path from 'path';
import {
  DocumentationManifest,
  IndexerProgress,
  IndexerProgressSchema,
  AgentError,
} from './types.js';
import { computeStableManifestHash } from './manifest.js';
import { logger } from '../../utils/logger.js';

// =============================================================================
// Configuration
// =============================================================================

const PROGRESS_PATH = 'progress/indexer-progress.json';
const CHECKPOINT_INTERVAL = 100;  // Save every 100 files

// =============================================================================
// Progress Initialization
// =============================================================================

/**
 * Initialize progress with stable manifest hash
 * Called when starting a fresh index run
 */
export function initializeProgress(manifest: DocumentationManifest): IndexerProgress {
  return {
    schema_version: '1.0',
    started_at: new Date().toISOString(),
    completed_at: null,
    status: 'running',
    manifest_file: 'docs/documentation-manifest.json',
    manifest_hash: computeStableManifestHash(manifest),
    files_total: manifest.indexable_files.length,
    files_indexed: 0,
    files_failed: 0,
    files_skipped: 0,
    current_phase: 'validating',
    embeddings_generated: 0,
    embeddings_failed: 0,
    last_checkpoint: new Date().toISOString(),
    indexed_files: [],
    failed_files: [],
    pending_files: manifest.indexable_files.map(f => f.path),
    errors: [],
    stats: {
      parse_time_ms: 0,
      embedding_time_ms: 0,
      index_time_ms: 0,
      total_time_ms: 0,
      table_docs: 0,
      column_docs: 0,
      domain_docs: 0,
      relationship_docs: 0,
    },
  };
}

// =============================================================================
// Checkpoint Management
// =============================================================================

/**
 * Save progress checkpoint to file
 */
export async function saveCheckpoint(progress: IndexerProgress): Promise<void> {
  const progressPath = path.join(process.cwd(), PROGRESS_PATH);

  progress.last_checkpoint = new Date().toISOString();

  await fs.mkdir(path.dirname(progressPath), { recursive: true });
  await fs.writeFile(progressPath, JSON.stringify(progress, null, 2));

  logger.debug(`Checkpoint saved: ${progress.files_indexed}/${progress.files_total} files`);
}

/**
 * Load existing progress from checkpoint
 */
export async function loadCheckpoint(): Promise<IndexerProgress | null> {
  const progressPath = path.join(process.cwd(), PROGRESS_PATH);

  try {
    const content = await fs.readFile(progressPath, 'utf-8');
    const data = JSON.parse(content);

    // Validate schema
    const parsed = IndexerProgressSchema.safeParse(data);
    if (!parsed.success) {
      logger.warn('Invalid checkpoint format, cannot resume');
      return null;
    }

    return parsed.data;
  } catch (error) {
    // File doesn't exist or can't be read
    return null;
  }
}

/**
 * Check if checkpoint is valid for resuming
 */
export function isCheckpointValid(
  checkpoint: IndexerProgress,
  manifest: DocumentationManifest
): boolean {
  // Can only resume from running or failed status
  if (checkpoint.status !== 'running' && checkpoint.status !== 'failed') {
    return false;
  }

  // Manifest hash must match
  const currentHash = computeStableManifestHash(manifest);
  if (checkpoint.manifest_hash !== currentHash) {
    logger.debug(`Manifest hash mismatch: ${checkpoint.manifest_hash} vs ${currentHash}`);
    return false;
  }

  return true;
}

/**
 * Delete checkpoint file
 */
export async function deleteCheckpoint(): Promise<void> {
  const progressPath = path.join(process.cwd(), PROGRESS_PATH);

  try {
    await fs.unlink(progressPath);
    logger.debug('Checkpoint deleted');
  } catch {
    // File doesn't exist, that's fine
  }
}

// =============================================================================
// Progress Updates
// =============================================================================

/**
 * Update progress for file processing
 */
export function updateProgressForFile(
  progress: IndexerProgress,
  filePath: string,
  success: boolean,
  error?: Error
): void {
  progress.current_file = filePath;
  progress.pending_files = progress.pending_files.filter(f => f !== filePath);

  if (success) {
    progress.indexed_files.push(filePath);
    progress.files_indexed++;
  } else {
    progress.failed_files.push(filePath);
    progress.files_failed++;

    if (error) {
      progress.errors.push({
        code: 'IDX_FILE_FAILED',
        message: error.message,
        context: { file: filePath },
        timestamp: new Date().toISOString(),
      });
    }
  }
}

/**
 * Check if checkpoint should be saved (based on interval)
 */
export function shouldSaveCheckpoint(progress: IndexerProgress): boolean {
  return progress.files_indexed % CHECKPOINT_INTERVAL === 0;
}

/**
 * Update progress phase
 */
export function updatePhase(
  progress: IndexerProgress,
  phase: IndexerProgress['current_phase']
): void {
  progress.current_phase = phase;
}

/**
 * Mark progress as completed
 */
export function markCompleted(progress: IndexerProgress): void {
  progress.status = progress.files_failed > 0 ? 'partial' : 'completed';
  progress.completed_at = new Date().toISOString();
  progress.current_file = undefined;

  // Calculate total time
  const startTime = new Date(progress.started_at).getTime();
  const endTime = new Date(progress.completed_at).getTime();
  progress.stats.total_time_ms = endTime - startTime;
}

/**
 * Mark progress as failed
 */
export function markFailed(progress: IndexerProgress, error: Error): void {
  progress.status = 'failed';
  progress.completed_at = new Date().toISOString();

  progress.errors.push({
    code: 'IDX_FATAL_ERROR',
    message: error.message,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Add error to progress
 */
export function addError(progress: IndexerProgress, error: AgentError): void {
  progress.errors.push({
    ...error,
    timestamp: error.timestamp || new Date().toISOString(),
  });
}

// =============================================================================
// Stats Tracking
// =============================================================================

/**
 * Update doc type counts in progress
 */
export function updateDocTypeCounts(
  progress: IndexerProgress,
  counts: {
    table?: number;
    column?: number;
    domain?: number;
    relationship?: number;
  }
): void {
  if (counts.table !== undefined) progress.stats.table_docs = counts.table;
  if (counts.column !== undefined) progress.stats.column_docs = counts.column;
  if (counts.domain !== undefined) progress.stats.domain_docs = counts.domain;
  if (counts.relationship !== undefined) progress.stats.relationship_docs = counts.relationship;
}

/**
 * Update timing stats
 */
export function updateTimingStats(
  progress: IndexerProgress,
  timing: {
    parse_time_ms?: number;
    embedding_time_ms?: number;
    index_time_ms?: number;
  }
): void {
  if (timing.parse_time_ms !== undefined) {
    progress.stats.parse_time_ms += timing.parse_time_ms;
  }
  if (timing.embedding_time_ms !== undefined) {
    progress.stats.embedding_time_ms += timing.embedding_time_ms;
  }
  if (timing.index_time_ms !== undefined) {
    progress.stats.index_time_ms += timing.index_time_ms;
  }
}

/**
 * Update embedding stats
 */
export function updateEmbeddingStats(
  progress: IndexerProgress,
  generated: number,
  failed: number
): void {
  progress.embeddings_generated += generated;
  progress.embeddings_failed += failed;
}

// =============================================================================
// Progress Reporting
// =============================================================================

/**
 * Get a human-readable status summary
 */
export function getProgressSummary(progress: IndexerProgress): string {
  const lines = [
    `Status: ${progress.status}`,
    `Files: ${progress.files_indexed}/${progress.files_total} indexed`,
  ];

  if (progress.files_failed > 0) {
    lines.push(`Failed: ${progress.files_failed}`);
  }

  if (progress.files_skipped > 0) {
    lines.push(`Skipped: ${progress.files_skipped}`);
  }

  lines.push(`Phase: ${progress.current_phase}`);

  if (progress.embeddings_generated > 0) {
    lines.push(`Embeddings: ${progress.embeddings_generated}`);
  }

  if (progress.errors.length > 0) {
    lines.push(`Errors: ${progress.errors.length}`);
  }

  return lines.join(' | ');
}

/**
 * Get checkpoint interval
 */
export function getCheckpointInterval(): number {
  return CHECKPOINT_INTERVAL;
}
