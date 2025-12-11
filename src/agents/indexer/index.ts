/**
 * Indexer Agent - Main Entry Point
 *
 * Parses generated documentation files, extracts keywords, generates embeddings,
 * and builds search index in SQLite database with FTS5 and vector indices.
 *
 * Position in Pipeline: Planner -> Documenter -> [INDEXER] -> Retriever
 */

import { Command } from 'commander';
import {
  DocumentationManifest,
  IndexableFile,
  ParsedDocument,
  ParsedTableDoc,
  IndexerOptions,
  IndexerProgress,
  IndexStats,
} from './types.js';
import { validateAndLoadManifest, getValidFiles } from './manifest.js';
import { openDatabase, closeDatabase } from './database/init.js';
import { parseDocument } from './parsers/documents.js';
import { generateColumnDocuments, findFilePathForTable } from './parsers/columns.js';
import { extractKeywordsForDocument } from './keywords.js';
import {
  generateDocumentEmbeddings,
  areEmbeddingsAvailable,
} from './embeddings.js';
import {
  sortDocumentsForIndexing,
  processDocuments,
  populateIndex,
} from './populate.js';
import { buildRelationshipsIndex } from './relationships.js';
import {
  detectChanges,
  getFilesToProcess,
  deleteDocumentsWithCascade,
  runCleanup,
} from './incremental.js';
import {
  initializeProgress,
  saveCheckpoint,
  loadCheckpoint,
  isCheckpointValid,
  updatePhase,
  markCompleted,
  markFailed,
  getProgressSummary,
  shouldSaveCheckpoint,
  updateProgressForFile,
  updateDocTypeCounts,
  updateEmbeddingStats,
} from './progress.js';
import {
  optimizeDatabase,
  getIndexStats,
  formatIndexStats,
  verifyIndexIntegrity,
} from './optimize.js';
import { logger } from '../../utils/logger.js';

// Re-export types for consumers
export * from './types.js';

// =============================================================================
// Main Indexer Entry Point
// =============================================================================

/**
 * Main indexer function - orchestrates the complete indexing pipeline
 */
export async function runIndexer(options: IndexerOptions = {}): Promise<void> {
  let db = null;
  let progress: IndexerProgress | null = null;

  try {
    logger.info('Starting document indexing phase');

    // 1. Validate and load manifest
    const manifest = await validateAndLoadManifest();
    logger.info(`Manifest loaded: ${manifest.indexable_files.length} files, status: ${manifest.status}`);

    // 2. Handle resume from checkpoint if requested
    if (options.resume) {
      const checkpoint = await loadCheckpoint();
      if (checkpoint && isCheckpointValid(checkpoint, manifest)) {
        logger.info(`Resuming from checkpoint: ${checkpoint.files_indexed}/${checkpoint.files_total} files already indexed`);
        return runResumeFromCheckpoint(checkpoint, manifest, options);
      } else {
        logger.warn('No valid checkpoint found, starting fresh');
      }
    }

    // 3. Handle incremental indexing
    if (options.incremental) {
      return runIncrementalIndex(manifest, options);
    }

    // 4. Initialize progress
    progress = initializeProgress(manifest);
    await saveCheckpoint(progress);

    // 5. Open database
    db = await openDatabase();

    // 6. Get valid files (exist and accessible)
    const validFiles = await getValidFiles(manifest);
    logger.info(`Found ${validFiles.length} valid files to index`);

    if (options.dryRun) {
      logger.info('Dry run mode - showing what would be indexed:');
      for (const file of validFiles) {
        logger.info(`  ${file.type}: ${file.path}`);
      }
      closeDatabase(db);
      return;
    }

    // 7. Index all files
    updatePhase(progress, 'parsing');
    await saveCheckpoint(progress);

    const stats = await indexFiles(db, validFiles, manifest, progress, options);

    // 8. Build relationships index
    updatePhase(progress, 'relationships');
    await saveCheckpoint(progress);
    await buildRelationshipsIndex(db);

    // 9. Optimize database
    updatePhase(progress, 'optimizing');
    await saveCheckpoint(progress);
    await optimizeDatabase(db, manifest);

    // 10. Mark complete
    markCompleted(progress);
    await saveCheckpoint(progress);

    logger.info(`Indexing completed: ${stats.inserted} inserted, ${stats.updated} updated, ${stats.failed} failed`);
    logger.info(getProgressSummary(progress));

  } catch (error) {
    logger.error('Indexing phase failed', error);

    if (progress) {
      markFailed(progress, error instanceof Error ? error : new Error(String(error)));
      await saveCheckpoint(progress);
    }

    throw error;
  } finally {
    if (db) {
      closeDatabase(db);
    }
  }
}

// =============================================================================
// Core Indexing Function
// =============================================================================

/**
 * Index a set of files - the core indexing logic
 * Handles parsing, keyword extraction, embedding generation, and population
 */
async function indexFiles(
  db: Awaited<ReturnType<typeof openDatabase>>,
  files: IndexableFile[],
  _manifest: DocumentationManifest,
  progress: IndexerProgress,
  options: IndexerOptions
): Promise<IndexStats> {
  logger.info(`Indexing ${files.length} files`);

  // 1. Parse all documents
  updatePhase(progress, 'parsing');
  const parsedDocs: ParsedDocument[] = [];

  for (const file of files) {
    try {
      progress.current_file = file.path;

      const doc = await parseDocument(file);
      parsedDocs.push(doc);

      updateProgressForFile(progress, file.path, true);

      if (shouldSaveCheckpoint(progress)) {
        await saveCheckpoint(progress);
      }
    } catch (error) {
      logger.warn(`Failed to parse ${file.path}`, error);
      updateProgressForFile(progress, file.path, false, error instanceof Error ? error : undefined);
    }
  }

  logger.info(`Parsed ${parsedDocs.length} documents`);

  // 2. Generate column documents from table documents
  const allDocs: ParsedDocument[] = [];
  for (const doc of parsedDocs) {
    allDocs.push(doc);

    if (doc.docType === 'table') {
      const tableDoc = doc as ParsedTableDoc;
      const tableFilePath = findFilePathForTable(files, tableDoc);
      const columnDocs = generateColumnDocuments(tableDoc, tableFilePath);
      allDocs.push(...columnDocs);
    }
  }

  logger.info(`Total documents including columns: ${allDocs.length}`);

  // 3. Extract keywords for all documents (except columns - done during generation)
  for (const doc of allDocs) {
    if (doc.docType !== 'column') {
      doc.keywords = extractKeywordsForDocument(doc);
    }
  }

  // 4. Sort documents so tables come before columns (for parent_doc_id linkage)
  const sortedDocs = sortDocumentsForIndexing(allDocs);

  // 5. Convert to ProcessedDocuments
  const processedDocs = processDocuments(sortedDocs, files);

  // 6. Generate embeddings (if not skipped)
  updatePhase(progress, 'embedding');
  await saveCheckpoint(progress);

  let embeddings = new Map<string, number[]>();

  if (!options.skipEmbeddings && areEmbeddingsAvailable()) {
    try {
      embeddings = await generateDocumentEmbeddings(sortedDocs);
      updateEmbeddingStats(progress, embeddings.size, 0);
      logger.info(`Generated ${embeddings.size} embeddings`);
    } catch (error) {
      logger.warn('Embedding generation failed, continuing with FTS only', error);
      updateEmbeddingStats(progress, 0, sortedDocs.length);
    }
  } else if (options.skipEmbeddings) {
    logger.info('Skipping embeddings as requested');
  } else {
    logger.warn('OPENAI_API_KEY not set - embeddings unavailable');
  }

  // 7. Populate the index
  updatePhase(progress, 'indexing');
  await saveCheckpoint(progress);

  const parentDocIds = new Map<string, number>();
  const stats = populateIndex(db, processedDocs, embeddings, parentDocIds);

  // 8. Update doc type counts
  const docCounts = {
    table: processedDocs.filter(d => d.docType === 'table').length,
    column: processedDocs.filter(d => d.docType === 'column').length,
    domain: processedDocs.filter(d => d.docType === 'domain').length,
    relationship: processedDocs.filter(d => d.docType === 'relationship').length,
  };
  updateDocTypeCounts(progress, docCounts);

  return stats;
}

// =============================================================================
// Incremental Indexing
// =============================================================================

/**
 * Run incremental index - only index new/changed files
 */
async function runIncrementalIndex(
  manifest: DocumentationManifest,
  options: IndexerOptions
): Promise<void> {
  const db = await openDatabase();

  try {
    // Detect changes
    const changes = await detectChanges(manifest, db);

    logger.info(`Incremental index: ${changes.newFiles.length} new, ${changes.changedFiles.length} changed, ${changes.deletedFiles.length} deleted, ${changes.unchangedFiles.length} unchanged`);

    // Skip if no changes
    if (changes.newFiles.length === 0 &&
        changes.changedFiles.length === 0 &&
        changes.deletedFiles.length === 0) {
      logger.info('No changes detected, skipping indexing');
      closeDatabase(db);
      return;
    }

    if (options.dryRun) {
      logger.info('Dry run mode - changes detected:');
      changes.newFiles.forEach(f => logger.info(`  NEW: ${f}`));
      changes.changedFiles.forEach(f => logger.info(`  CHANGED: ${f}`));
      changes.deletedFiles.forEach(f => logger.info(`  DELETED: ${f}`));
      closeDatabase(db);
      return;
    }

    // Initialize progress for incremental
    const progress = initializeProgress(manifest);
    progress.files_total = changes.newFiles.length + changes.changedFiles.length;
    progress.files_skipped = changes.unchangedFiles.length;
    await saveCheckpoint(progress);

    // Delete removed files first
    if (changes.deletedFiles.length > 0) {
      await deleteDocumentsWithCascade(db, changes.deletedFiles);
    }

    // Get files to process
    const filesToProcess = getFilesToProcess(manifest, changes);

    if (filesToProcess.length > 0) {
      // Index new/changed files using the same flow as full indexing
      const stats = await indexFiles(db, filesToProcess, manifest, progress, options);
      logger.info(`Incremental indexing: ${stats.inserted} inserted, ${stats.updated} updated`);
    }

    // Rebuild relationships if any table files changed
    const tableFilesChanged = filesToProcess.some(f => f.type === 'table') ||
                              changes.deletedFiles.some(f => f.includes('/tables/'));
    if (tableFilesChanged) {
      await buildRelationshipsIndex(db);
    }

    // Run cleanup
    runCleanup(db);

    // Optimize
    await optimizeDatabase(db, manifest);

    markCompleted(progress);
    await saveCheckpoint(progress);

    logger.info(`Incremental indexing complete: ${filesToProcess.length} files processed, ${changes.deletedFiles.length} deleted`);

  } finally {
    closeDatabase(db);
  }
}

// =============================================================================
// Resume from Checkpoint
// =============================================================================

/**
 * Resume indexing from a checkpoint
 */
async function runResumeFromCheckpoint(
  checkpoint: IndexerProgress,
  manifest: DocumentationManifest,
  options: IndexerOptions
): Promise<void> {
  const db = await openDatabase();

  try {
    // Get files that still need processing
    const alreadyIndexed = new Set(checkpoint.indexed_files);
    const alreadyFailed = new Set(checkpoint.failed_files);

    const pendingFiles = manifest.indexable_files.filter(
      f => !alreadyIndexed.has(f.path) && !alreadyFailed.has(f.path)
    );

    logger.info(`Resuming: ${pendingFiles.length} files remaining`);

    // Update progress
    checkpoint.status = 'running';
    checkpoint.pending_files = pendingFiles.map(f => f.path);
    await saveCheckpoint(checkpoint);

    if (pendingFiles.length === 0) {
      logger.info('No pending files, completing...');
    } else {
      // Continue processing
      await indexFiles(db, pendingFiles, manifest, checkpoint, options);
    }

    // Build relationships
    await buildRelationshipsIndex(db);

    // Optimize
    await optimizeDatabase(db, manifest);

    // Complete
    markCompleted(checkpoint);
    await saveCheckpoint(checkpoint);

    logger.info('Resume complete');

  } finally {
    closeDatabase(db);
  }
}

// =============================================================================
// CLI Interface
// =============================================================================

/**
 * Show index statistics
 */
async function showStats(): Promise<void> {
  const db = await openDatabase();
  const stats = getIndexStats(db);
  console.log(formatIndexStats(stats));
  closeDatabase(db);
}

/**
 * Verify index integrity
 */
async function verifyIndex(): Promise<void> {
  const db = await openDatabase();
  const issues = verifyIndexIntegrity(db);

  if (issues.length === 0) {
    console.log('Index integrity: OK');
  } else {
    console.log('Index issues found:');
    issues.forEach(issue => console.log(`  - ${issue}`));
  }

  closeDatabase(db);
}

// CLI entry point
const program = new Command();

program
  .name('indexer')
  .description('Build search index from documentation')
  .option('-i, --incremental', 'Only index changed files')
  .option('-r, --resume', 'Resume from last checkpoint')
  .option('-f, --force', 'Force full re-index')
  .option('--skip-embeddings', 'Skip embedding generation (FTS only)')
  .option('--dry-run', 'Show what would be indexed')
  .option('--work-unit <id>', 'Index only specific work unit')
  .option('--stats', 'Show index statistics')
  .option('--verify', 'Verify index integrity')
  .action(async (opts) => {
    try {
      if (opts.stats) {
        await showStats();
        return;
      }

      if (opts.verify) {
        await verifyIndex();
        return;
      }

      await runIndexer({
        incremental: opts.incremental,
        resume: opts.resume,
        force: opts.force,
        skipEmbeddings: opts.skipEmbeddings,
        dryRun: opts.dryRun,
        workUnit: opts.workUnit,
      });
    } catch (error) {
      logger.error('Indexer failed', error);
      process.exit(1);
    }
  });

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  program.parse();
}

// Export for programmatic use
export {
  indexFiles,
  runIncrementalIndex,
  showStats,
  verifyIndex,
};
