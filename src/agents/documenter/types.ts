/**
 * Type definitions for Documenter Agent
 * 
 * These types match the contract interfaces defined in:
 * planning/agent-contracts-interfaces.md
 */

// =============================================================================
// COMMON TYPES - Shared across all agents
// =============================================================================

/** ISO 8601 timestamp string */
export type ISOTimestamp = string;

/** SHA-256 hash string (64 hex characters) */
export type ContentHash = string;

/** Agent execution status */
export type AgentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'partial';

/** Database type identifier */
export type DatabaseType = 'postgres' | 'snowflake';

/** Table priority for documentation order (1=core, 2=standard, 3=system) */
export type TablePriority = 1 | 2 | 3;

/** Fully qualified table name: database.schema.table */
export type FullyQualifiedTableName = string;

/** Domain name (lowercase, no spaces) */
export type DomainName = string;

/** Error severity level */
export type ErrorSeverity = 'warning' | 'error' | 'fatal';

/**
 * Base error structure used throughout the system.
 * All agents use this format for consistent error handling.
 */
export interface AgentError {
  /** Machine-readable error code (e.g., "DOC_PLAN_NOT_FOUND") */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Severity level */
  severity: ErrorSeverity;
  /** When the error occurred */
  timestamp: ISOTimestamp;
  /** Additional context for debugging */
  context?: Record<string, unknown>;
  /** Whether the operation can be retried */
  recoverable: boolean;
}

// =============================================================================
// PLANNER OUTPUT INTERFACES
// =============================================================================

/**
 * Root structure of the documentation plan.
 * File: progress/documentation-plan.json
 * Producer: Planner
 * Consumer: Documenter
 */
export interface DocumentationPlan {
  /** Schema version for forward compatibility */
  schema_version: '1.0';
  
  /** When this plan was generated */
  generated_at: ISOTimestamp;
  
  /** Hash of databases.yaml used (for staleness detection) */
  config_hash: ContentHash;
  
  /** Overall complexity assessment */
  complexity: 'simple' | 'moderate' | 'complex';
  
  /** Per-database analysis results */
  databases: DatabaseAnalysis[];
  
  /** Discrete work units for parallel processing */
  work_units: WorkUnit[];
  
  /** Aggregate summary statistics */
  summary: PlanSummary;
  
  /** Any errors encountered during planning */
  errors: AgentError[];
}

/**
 * Analysis results for a single database.
 */
export interface DatabaseAnalysis {
  /** Database identifier from config */
  name: string;
  
  /** Database platform */
  type: DatabaseType;
  
  /** Connection status during analysis */
  status: 'reachable' | 'unreachable';
  
  /** Error details if unreachable */
  connection_error?: AgentError;
  
  /** Total tables discovered */
  table_count: number;
  
  /** Number of schemas */
  schema_count: number;
  
  /** Estimated documentation time in minutes */
  estimated_time_minutes: number;
  
  /** Discovered business domains mapped to their tables */
  domains: Record<DomainName, string[]>;
  
  /** Hash of the database schema for change detection */
  schema_hash: ContentHash;
}

/**
 * A discrete, self-contained unit of work for the Documenter.
 * Each work unit can be processed independently and in parallel.
 */
export interface WorkUnit {
  /** Unique identifier: "{database}_{domain}" */
  id: string;
  
  /** Source database */
  database: string;
  
  /** Business domain this work unit covers */
  domain: DomainName;
  
  /** Tables to document in this work unit */
  tables: TableSpec[];
  
  /** Estimated processing time in minutes */
  estimated_time_minutes: number;
  
  /** Output directory (relative to /docs) */
  output_directory: string;
  
  /** Priority order for processing (lower = higher priority) */
  priority_order: number;
  
  /** Dependencies on other work units (usually empty) */
  depends_on: string[];
  
  /** Hash of this work unit's content for change detection */
  content_hash: ContentHash;
}

/**
 * Specification for a single table to be documented.
 */
export interface TableSpec {
  /** Fully qualified name: database.schema.table */
  fully_qualified_name: FullyQualifiedTableName;
  
  /** Schema name */
  schema_name: string;
  
  /** Table name */
  table_name: string;
  
  /** Assigned business domain */
  domain: DomainName;
  
  /** Documentation priority */
  priority: TablePriority;
  
  /** Number of columns */
  column_count: number;
  
  /** Approximate row count */
  row_count_approx: number;
  
  /** Tables that reference this via FK */
  incoming_fk_count: number;
  
  /** Tables this references via FK */
  outgoing_fk_count: number;
  
  /** Hash of table metadata for change detection */
  metadata_hash: ContentHash;
  
  /** Existing database comment (if any) */
  existing_comment?: string;
}

/**
 * Summary statistics for the entire plan.
 */
export interface PlanSummary {
  total_databases: number;
  reachable_databases: number;
  total_tables: number;
  total_work_units: number;
  domain_count: number;
  total_estimated_minutes: number;
  /** Recommended number of parallel workers */
  recommended_parallelism: number;
}

// =============================================================================
// DOCUMENTER INTERFACES
// =============================================================================

/**
 * Progress tracking for overall documentation process.
 * File: progress/documenter-progress.json
 * Producer: Documenter
 * Consumer: Orchestrator, CLI
 */
export interface DocumenterProgress {
  schema_version: '1.0';
  started_at: ISOTimestamp;
  completed_at: ISOTimestamp | null;
  status: AgentStatus;
  
  /** Path to the plan being executed */
  plan_file: string;
  
  /** Hash of the plan (detect if changed mid-run) */
  plan_hash: ContentHash;
  
  /** Progress for each work unit */
  work_units: Record<string, WorkUnitProgress>;
  
  /** Aggregated statistics */
  stats: DocumenterStats;
  
  /** Last checkpoint timestamp */
  last_checkpoint: ISOTimestamp;
  
  /** Top-level errors */
  errors: AgentError[];
}

/**
 * Progress tracking for a single work unit.
 * File: progress/work_units/{id}/progress.json
 */
export interface WorkUnitProgress {
  work_unit_id: string;
  status: AgentStatus;
  started_at?: ISOTimestamp;
  completed_at?: ISOTimestamp;
  
  /** PID of processing sub-agent (for parallel execution) */
  processor_pid?: number;
  
  tables_total: number;
  tables_completed: number;
  tables_failed: number;
  tables_skipped: number;
  
  /** Currently processing table */
  current_table?: FullyQualifiedTableName;
  
  /** Errors in this work unit */
  errors: AgentError[];
  
  /** Output files generated */
  output_files: string[];
}

/**
 * Aggregated statistics for documenter progress.
 */
export interface DocumenterStats {
  total_tables: number;
  completed_tables: number;
  failed_tables: number;
  skipped_tables: number;
  llm_tokens_used: number;
  llm_time_ms: number;
  db_query_time_ms: number;
}

// =============================================================================
// HELPER TYPES FOR INTERNAL USE
// =============================================================================

/**
 * Result of processing a single table.
 */
export interface TableResult {
  table: FullyQualifiedTableName;
  succeeded: boolean;
  error?: AgentError;
}

// =============================================================================
// DOCUMENTATION MANIFEST INTERFACES (Handoff to Indexer)
// =============================================================================

/**
 * Manifest of completed documentation.
 * File: docs/documentation-manifest.json
 * Producer: Documenter (on completion)
 * Consumer: Indexer
 * 
 * THIS IS THE PRIMARY HANDOFF CONTRACT FROM DOCUMENTER TO INDEXER.
 */
export interface DocumentationManifest {
  schema_version: '1.0';
  completed_at: ISOTimestamp;
  plan_hash: ContentHash;
  
  /** Must be 'complete' or 'partial' for Indexer to proceed */
  status: 'complete' | 'partial';
  
  /** All databases documented */
  databases: DatabaseManifest[];
  
  /** Per-work-unit completion status */
  work_units: WorkUnitManifest[];
  
  /** Total files generated */
  total_files: number;
  
  /** Files that the indexer should process */
  indexable_files: IndexableFile[];
}

export interface DatabaseManifest {
  name: string;
  type: DatabaseType;
  docs_directory: string;
  tables_documented: number;
  tables_failed: number;
  domains: string[];
}

export interface WorkUnitManifest {
  id: string;
  status: 'completed' | 'failed' | 'partial';
  output_directory: string;
  files_generated: number;
  output_hash: ContentHash;
  /** Can this work unit be re-processed independently? */
  reprocessable: boolean;
  errors?: AgentError[];
}

export interface IndexableFile {
  /** Relative path from /docs */
  path: string;
  type: 'table' | 'domain' | 'overview' | 'relationship';
  database: string;
  schema?: string;
  table?: string;
  domain?: DomainName;
  content_hash: ContentHash;
  size_bytes: number;
  modified_at: ISOTimestamp;
}
