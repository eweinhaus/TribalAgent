/**
 * Plan I/O Utilities
 *
 * Utilities for loading and saving documentation plans.
 *
 * @module utils/plan-io
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { validatePlan } from '../contracts/validators.js';
import { createPlannerError } from '../contracts/errors.js';
import type { DocumentationPlan, ValidationResult } from '../contracts/types.js';

/** Default plan file path */
const DEFAULT_PLAN_PATH = 'progress/documentation-plan.json';

/**
 * Load and validate a documentation plan from disk.
 * Throws if file doesn't exist or validation fails.
 */
export async function loadPlan(planPath?: string): Promise<DocumentationPlan> {
  const fullPath = path.join(process.cwd(), planPath || DEFAULT_PLAN_PATH);

  try {
    await fs.access(fullPath);
  } catch {
    throw createPlannerError('configNotFound', `Plan file not found: ${fullPath}`, {
      path: fullPath,
    });
  }

  try {
    const content = await fs.readFile(fullPath, 'utf-8');
    const parsed = JSON.parse(content);

    const result = validatePlan(parsed);
    if (!result.success) {
      throw createPlannerError(
        'configInvalid',
        `Plan validation failed: ${result.errors?.map((e) => e.message).join(', ')}`,
        { errors: result.errors }
      );
    }

    return result.data!;
  } catch (error) {
    if ((error as { code?: string }).code?.startsWith('PLAN_')) {
      throw error;
    }
    throw createPlannerError(
      'configInvalid',
      `Failed to load plan: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Load a plan without validation (for inspection/debugging).
 */
export async function loadPlanRaw(planPath?: string): Promise<unknown> {
  const fullPath = path.join(process.cwd(), planPath || DEFAULT_PLAN_PATH);

  try {
    const content = await fs.readFile(fullPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    throw createPlannerError(
      'configNotFound',
      `Failed to load plan: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Check if a plan file exists.
 */
export async function planExists(planPath?: string): Promise<boolean> {
  const fullPath = path.join(process.cwd(), planPath || DEFAULT_PLAN_PATH);
  try {
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Save a documentation plan to disk.
 * Creates the progress directory if it doesn't exist.
 */
export async function savePlan(plan: DocumentationPlan, planPath?: string): Promise<void> {
  const fullPath = path.join(process.cwd(), planPath || DEFAULT_PLAN_PATH);

  try {
    // Ensure directory exists
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    // Write plan
    await fs.writeFile(fullPath, JSON.stringify(plan, null, 2), 'utf-8');
  } catch (error) {
    throw createPlannerError(
      'writeFailed',
      `Failed to write plan: ${error instanceof Error ? error.message : String(error)}`,
      { path: fullPath }
    );
  }
}

/**
 * Try to load an existing plan, returning null if not found.
 * Does not throw on missing file.
 */
export async function tryLoadPlan(planPath?: string): Promise<DocumentationPlan | null> {
  const exists = await planExists(planPath);
  if (!exists) {
    return null;
  }

  try {
    return await loadPlan(planPath);
  } catch {
    // Plan exists but is invalid - return null and let caller decide
    return null;
  }
}

/**
 * Validate a plan file and return the result.
 * Does not throw on validation failure.
 */
export async function validatePlanFile(
  planPath?: string
): Promise<ValidationResult<DocumentationPlan>> {
  const fullPath = path.join(process.cwd(), planPath || DEFAULT_PLAN_PATH);

  try {
    await fs.access(fullPath);
  } catch {
    return {
      success: false,
      errors: [{ path: 'file', message: `Plan file not found: ${fullPath}` }],
    };
  }

  try {
    const content = await fs.readFile(fullPath, 'utf-8');
    const parsed = JSON.parse(content);
    return validatePlan(parsed);
  } catch (error) {
    return {
      success: false,
      errors: [
        {
          path: 'parse',
          message: `Failed to parse plan: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}

/**
 * Get the default plan path.
 */
export function getDefaultPlanPath(): string {
  return path.join(process.cwd(), DEFAULT_PLAN_PATH);
}
