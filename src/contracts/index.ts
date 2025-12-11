/**
 * Contracts Module
 *
 * Central export point for all contract types, errors, and validators.
 *
 * @module contracts
 */

// Types
export * from './types.js';

// Errors
export {
  ERROR_CODES,
  PLANNER_ERROR_MAP,
  createPlannerError,
  createAgentError,
  isAgentError,
  toAgentError,
} from './errors.js';
export type { ErrorCode } from './errors.js';

// Validators
export {
  validatePlan,
  validateWorkUnit,
  validateNoCycles,
  validateTableSpec,
  assertTableSpecComplete,
  DocumentationPlanSchema,
  WorkUnitSchema,
  TableSpecSchema,
  DatabaseAnalysisSchema,
  PlanSummarySchema,
  AgentErrorSchema,
} from './validators.js';
