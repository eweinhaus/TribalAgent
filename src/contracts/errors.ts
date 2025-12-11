/**
 * Error Code Registry
 *
 * All agents must use these canonical error codes. Do not invent new codes
 * without adding them here first.
 *
 * @module contracts/errors
 */

import type { AgentError, ErrorSeverity, ISOTimestamp } from './types.js';

// =============================================================================
// ERROR CODE CONSTANTS
// =============================================================================

export const ERROR_CODES = {
  // =========================================================================
  // PLANNER ERRORS (PLAN_*)
  // =========================================================================

  /** databases.yaml not found */
  PLAN_CONFIG_NOT_FOUND: 'PLAN_CONFIG_NOT_FOUND',
  /** databases.yaml has invalid YAML syntax */
  PLAN_CONFIG_INVALID: 'PLAN_CONFIG_INVALID',
  /** Database connection failed during analysis */
  PLAN_DB_UNREACHABLE: 'PLAN_DB_UNREACHABLE',
  /** LLM call for domain inference failed */
  PLAN_DOMAIN_INFERENCE_FAILED: 'PLAN_DOMAIN_INFERENCE_FAILED',
  /** Failed to write documentation-plan.json */
  PLAN_WRITE_FAILED: 'PLAN_WRITE_FAILED',
  /** Query to get table list failed */
  PLAN_SCHEMA_QUERY_FAILED: 'PLAN_SCHEMA_QUERY_FAILED',
  /** Query to get foreign keys failed */
  PLAN_FK_QUERY_FAILED: 'PLAN_FK_QUERY_FAILED',

  // =========================================================================
  // DOCUMENTER ERRORS (DOC_*)
  // =========================================================================

  /** documentation-plan.json not found */
  DOC_PLAN_NOT_FOUND: 'DOC_PLAN_NOT_FOUND',
  /** Plan file has invalid format */
  DOC_PLAN_INVALID: 'DOC_PLAN_INVALID',
  /** Plan config_hash doesn't match current databases.yaml */
  DOC_PLAN_STALE: 'DOC_PLAN_STALE',
  /** Lost connection to database during documentation */
  DOC_DB_CONNECTION_LOST: 'DOC_DB_CONNECTION_LOST',
  /** Failed to extract table metadata */
  DOC_TABLE_EXTRACTION_FAILED: 'DOC_TABLE_EXTRACTION_FAILED',
  /** Failed to extract column metadata */
  DOC_COLUMN_EXTRACTION_FAILED: 'DOC_COLUMN_EXTRACTION_FAILED',
  /** Sampling query timed out */
  DOC_SAMPLING_TIMEOUT: 'DOC_SAMPLING_TIMEOUT',
  /** Sampling query failed */
  DOC_SAMPLING_FAILED: 'DOC_SAMPLING_FAILED',
  /** LLM call for column description timed out */
  DOC_LLM_TIMEOUT: 'DOC_LLM_TIMEOUT',
  /** LLM call for column/table description failed */
  DOC_LLM_FAILED: 'DOC_LLM_FAILED',
  /** LLM returned unparseable response */
  DOC_LLM_PARSE_FAILED: 'DOC_LLM_PARSE_FAILED',
  /** Failed to write output file */
  DOC_FILE_WRITE_FAILED: 'DOC_FILE_WRITE_FAILED',
  /** Prompt template not found */
  DOC_TEMPLATE_NOT_FOUND: 'DOC_TEMPLATE_NOT_FOUND',
  /** Work unit failed completely */
  DOC_WORK_UNIT_FAILED: 'DOC_WORK_UNIT_FAILED',
  /** Failed to write manifest */
  DOC_MANIFEST_WRITE_FAILED: 'DOC_MANIFEST_WRITE_FAILED',

  // =========================================================================
  // INDEXER ERRORS (IDX_*)
  // =========================================================================

  /** documentation-manifest.json not found */
  IDX_MANIFEST_NOT_FOUND: 'IDX_MANIFEST_NOT_FOUND',
  /** Manifest file has invalid format */
  IDX_MANIFEST_INVALID: 'IDX_MANIFEST_INVALID',
  /** File listed in manifest doesn't exist on disk */
  IDX_FILE_NOT_FOUND: 'IDX_FILE_NOT_FOUND',
  /** File content hash doesn't match manifest */
  IDX_FILE_HASH_MISMATCH: 'IDX_FILE_HASH_MISMATCH',
  /** Failed to parse markdown file */
  IDX_PARSE_FAILED: 'IDX_PARSE_FAILED',
  /** OpenAI embedding API call failed */
  IDX_EMBEDDING_FAILED: 'IDX_EMBEDDING_FAILED',
  /** OpenAI API rate limited */
  IDX_EMBEDDING_RATE_LIMITED: 'IDX_EMBEDDING_RATE_LIMITED',
  /** Failed to write to SQLite */
  IDX_DB_WRITE_FAILED: 'IDX_DB_WRITE_FAILED',
  /** Failed to create FTS5 index */
  IDX_FTS_FAILED: 'IDX_FTS_FAILED',
  /** Failed to create vector index */
  IDX_VECTOR_FAILED: 'IDX_VECTOR_FAILED',

  // =========================================================================
  // RETRIEVER ERRORS (RET_*)
  // =========================================================================

  /** SQLite database not found or not initialized */
  RET_INDEX_NOT_READY: 'RET_INDEX_NOT_READY',
  /** Index is stale (older than threshold) */
  RET_INDEX_STALE: 'RET_INDEX_STALE',
  /** Query parameter validation failed */
  RET_QUERY_INVALID: 'RET_QUERY_INVALID',
  /** FTS5 search query failed */
  RET_FTS_SEARCH_FAILED: 'RET_FTS_SEARCH_FAILED',
  /** Vector search failed */
  RET_VECTOR_SEARCH_FAILED: 'RET_VECTOR_SEARCH_FAILED',
  /** Requested table not found in index */
  RET_TABLE_NOT_FOUND: 'RET_TABLE_NOT_FOUND',
  /** No join path exists between tables */
  RET_NO_JOIN_PATH: 'RET_NO_JOIN_PATH',
  /** Response exceeds context budget, truncated */
  RET_BUDGET_EXCEEDED: 'RET_BUDGET_EXCEEDED',
  /** LLM query understanding failed */
  RET_QUERY_UNDERSTANDING_FAILED: 'RET_QUERY_UNDERSTANDING_FAILED',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// =============================================================================
// PLANNER ERROR TAXONOMY
// =============================================================================

interface ErrorMapping {
  code: ErrorCode;
  severity: ErrorSeverity;
  recoverable: boolean;
  trigger: string;
}

/**
 * Error taxonomy mapping for Planner failures.
 * Each mapping defines: code, severity, recoverable, and when to use.
 */
export const PLANNER_ERROR_MAP: Record<string, ErrorMapping> = {
  // Configuration errors (fatal - cannot proceed)
  configNotFound: {
    code: ERROR_CODES.PLAN_CONFIG_NOT_FOUND,
    severity: 'fatal',
    recoverable: false,
    trigger: 'databases.yaml or agent-config.yaml missing',
  },
  configInvalid: {
    code: ERROR_CODES.PLAN_CONFIG_INVALID,
    severity: 'fatal',
    recoverable: false,
    trigger: 'YAML parse error or Zod validation failure',
  },

  // Database connection errors (warning - skip and continue)
  dbUnreachable: {
    code: ERROR_CODES.PLAN_DB_UNREACHABLE,
    severity: 'warning',
    recoverable: true,
    trigger: 'Connection timeout, auth failure, network error',
  },

  // Schema query errors (error - log and continue with partial data)
  schemaQueryFailed: {
    code: ERROR_CODES.PLAN_SCHEMA_QUERY_FAILED,
    severity: 'error',
    recoverable: true,
    trigger: 'information_schema query fails (permissions, timeout)',
  },
  fkQueryFailed: {
    code: ERROR_CODES.PLAN_FK_QUERY_FAILED,
    severity: 'warning',
    recoverable: true,
    trigger: 'FK query fails - continue without relationships',
  },

  // LLM errors (warning - fall back to prefix-based)
  domainInferenceFailed: {
    code: ERROR_CODES.PLAN_DOMAIN_INFERENCE_FAILED,
    severity: 'warning',
    recoverable: true,
    trigger: 'LLM API error, timeout, or unparseable response',
  },

  // Write errors (error - may need retry)
  writeFailed: {
    code: ERROR_CODES.PLAN_WRITE_FAILED,
    severity: 'error',
    recoverable: false,
    trigger: 'Cannot write documentation-plan.json (permissions, disk)',
  },
};

// =============================================================================
// ERROR CREATION HELPERS
// =============================================================================

/**
 * Create an AgentError from the Planner error taxonomy.
 */
export function createPlannerError(
  type: keyof typeof PLANNER_ERROR_MAP,
  message: string,
  context?: Record<string, unknown>
): AgentError {
  const mapping = PLANNER_ERROR_MAP[type];
  return {
    code: mapping.code,
    message,
    severity: mapping.severity,
    timestamp: new Date().toISOString() as ISOTimestamp,
    context,
    recoverable: mapping.recoverable,
  };
}

/**
 * Create a generic AgentError with explicit parameters.
 */
export function createAgentError(
  code: ErrorCode,
  message: string,
  severity: ErrorSeverity,
  recoverable: boolean,
  context?: Record<string, unknown>
): AgentError {
  return {
    code,
    message,
    severity,
    timestamp: new Date().toISOString() as ISOTimestamp,
    context,
    recoverable,
  };
}

/**
 * Type guard to check if an error is an AgentError
 */
export function isAgentError(error: unknown): error is AgentError {
  if (!error || typeof error !== 'object') return false;
  const err = error as Record<string, unknown>;
  return (
    typeof err.code === 'string' &&
    typeof err.message === 'string' &&
    typeof err.severity === 'string' &&
    typeof err.timestamp === 'string' &&
    typeof err.recoverable === 'boolean'
  );
}

/**
 * Convert an unknown error to an AgentError
 */
export function toAgentError(
  error: unknown,
  defaultCode: ErrorCode,
  defaultSeverity: ErrorSeverity = 'error'
): AgentError {
  if (isAgentError(error)) {
    return error;
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown error';

  return createAgentError(defaultCode, message, defaultSeverity, true, {
    originalError: error instanceof Error ? error.stack : String(error),
  });
}
