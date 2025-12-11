/**
 * Error Handling Utilities
 * 
 * Provides structured error creation for consistent error handling
 * throughout the documenter.
 */

import type {
  AgentError,
  ErrorSeverity,
} from './types.js';

/**
 * Create an AgentError object with proper structure
 * 
 * @param code Machine-readable error code (e.g., "DOC_PLAN_NOT_FOUND")
 * @param message Human-readable error message
 * @param severity Error severity level
 * @param recoverable Whether the operation can be retried
 * @param context Additional context for debugging
 * @returns AgentError object
 */
export function createAgentError(
  code: string,
  message: string,
  severity: ErrorSeverity,
  recoverable: boolean,
  context?: Record<string, unknown>
): AgentError {
  return {
    code,
    message,
    severity,
    timestamp: new Date().toISOString(),
    context,
    recoverable,
  };
}

/**
 * Error codes used by the Documenter
 */
export const ErrorCodes = {
  DOC_PLAN_NOT_FOUND: 'DOC_PLAN_NOT_FOUND',
  DOC_PLAN_INVALID: 'DOC_PLAN_INVALID',
  DOC_PLAN_STALE: 'DOC_PLAN_STALE',
  DOC_DB_CONNECTION_LOST: 'DOC_DB_CONNECTION_LOST',
  DOC_WORK_UNIT_FAILED: 'DOC_WORK_UNIT_FAILED',
  DOC_LLM_TIMEOUT: 'DOC_LLM_TIMEOUT',
  DOC_LLM_FAILED: 'DOC_LLM_FAILED',
  DOC_LLM_PARSE_FAILED: 'DOC_LLM_PARSE_FAILED',
  DOC_TEMPLATE_NOT_FOUND: 'DOC_TEMPLATE_NOT_FOUND',
  DOC_TABLE_EXTRACTION_FAILED: 'DOC_TABLE_EXTRACTION_FAILED',
  DOC_COLUMN_EXTRACTION_FAILED: 'DOC_COLUMN_EXTRACTION_FAILED',
  DOC_SAMPLING_TIMEOUT: 'DOC_SAMPLING_TIMEOUT',
  DOC_SAMPLING_FAILED: 'DOC_SAMPLING_FAILED',
  DOC_FILE_WRITE_FAILED: 'DOC_FILE_WRITE_FAILED',
  DOC_MANIFEST_WRITE_FAILED: 'DOC_MANIFEST_WRITE_FAILED',
} as const;
