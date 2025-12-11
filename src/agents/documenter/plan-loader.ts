/**
 * Plan Loading and Validation
 * 
 * Handles loading and validating documentation plans with schema version checking
 * and staleness detection.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { logger } from '../../utils/logger.js';
import type {
  DocumentationPlan,
} from './types.js';
import { createAgentError } from './errors.js';

/**
 * Load and validate documentation plan
 * 
 * @returns Validated DocumentationPlan
 * @throws Error with DOC_PLAN_NOT_FOUND or DOC_PLAN_INVALID code
 */
export async function loadAndValidatePlan(): Promise<DocumentationPlan> {
  // Support test environment override
  const baseDir = process.env.TEST_PROGRESS_DIR || process.cwd();
  const planPath = path.join(baseDir, 'progress', 'documentation-plan.json');

  // Check if plan file exists
  try {
    await fs.access(planPath);
  } catch (error) {
    throw createAgentError(
      'DOC_PLAN_NOT_FOUND',
      `Documentation plan not found at ${planPath}. Run planner first.`,
      'fatal',
      false,
      { path: planPath }
    );
  }

  // Read and parse plan file
  let planContent: string;
  let plan: any;
  
  try {
    planContent = await fs.readFile(planPath, 'utf-8');
  } catch (error) {
    throw createAgentError(
      'DOC_PLAN_NOT_FOUND',
      `Failed to read documentation plan file: ${error instanceof Error ? error.message : String(error)}`,
      'fatal',
      false,
      { path: planPath, error: String(error) }
    );
  }

  try {
    plan = JSON.parse(planContent);
  } catch (error) {
    throw createAgentError(
      'DOC_PLAN_INVALID',
      `Invalid JSON in documentation plan: ${error instanceof Error ? error.message : String(error)}`,
      'fatal',
      false,
      { path: planPath, error: String(error) }
    );
  }

  // Validate schema version
  if (plan.schema_version !== '1.0') {
    throw createAgentError(
      'DOC_PLAN_INVALID',
      `Invalid schema version: expected '1.0', got '${plan.schema_version}'. Plan must be regenerated.`,
      'fatal',
      false,
      { expected: '1.0', actual: plan.schema_version }
    );
  }

  // Validate basic structure (check required fields)
  if (!plan.generated_at || !plan.work_units || !Array.isArray(plan.work_units)) {
    throw createAgentError(
      'DOC_PLAN_INVALID',
      'Documentation plan missing required fields: generated_at, work_units',
      'fatal',
      false,
      { plan: Object.keys(plan) }
    );
  }

  // Check for config_hash staleness
  if (plan.config_hash) {
    const currentConfigHash = await computeConfigHash();
    
    if (currentConfigHash !== plan.config_hash) {
      const staleError = createAgentError(
        'DOC_PLAN_STALE',
        `Documentation plan config_hash does not match current databases.yaml. Plan may be stale.`,
        'warning',
        true,
        { 
          plan_hash: plan.config_hash,
          current_hash: currentConfigHash 
        }
      );
      
      logger.warn('Stale plan detected', {
        code: staleError.code,
        message: staleError.message,
        context: staleError.context,
      });
      
      // Continue processing despite staleness (per PRD)
    }
  }

  // Return validated plan (cast to DocumentationPlan - full validation would require zod schema)
  return plan as DocumentationPlan;
}

/**
 * Compute SHA-256 hash of databases.yaml file
 * 
 * This matches the hash computation used by the planner to detect
 * if the configuration has changed since the plan was generated.
 */
async function computeConfigHash(): Promise<string> {
  try {
    const configPath = path.join(process.cwd(), 'config', 'databases.yaml');
    const configContent = await fs.readFile(configPath, 'utf-8');
    
    // Compute SHA-256 hash
    const hash = crypto.createHash('sha256');
    hash.update(configContent);
    return hash.digest('hex');
  } catch (error) {
    logger.warn('Failed to compute config hash', error);
    // Return empty hash if config file not found (shouldn't happen in normal operation)
    return '';
  }
}
