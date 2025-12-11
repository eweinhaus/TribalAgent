/**
 * Contract Types - Interface Definitions
 *
 * All TypeScript interfaces for inter-agent communication as specified in
 * agent-contracts-interfaces.md. This is the type-level contract between agents.
 *
 * @module contracts/types
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

/** Agent name for logging */
export type AgentName = 'planner' | 'documenter' | 'indexer' | 'retriever' | 'orchestrator';

/** Log level */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Base error structure used throughout the system.
 * All agents use this format for consistent error handling.
 */
export interface AgentError {
  /** Machine-readable error code (e.g., "PLAN_DB_UNREACHABLE") */
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
 * This is the KEY ENABLER for parallel domain processing.
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
 * ALL fields are REQUIRED per agent-contracts-interfaces.md §3.4
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

  /** Approximate row count (from pg_class.reltuples, never COUNT(*)) */
  row_count_approx: number;

  /** Tables that reference this via FK (incoming_fk_count) */
  incoming_fk_count: number;

  /** Tables this references via FK (outgoing_fk_count) */
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
  /** Recommended number of parallel workers: min(work_unit_count, 4) */
  recommended_parallelism: number;
}

// =============================================================================
// DOCUMENTER INTERFACES
// =============================================================================

/**
 * Progress tracking for overall documentation process.
 * File: progress/documenter-progress.json
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
 * Documenter statistics
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

/**
 * Manifest of completed documentation.
 * File: docs/documentation-manifest.json
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

// =============================================================================
// INDEXER INTERFACES
// =============================================================================

/**
 * Progress tracking for indexing process.
 * File: progress/indexer-progress.json
 */
export interface IndexerProgress {
  schema_version: '1.0';
  started_at: ISOTimestamp;
  completed_at: ISOTimestamp | null;
  status: AgentStatus;

  manifest_file: string;
  manifest_hash: ContentHash;

  files_total: number;
  files_indexed: number;
  files_failed: number;
  files_skipped: number;

  current_file?: string;
  embeddings_generated: number;
  last_checkpoint: ISOTimestamp;
  errors: AgentError[];
}

/**
 * Index metadata stored in SQLite.
 * Table: index_metadata
 */
export interface IndexMetadata {
  last_full_index: ISOTimestamp;
  manifest_hash: ContentHash;
  document_count: number;
  embedding_count: number;
  index_version: string;
  embedding_model: string;
  embedding_dimensions: number;
}

/**
 * Document record stored in SQLite.
 * Table: documents
 */
export interface DocumentRecord {
  id: number;
  doc_type: 'table' | 'column' | 'domain' | 'relationship';
  database_name: string;
  schema_name: string | null;
  table_name: string | null;
  column_name: string | null;
  domain: DomainName | null;
  content: string;
  summary: string;
  keywords: string; // JSON array
  file_path: string;
  content_hash: ContentHash;
  indexed_at: ISOTimestamp;
  source_modified_at: ISOTimestamp;
}

// =============================================================================
// LLM WRAPPER INTERFACES
// =============================================================================

/**
 * Request to the LLM wrapper.
 */
export interface LLMRequest {
  /** Path to prompt template (relative to /prompts) */
  template: string;

  /** Variables to substitute in template */
  variables: Record<string, string>;

  /** Maximum tokens in response */
  max_tokens?: number;

  /** Expected response format */
  response_format: 'text' | 'json';

  /** For logging/tracing */
  purpose: string;

  /** Optional: override model from config */
  model?: string;
}

/**
 * Response from the LLM wrapper.
 */
export interface LLMResponse {
  /** Whether the call succeeded */
  success: boolean;

  /** Response content (string or parsed JSON) */
  content: string | Record<string, unknown>;

  /** Token usage for cost tracking */
  tokens: {
    input: number;
    output: number;
    total: number;
  };

  /** Time taken in ms */
  duration_ms: number;

  /** Error if failed */
  error?: AgentError;
}

// =============================================================================
// LOGGING INTERFACES
// =============================================================================

/**
 * Structured log entry format.
 * All log output must conform to this structure.
 */
export interface LogEntry {
  /** ISO 8601 timestamp */
  timestamp: ISOTimestamp;

  /** Log level */
  level: LogLevel;

  /** Which agent produced this log */
  agent: AgentName;

  /** Work unit ID (for parallel correlation within documenter) */
  work_unit_id?: string;

  /** Correlation ID (traces a request across all agents) */
  correlation_id: string;

  /** Human-readable message */
  message: string;

  /** Structured context data */
  context?: {
    /** Current operation */
    operation?: string;
    /** Database being processed */
    database?: string;
    /** Table being processed */
    table?: string;
    /** Error code if this is an error log */
    error_code?: string;
    /** Duration of operation in ms */
    duration_ms?: number;
    /** Token counts for LLM operations */
    tokens?: { input: number; output: number };
    /** Any additional context */
    [key: string]: unknown;
  };
}

// =============================================================================
// CONFIGURATION INTERFACES
// =============================================================================

/**
 * Root configuration for database connections.
 * File: config/databases.yaml
 */
export interface DatabaseCatalog {
  /** Schema version for config format */
  version?: '1.0';

  /** Global defaults applied to all databases */
  defaults?: {
    /** Default timeout for queries in ms */
    query_timeout_ms?: number;
    /** Default sample size for data sampling */
    sample_size?: number;
  };

  /** List of databases to document */
  databases: DatabaseConfig[];
}

/**
 * Configuration for a single database connection.
 */
export interface DatabaseConfig {
  /** Unique identifier for this database (used in output paths) */
  name: string;

  /** Database platform */
  type: DatabaseType;

  /** Environment variable containing connection string (Postgres) */
  connection_string_env?: string;

  /** Direct connection string */
  connection_string?: string;

  /** Connection config (legacy) */
  connection_config?: string;

  /** Environment variable (legacy, maps to connection_string_env) */
  connection_env?: string;

  /** Snowflake-specific connection parameters */
  snowflake?: {
    account_env: string;
    username_env: string;
    password_env: string;
    warehouse: string;
    database: string;
    role?: string;
  };

  /** Schemas to include (if omitted, all non-system schemas) */
  schemas_include?: string[];

  /** Legacy field: schemas to include */
  schemas?: string[];

  /** Schemas to exclude (applied after include) */
  schemas_exclude?: string[];

  /** Table name patterns to exclude (glob patterns) */
  tables_exclude?: string[];

  /** Legacy field: exclude_tables */
  exclude_tables?: string[];

  /** Override default query timeout for this database */
  query_timeout_ms?: number;

  /** Override default sample size for this database */
  sample_size?: number;

  /** Human-readable description of this database */
  description?: string;
}

/**
 * Planner configuration from agent-config.yaml
 */
export interface PlannerConfig {
  /** Whether to run planning phase */
  enabled: boolean;
  /** Whether to use LLM for domain inference */
  domain_inference: boolean;
  /** Maximum tables per database */
  max_tables_per_database: number;
  /** Tables per LLM batch for domain inference */
  domain_inference_batch_size: number;
  /** LLM model for domain inference */
  llm_model?: string;
}

/**
 * Documenter configuration from agent-config.yaml
 */
export interface DocumenterConfig {
  concurrency: number;
  sample_timeout_ms: number;
  llm_model: string;
  checkpoint_interval: number;
  use_sub_agents: boolean;
}

/**
 * Full agent configuration
 */
export interface AgentConfig {
  planner: PlannerConfig;
  documenter?: DocumenterConfig;
  indexer?: {
    batch_size: number;
    embedding_model: string;
    checkpoint_interval: number;
  };
  retrieval?: {
    default_limit: number;
    max_limit: number;
    context_budgets: Record<string, number>;
    rrf_k: number;
    use_query_understanding: boolean;
  };
}

// =============================================================================
// TABLE METADATA INTERFACES (from connectors)
// =============================================================================

/**
 * Column metadata from database connector
 */
export interface ColumnMetadata {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  ordinal_position: number;
  character_maximum_length?: number;
  numeric_precision?: number;
  numeric_scale?: number;
  comment?: string;
}

/**
 * Foreign key metadata
 */
export interface ForeignKeyMetadata {
  constraint_name: string;
  column_name: string;
  referenced_table: string;
  referenced_column: string;
}

/**
 * Index metadata
 */
export interface IndexMetadataInfo {
  index_name: string;
  index_definition: string;
  columns: string[];
  is_unique: boolean;
}

/**
 * Complete table metadata from database connector
 */
export interface TableMetadata {
  table_schema: string;
  table_name: string;
  table_type: string;
  comment?: string;
  row_count: number;
  columns: ColumnMetadata[];
  primary_key: string[];
  foreign_keys: ForeignKeyMetadata[];
  indexes: IndexMetadataInfo[];
  /** Computed: full name with schema */
  name?: string;
}

/**
 * Relationship between tables
 */
export interface Relationship {
  source_table: string;
  source_column: string;
  target_table: string;
  target_column: string;
  relationship_type: string;
  constraint_name: string;
}

// =============================================================================
// VALIDATION RESULT
// =============================================================================

/**
 * Result of validation operations
 */
export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: ValidationError[];
}

/**
 * Validation error details
 */
export interface ValidationError {
  path: string;
  message: string;
}
