/**
 * Manifest Validation Module
 *
 * Validates the documentation-manifest.json from the Documenter agent
 * and provides utilities for file verification and hash computation.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import {
  DocumentationManifest,
  DocumentationManifestSchema,
  IndexableFile,
  IndexerError,
} from './types.js';
import { logger } from '../../utils/logger.js';

// =============================================================================
// Manifest Loading and Validation
// =============================================================================

/**
 * Load and validate the documentation manifest
 * @throws IndexerError if manifest not found or invalid
 */
export async function validateAndLoadManifest(): Promise<DocumentationManifest> {
  const manifestPath = path.join(process.cwd(), 'docs', 'documentation-manifest.json');

  // Check manifest exists
  try {
    await fs.access(manifestPath);
  } catch {
    throw new IndexerError(
      'IDX_MANIFEST_NOT_FOUND',
      `Manifest not found at ${manifestPath}. Run documenter first.`,
      false
    );
  }

  // Read and parse manifest
  let manifestContent: string;
  try {
    manifestContent = await fs.readFile(manifestPath, 'utf-8');
  } catch (error) {
    throw new IndexerError(
      'IDX_MANIFEST_NOT_FOUND',
      `Failed to read manifest: ${error instanceof Error ? error.message : String(error)}`,
      false
    );
  }

  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(manifestContent);
  } catch {
    throw new IndexerError(
      'IDX_MANIFEST_INVALID',
      'Manifest contains invalid JSON',
      false
    );
  }

  // Validate schema
  const parsed = DocumentationManifestSchema.safeParse(rawManifest);
  if (!parsed.success) {
    throw new IndexerError(
      'IDX_MANIFEST_INVALID',
      `Manifest validation failed: ${parsed.error.message}`,
      false
    );
  }

  const manifest = parsed.data;

  // Verify status is terminal
  if (!['complete', 'partial'].includes(manifest.status)) {
    throw new IndexerError(
      'IDX_MANIFEST_INVALID',
      'Documentation not yet complete',
      false
    );
  }

  // Verify at least one indexable file
  if (manifest.indexable_files.length === 0) {
    throw new IndexerError(
      'IDX_MANIFEST_INVALID',
      'No indexable files in manifest',
      false
    );
  }

  logger.info(`Manifest validated: ${manifest.indexable_files.length} files, status: ${manifest.status}`);

  return manifest;
}

// =============================================================================
// File Verification
// =============================================================================

export interface FileVerificationResult {
  path: string;
  exists: boolean;
  hashMatch: boolean;
  actualHash?: string;
  error?: string;
}

/**
 * Verify a single file exists and hash matches
 */
export async function verifyFile(file: IndexableFile): Promise<FileVerificationResult> {
  const fullPath = path.join(process.cwd(), 'docs', file.path);

  try {
    const content = await fs.readFile(fullPath);
    const actualHash = computeSHA256(content);

    return {
      path: file.path,
      exists: true,
      hashMatch: actualHash === file.content_hash,
      actualHash,
    };
  } catch (error) {
    return {
      path: file.path,
      exists: false,
      hashMatch: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Verify all files in manifest
 * Returns list of verification results with any issues
 */
export async function verifyAllFiles(
  manifest: DocumentationManifest
): Promise<{
  results: FileVerificationResult[];
  missingFiles: string[];
  hashMismatches: string[];
}> {
  const results = await Promise.all(
    manifest.indexable_files.map(file => verifyFile(file))
  );

  const missingFiles = results.filter(r => !r.exists).map(r => r.path);
  const hashMismatches = results.filter(r => r.exists && !r.hashMatch).map(r => r.path);

  if (missingFiles.length > 0) {
    logger.warn(`${missingFiles.length} files missing from manifest`);
  }

  if (hashMismatches.length > 0) {
    logger.warn(`${hashMismatches.length} files have hash mismatches`);
  }

  return { results, missingFiles, hashMismatches };
}

// =============================================================================
// Hash Computation
// =============================================================================

/**
 * Compute SHA-256 hash of content
 */
export function computeSHA256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Compute a stable hash for the manifest
 * Used for resume logic and staleness detection
 *
 * JSON.stringify() does not guarantee key order, which can cause false restarts.
 * This function creates a stable serialization using sorted file hashes.
 */
export function computeStableManifestHash(manifest: DocumentationManifest): string {
  // Combine plan_hash with indexable_files info for completeness
  const fileHashes = manifest.indexable_files
    .map(f => `${f.path}:${f.content_hash}`)
    .sort()
    .join('|');

  return computeSHA256(`${manifest.plan_hash}|${fileHashes}`);
}

// =============================================================================
// File Filtering
// =============================================================================

/**
 * Get files that match a specific work unit (for selective indexing)
 */
export function filterFilesByWorkUnit(
  manifest: DocumentationManifest,
  workUnitId: string
): IndexableFile[] {
  const workUnit = manifest.work_units.find(wu => wu.id === workUnitId);
  if (!workUnit) {
    logger.warn(`Work unit '${workUnitId}' not found in manifest`);
    return [];
  }

  return manifest.indexable_files.filter(
    f => f.database === workUnit.database
  );
}

/**
 * Get files that exist and have valid hashes
 */
export async function getValidFiles(
  manifest: DocumentationManifest
): Promise<IndexableFile[]> {
  const { results } = await verifyAllFiles(manifest);

  const validPaths = new Set(
    results.filter(r => r.exists).map(r => r.path)
  );

  return manifest.indexable_files.filter(f => validPaths.has(f.path));
}
