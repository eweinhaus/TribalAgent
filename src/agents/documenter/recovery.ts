/**
 * Checkpoint Recovery Logic
 * 
 * Handles resuming from existing progress files on documenter start.
 */

import * as crypto from 'crypto';
import { logger } from '../../utils/logger.js';
import { loadDocumenterProgress } from './progress.js';
import type {
  DocumenterProgress,
  DocumentationPlan,
} from './types.js';

/**
 * Resume information from checkpoint
 */
export interface ResumeInfo {
  progress: DocumenterProgress;
  startFromWorkUnitIndex: number;
}

/**
 * Check if we should resume from checkpoint and get resume information
 * 
 * @param plan Current documentation plan
 * @returns ResumeInfo if should resume, null if should start fresh
 */
export async function shouldResumeFromCheckpoint(
  plan: DocumentationPlan
): Promise<ResumeInfo | null> {
  const existingProgress = await loadDocumenterProgress();
  
  // No existing progress - start fresh
  if (!existingProgress) {
    logger.info('No existing progress found, starting fresh');
    return null;
  }

  // Check status
  if (existingProgress.status === 'completed') {
    logger.info('Previous run completed, starting fresh');
    return null;
  }

  if (existingProgress.status === 'failed') {
    logger.info('Previous run failed, starting fresh');
    return null;
  }

  // Only resume if status is 'running'
  if (existingProgress.status !== 'running') {
    logger.info(`Previous run has status '${existingProgress.status}', starting fresh`);
    return null;
  }

  // Validate plan hash matches current plan
  const currentPlanHash = computePlanHash(plan);
  if (existingProgress.plan_hash !== currentPlanHash) {
    // In test environments, allow plan hash mismatch and start fresh
    if (process.env.TEST_PROGRESS_DIR || process.env.NODE_ENV === 'test') {
      logger.info('Plan hash mismatch in test environment, starting fresh');
      return null;
    }
    throw new Error(
      `Plan hash mismatch: cannot resume. Previous plan hash: ${existingProgress.plan_hash}, ` +
      `current plan hash: ${currentPlanHash}. Plan may have changed.`
    );
  }

  // Find last completed work unit
  const startIndex = getResumeStartIndex(existingProgress, plan);

  logger.info('Resuming from checkpoint', {
    startFromWorkUnitIndex: startIndex,
    completedWorkUnits: Object.values(existingProgress.work_units)
      .filter(wu => wu.status === 'completed').length,
    partialWorkUnits: Object.values(existingProgress.work_units)
      .filter(wu => wu.status === 'partial').length,
    failedWorkUnits: Object.values(existingProgress.work_units)
      .filter(wu => wu.status === 'failed').length,
  });

  // Log info about partial/failed work units (not auto-retried)
  const partialWorkUnits = Object.values(existingProgress.work_units)
    .filter(wu => wu.status === 'partial' || wu.status === 'failed');
  
  if (partialWorkUnits.length > 0) {
    logger.info('Work units with partial/failed status will not be auto-retried', {
      workUnits: partialWorkUnits.map(wu => ({
        id: wu.work_unit_id,
        status: wu.status,
      })),
    });
  }

  return {
    progress: existingProgress,
    startFromWorkUnitIndex: startIndex,
  };
}

/**
 * Get the index of the work unit to start from when resuming
 * 
 * @param progress Existing progress
 * @param plan Current plan
 * @returns Index of work unit to start from (0-based)
 */
function getResumeStartIndex(
  progress: DocumenterProgress,
  plan: DocumentationPlan
): number {
  // Sort work units by priority_order to match processing order
  const sortedWorkUnits = [...plan.work_units].sort(
    (a, b) => a.priority_order - b.priority_order
  );

  // Find the last completed work unit
  let lastCompletedIndex = -1;
  
  for (let i = 0; i < sortedWorkUnits.length; i++) {
    const workUnit = sortedWorkUnits[i];
    const workUnitProgress = progress.work_units[workUnit.id];
    
    if (workUnitProgress && workUnitProgress.status === 'completed') {
      lastCompletedIndex = i;
    }
  }

  // Start from the next work unit after the last completed one
  return lastCompletedIndex + 1;
}

/**
 * Compute SHA-256 hash of plan for change detection
 * 
 * @param plan Documentation plan
 * @returns SHA-256 hash string
 */
export function computePlanHash(plan: DocumentationPlan): string {
  // Create a stable representation of the plan
  // Sort work units by id for consistent hashing
  const stablePlan = {
    schema_version: plan.schema_version,
    generated_at: plan.generated_at,
    config_hash: plan.config_hash,
    work_units: plan.work_units
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(wu => ({
        id: wu.id,
        database: wu.database,
        domain: wu.domain,
        tables_count: wu.tables.length,
        content_hash: wu.content_hash,
      })),
  };

  const planString = JSON.stringify(stablePlan);
  const hash = crypto.createHash('sha256');
  hash.update(planString);
  return hash.digest('hex');
}
