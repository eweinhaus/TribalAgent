/**
 * Agent 2: Database Documenter
 *
 * Executes documentation plan using work unit-based processing.
 * Processes work units sequentially by priority, tracks progress,
 * and supports checkpoint recovery.
 */

import { logger } from '../../utils/logger.js';
import { loadAndValidatePlan } from './plan-loader.js';
import { 
  saveDocumenterProgress
} from './progress.js';
import { shouldResumeFromCheckpoint, computePlanHash } from './recovery.js';
import { processWorkUnits } from './work-unit-processor.js';
import { computeOverallStatus } from './status.js';
import { createAgentError, ErrorCodes } from './errors.js';
import { generateManifest, writeManifest } from './manifest-generator.js';
import type {
  DocumenterProgress,
  DocumentationPlan,
  DocumenterStats,
} from './types.js';

/**
 * Shutdown flag to prevent new work when shutdown is requested
 */
let shutdownRequested = false;

/**
 * Current plan being processed (for shutdown handler)
 */
let currentPlan: DocumentationPlan | null = null;

/**
 * Current progress being tracked (for shutdown handler)
 */
let currentProgress: DocumenterProgress | null = null;

/**
 * Main entry point for documenter agent
 * 
 * Orchestrates the documentation process:
 * 1. Load and validate plan
 * 2. Check for checkpoint recovery
 * 3. Process work units sequentially
 * 4. Update progress and status
 * 5. Generate manifest
 */
export async function runDocumenter(): Promise<void> {
  try {
    logger.info('Starting database documentation phase');

    // Set up graceful shutdown handlers
    setupShutdownHandlers();

    // Load and validate plan
    const plan = await loadAndValidatePlan();
    currentPlan = plan;
    logger.info('Plan loaded and validated', {
      workUnits: plan.work_units.length,
      totalTables: plan.summary.total_tables,
      complexity: plan.complexity,
    });

    // Check for checkpoint recovery
    const resumeInfo = await shouldResumeFromCheckpoint(plan);
    
    let progress: DocumenterProgress;
    let startIndex: number;

    if (resumeInfo) {
      // Resume from checkpoint
      logger.info('Resuming from checkpoint');
      progress = resumeInfo.progress;
      startIndex = resumeInfo.startFromWorkUnitIndex;
    } else {
      // Initialize new progress
      logger.info('Starting fresh documentation run');
      progress = initializeProgress(plan);
      startIndex = 0;
      await saveDocumenterProgress(progress);
    }

    currentProgress = progress;

    // Process work units
    try {
      await processWorkUnits(plan, progress, startIndex, () => shutdownRequested);
    } catch (error) {
      // Fatal error during processing
      logger.error('Fatal error during work unit processing', error);
      progress.errors.push(
        createAgentError(
          ErrorCodes.DOC_WORK_UNIT_FAILED,
          `Fatal error: ${error instanceof Error ? error.message : String(error)}`,
          'fatal',
          false,
          { error: String(error) }
        )
      );
      progress.status = computeOverallStatus(
        Object.values(progress.work_units),
        true // fatal error
      );
      progress.completed_at = new Date().toISOString();
      await saveDocumenterProgress(progress);
      
      // Generate manifest even on fatal error (partial status)
      await generateAndWriteManifest(progress, plan);
      
      throw error;
    }

    // Mark as completed
    progress.status = computeOverallStatus(
      Object.values(progress.work_units),
      false
    );
    progress.completed_at = new Date().toISOString();
    await saveDocumenterProgress(progress);

    logger.info('Database documentation phase completed', {
      status: progress.status,
      completedTables: progress.stats.completed_tables,
      failedTables: progress.stats.failed_tables,
      workUnitsCompleted: Object.values(progress.work_units)
        .filter(wu => wu.status === 'completed').length,
    });

    // Generate manifest on successful completion
    await generateAndWriteManifest(progress, plan);

  } catch (error) {
    logger.error('Documentation phase failed', error);
    
    // Try to generate manifest even on failure
    if (currentProgress && currentPlan) {
      try {
        await generateAndWriteManifest(currentProgress, currentPlan);
      } catch (manifestError) {
        logger.error('Failed to generate manifest on error', manifestError);
      }
    }
    
    throw error;
  } finally {
    // Clean up
    currentPlan = null;
    currentProgress = null;
  }
}

/**
 * Generate and write manifest
 * 
 * @param progress Documenter progress
 * @param plan Documentation plan
 */
async function generateAndWriteManifest(
  progress: DocumenterProgress,
  plan: DocumentationPlan
): Promise<void> {
  try {
    logger.info('Generating documentation manifest');
    const manifest = await generateManifest(progress, plan);
    await writeManifest(manifest);
    logger.info('Manifest generated and written successfully');
  } catch (error) {
    // Log error but don't throw - manifest generation failure shouldn't crash documenter
    // unless it's a write failure (which is already fatal)
    logger.error('Failed to generate manifest', error);
    
    // If it's a write failure, it's already a fatal error, so re-throw
    if (error instanceof Error && error.message.includes('DOC_MANIFEST_WRITE_FAILED')) {
      throw error;
    }
  }
}

/**
 * Set up graceful shutdown handlers
 */
function setupShutdownHandlers(): void {
  const shutdownHandler = async (signal: string) => {
    logger.info(`Received ${signal}, initiating graceful shutdown`);
    shutdownRequested = true;

    // Wait a bit for current work to complete (with timeout)
    await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second grace period

    if (currentProgress && currentPlan) {
      // Update progress status to 'partial'
      currentProgress.status = 'partial';
      currentProgress.completed_at = new Date().toISOString();
      
      try {
        await saveDocumenterProgress(currentProgress);
        logger.info('Progress saved on shutdown');
      } catch (error) {
        logger.error('Failed to save progress on shutdown', error);
      }

      // Generate manifest
      try {
        await generateAndWriteManifest(currentProgress, currentPlan);
        logger.info('Manifest generated on shutdown');
      } catch (error) {
        logger.error('Failed to generate manifest on shutdown', error);
      }
    }

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
  process.on('SIGINT', () => shutdownHandler('SIGINT'));
}

/**
 * Initialize new documenter progress
 * 
 * @param plan Documentation plan
 * @returns Initialized progress object
 */
function initializeProgress(plan: DocumentationPlan): DocumenterProgress {
  const now = new Date().toISOString();
  const planHash = computePlanHash(plan);

  // Calculate total tables from work units
  const totalTables = plan.work_units.reduce(
    (sum, wu) => sum + wu.tables.length,
    0
  );

  const stats: DocumenterStats = {
    total_tables: totalTables,
    completed_tables: 0,
    failed_tables: 0,
    skipped_tables: 0,
    llm_tokens_used: 0,
    llm_time_ms: 0,
    db_query_time_ms: 0,
  };

  return {
    schema_version: '1.0',
    started_at: now,
    completed_at: null,
    status: 'running',
    plan_file: 'progress/documentation-plan.json',
    plan_hash: planHash,
    work_units: {},
    stats,
    last_checkpoint: now,
    errors: [],
  };
}
