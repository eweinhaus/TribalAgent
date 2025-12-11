/**
 * Manifest Generator
 * 
 * Generates documentation manifest with file listing, content hashes,
 * and metadata for handoff to Indexer.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { logger } from '../../utils/logger.js';
import { createAgentError, ErrorCodes } from './errors.js';
import { computeOverallStatus } from './status.js';
import type {
  DocumentationManifest,
  DatabaseManifest,
  WorkUnitManifest,
  IndexableFile,
  DocumenterProgress,
  DocumentationPlan,
  ContentHash,
  ISOTimestamp,
} from './types.js';

// Get docs directory - use TRIBAL_DOCS_PATH if set, otherwise default to docs/ in cwd
// Note: This is evaluated at module load time, so environment variable must be set before import
function getDocsDir(): string {
  return process.env.TRIBAL_DOCS_PATH || path.join(process.cwd(), 'docs');
}

/**
 * File metadata collected during scanning
 */
interface FileMetadata {
  path: string;
  size_bytes: number;
  modified_at: ISOTimestamp;
  file_type: 'markdown' | 'json';
}

/**
 * Generate documentation manifest
 * 
 * @param progress Documenter progress
 * @param plan Documentation plan
 * @returns Generated manifest
 */
export async function generateManifest(
  progress: DocumenterProgress,
  plan: DocumentationPlan
): Promise<DocumentationManifest> {
  logger.info('Starting manifest generation');

  try {
    // Scan all output files
    const files = await scanOutputFiles();
    logger.info(`Scanned ${files.length} files`);

    // Compute hashes and collect metadata
    const indexableFiles: IndexableFile[] = [];
    let processedCount = 0;

    for (const file of files) {
      try {
        const metadata = await collectFileMetadata(file);
        const contentHash = await computeFileHash(file);
        
        // Parse file path to extract database, schema, table, domain info
        const fileInfo = parseFilePath(file, plan);
        
        const docsDir = getDocsDir();
        indexableFiles.push({
          path: path.relative(docsDir, file),
          type: fileInfo.type,
          database: fileInfo.database,
          schema: fileInfo.schema,
          table: fileInfo.table,
          domain: fileInfo.domain,
          content_hash: contentHash,
          size_bytes: metadata.size_bytes,
          modified_at: metadata.modified_at,
        });

        processedCount++;
        if (processedCount % 10 === 0) {
          logger.debug(`Processed ${processedCount}/${files.length} files`);
        }
      } catch (error) {
        logger.warn(`Failed to process file ${file}`, {
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue processing other files
      }
    }

    logger.info(`Processed ${processedCount} files for manifest`);

    // Build manifest structure
    const manifest = buildManifestStructure(
      progress,
      plan,
      indexableFiles
    );

    // Validate manifest
    const validationResult = await validateManifest(manifest);
    if (!validationResult.valid) {
      logger.warn('Manifest validation found issues', {
        errors: validationResult.errors,
        warnings: validationResult.warnings,
      });
      
      // Set status to partial if files are missing
      if (validationResult.missingFiles.length > 0) {
        manifest.status = 'partial';
      }
    }

    logger.info('Manifest generation completed', {
      totalFiles: manifest.total_files,
      status: manifest.status,
      databases: manifest.databases.length,
      workUnits: manifest.work_units.length,
    });

    return manifest;
  } catch (error) {
    logger.error('Manifest generation failed', error);
    throw createAgentError(
      ErrorCodes.DOC_MANIFEST_WRITE_FAILED,
      `Failed to generate manifest: ${error instanceof Error ? error.message : String(error)}`,
      'fatal',
      false,
      { originalError: String(error) }
    );
  }
}

/**
 * Scan output directory for all generated files
 * 
 * @returns Array of absolute file paths
 */
async function scanOutputFiles(): Promise<string[]> {
  const files: string[] = [];

  async function scanDirectory(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await scanDirectory(fullPath);
        } else if (entry.isFile()) {
          // Only include .md and .json files
          const ext = path.extname(entry.name).toLowerCase();
          if (ext === '.md' || ext === '.json') {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      // Log but continue - directory might not exist or be inaccessible
      logger.debug(`Failed to scan directory ${dir}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Get docs directory (check at runtime, not module load time)
  const docsDir = getDocsDir();
  
  // Start scanning from docs directory
  if (await directoryExists(docsDir)) {
    await scanDirectory(docsDir);
  } else {
    logger.warn('Docs directory does not exist, manifest will be empty');
  }

  return files;
}

/**
 * Check if directory exists
 */
async function directoryExists(dir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Compute SHA-256 content hash for a file
 * 
 * @param filePath Absolute path to file
 * @returns SHA-256 hash as hex string (64 characters)
 */
export async function computeFileHash(filePath: string): Promise<ContentHash> {
  try {
    const fileBuffer = await fs.readFile(filePath);
    const hash = crypto.createHash('sha256');
    hash.update(fileBuffer);
    return hash.digest('hex');
  } catch (error) {
    throw new Error(
      `Failed to compute hash for ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Collect file metadata (size, modified time, file type)
 * 
 * @param filePath Absolute path to file
 * @returns File metadata
 */
async function collectFileMetadata(filePath: string): Promise<FileMetadata> {
  try {
    const stat = await fs.stat(filePath);
    const ext = path.extname(filePath).toLowerCase();
    
    let fileType: 'markdown' | 'json';
    if (ext === '.md') {
      fileType = 'markdown';
    } else if (ext === '.json') {
      fileType = 'json';
    } else {
      throw new Error(`Unknown file type for extension: ${ext}`);
    }

    return {
      path: filePath,
      size_bytes: stat.size,
      modified_at: stat.mtime.toISOString(),
      file_type: fileType,
    };
  } catch (error) {
    throw new Error(
      `Failed to collect metadata for ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Parse file path to extract database, schema, table, domain info
 * 
 * Expected path structure: docs/{work_unit.output_directory}/tables/{schema}.{table}.{ext}
 * Where work_unit.output_directory is: databases/{database}/domains/{domain}
 * 
 * @param filePath Absolute file path
 * @param plan Documentation plan
 * @returns Parsed file information
 */
function parseFilePath(
  filePath: string,
  plan: DocumentationPlan
): {
  type: 'table' | 'domain' | 'overview' | 'relationship';
  database: string;
  schema?: string;
  table?: string;
  domain?: string;
} {
  const docsDir = getDocsDir();
  const relativePath = path.relative(docsDir, filePath);
  const pathParts = relativePath.split(path.sep);

  // Expected structure: databases/{database}/domains/{domain}/tables/{schema}.{table}.{ext}
  if (pathParts.length >= 5 && pathParts[0] === 'databases' && pathParts[2] === 'domains' && pathParts[4] === 'tables') {
    const database = pathParts[1];
    const domain = pathParts[3];
    const fileName = pathParts[5];
    const ext = path.extname(fileName);
    const baseName = path.basename(fileName, ext);

    // Parse schema.table from filename
    const parts = baseName.split('.');
    if (parts.length >= 2) {
      const schema = parts.slice(0, -1).join('.'); // Handle schemas with dots
      const table = parts[parts.length - 1];

      return {
        type: 'table',
        database,
        schema,
        table,
        domain,
      };
    }
  }

  // Fallback: try to match with work unit output directories
  for (const workUnit of plan.work_units) {
    if (relativePath.startsWith(workUnit.output_directory)) {
      return {
        type: 'table', // Default to table for now
        database: workUnit.database,
        domain: workUnit.domain,
      };
    }
  }

  // Last resort: extract database from path if possible
  const databaseIndex = pathParts.indexOf('databases');
  if (databaseIndex >= 0 && databaseIndex + 1 < pathParts.length) {
    return {
      type: 'table',
      database: pathParts[databaseIndex + 1],
    };
  }

  // Unknown structure
  logger.warn(`Could not parse file path: ${relativePath}`);
  return {
    type: 'table',
    database: 'unknown',
  };
}

/**
 * Build complete manifest structure
 * 
 * @param progress Documenter progress
 * @param plan Documentation plan
 * @param indexableFiles Scanned and processed files
 * @returns Complete manifest
 */
function buildManifestStructure(
  progress: DocumenterProgress,
  plan: DocumentationPlan,
  indexableFiles: IndexableFile[]
): DocumentationManifest {
  // Determine manifest status
  const overallStatus = computeOverallStatus(
    Object.values(progress.work_units),
    false
  );
  const manifestStatus: 'complete' | 'partial' = 
    overallStatus === 'completed' ? 'complete' : 'partial';

  // Build database manifests
  const databaseManifests: DatabaseManifest[] = plan.databases.map(db => {
    // Count tables documented/failed for this database
    const workUnitsForDb = plan.work_units.filter(wu => wu.database === db.name);
    let tablesDocumented = 0;
    let tablesFailed = 0;
    const domains = new Set<string>();

    for (const wu of workUnitsForDb) {
      const wuProgress = progress.work_units[wu.id];
      if (wuProgress) {
        tablesDocumented += wuProgress.tables_completed;
        tablesFailed += wuProgress.tables_failed;
      }
      domains.add(wu.domain);
    }

    return {
      name: db.name,
      type: db.type,
      docs_directory: `databases/${db.name}`,
      tables_documented: tablesDocumented,
      tables_failed: tablesFailed,
      domains: Array.from(domains),
    };
  });

  // Build work unit manifests
  const workUnitManifests: WorkUnitManifest[] = plan.work_units.map(wu => {
    const wuProgress = progress.work_units[wu.id];
    
    // Determine work unit status
    let wuStatus: 'completed' | 'failed' | 'partial';
    if (!wuProgress) {
      wuStatus = 'failed';
    } else if (wuProgress.status === 'completed') {
      wuStatus = 'completed';
    } else if (wuProgress.status === 'failed') {
      wuStatus = 'failed';
    } else {
      wuStatus = 'partial';
    }

    // Count files for this work unit
    const filesForWorkUnit = indexableFiles.filter(f =>
      f.path.startsWith(wu.output_directory)
    );

    // Compute output hash (hash of all file hashes for this work unit)
    const outputHash = computeWorkUnitOutputHash(filesForWorkUnit);

    return {
      id: wu.id,
      status: wuStatus,
      output_directory: wu.output_directory,
      files_generated: filesForWorkUnit.length,
      output_hash: outputHash,
      reprocessable: true, // Work units can be re-processed independently
      errors: wuProgress?.errors || [],
    };
  });

  return {
    schema_version: '1.0',
    completed_at: progress.completed_at || new Date().toISOString(),
    plan_hash: progress.plan_hash,
    status: manifestStatus,
    databases: databaseManifests,
    work_units: workUnitManifests,
    total_files: indexableFiles.length,
    indexable_files: indexableFiles,
  };
}

/**
 * Compute hash of work unit output (hash of all file hashes)
 */
function computeWorkUnitOutputHash(files: IndexableFile[]): ContentHash {
  if (files.length === 0) {
    // Return empty hash for empty work units
    return '0'.repeat(64);
  }

  // Sort files by path for consistent hashing
  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));
  
  // Create hash of all file hashes
  const hash = crypto.createHash('sha256');
  for (const file of sortedFiles) {
    hash.update(file.content_hash);
  }
  
  return hash.digest('hex');
}

/**
 * Validation result
 */
interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  missingFiles: string[];
}

/**
 * Validate manifest structure and file existence
 * 
 * @param manifest Manifest to validate
 * @returns Validation result
 */
async function validateManifest(
  manifest: DocumentationManifest
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const missingFiles: string[] = [];

  // Validate required fields
  if (!manifest.schema_version || manifest.schema_version !== '1.0') {
    errors.push('Invalid schema_version');
  }

  if (!manifest.completed_at) {
    errors.push('Missing completed_at');
  }

  if (!manifest.plan_hash) {
    errors.push('Missing plan_hash');
  }

  if (!manifest.status || (manifest.status !== 'complete' && manifest.status !== 'partial')) {
    errors.push('Invalid status');
  }

  // Validate file existence
  const docsDir = getDocsDir();
  for (const file of manifest.indexable_files) {
    const fullPath = path.join(docsDir, file.path);
    try {
      await fs.access(fullPath);
    } catch {
      missingFiles.push(file.path);
      warnings.push(`File listed in manifest does not exist: ${file.path}`);
    }
  }

  // Validate file count matches
  if (manifest.total_files !== manifest.indexable_files.length) {
    warnings.push(
      `total_files (${manifest.total_files}) does not match indexable_files length (${manifest.indexable_files.length})`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    missingFiles,
  };
}

/**
 * Write manifest to file with atomic write
 * 
 * @param manifest Manifest to write
 * @param manifestPath Path to manifest file (default: docs/documentation-manifest.json)
 */
export async function writeManifest(
  manifest: DocumentationManifest,
  manifestPath?: string
): Promise<void> {
  // Use provided path or default to docs directory
  const docsDir = getDocsDir();
  const defaultPath = path.join(docsDir, 'documentation-manifest.json');
  const finalPath = manifestPath || defaultPath;
  const tempPath = `${finalPath}.tmp`;

  try {
    // Ensure directory exists
    await fs.mkdir(path.dirname(finalPath), { recursive: true });

    // Write to temp file
    await fs.writeFile(
      tempPath,
      JSON.stringify(manifest, null, 2),
      'utf-8'
    );

    // Atomic rename
    await fs.rename(tempPath, finalPath);

    logger.info('Manifest written successfully', { path: finalPath });
  } catch (error) {
    // Clean up temp file
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    throw createAgentError(
      ErrorCodes.DOC_MANIFEST_WRITE_FAILED,
      `Failed to write manifest to ${finalPath}: ${errorMessage}`,
      'fatal',
      false,
      { manifestPath: finalPath, originalError: errorMessage }
    );
  }
}
