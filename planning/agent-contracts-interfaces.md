# Tribal Knowledge Deep Agent
## Agent Contracts - Interface Definitions

**Version**: 1.0  
**Date**: December 10, 2025  
**Author**: Systems Architect  
**Status**: Draft  
**Companion**: See `agent-contracts-execution.md` for parallel execution model

---

## 1. Overview

This document defines the TypeScript interfaces and data structures for all inter-agent communication. It serves as the type-level contract between the four agent phases:

1. **Planner (Schema Analyzer)** → Outputs `documentation-plan.json`
2. **Documenter** → Outputs `documentation-manifest.json` + `/docs/` files
3. **Indexer** → Populates SQLite database
4. **Retriever** → Exposes MCP tools

### 1.1 Document Organization

| Section | Contents |
|---------|----------|
| §2 | Common types shared across all agents |
| §3 | Planner output interfaces |
| §4 | Documenter interfaces (progress + manifest) |
| §5 | Indexer interfaces |
| §6 | Retriever/MCP tool interfaces |
| §7 | JSON Schema definitions |

---

## 2. Common Types

```typescript
// =============================================================================
// COMMON TYPES - Shared across all agents
// =============================================================================

/** ISO 8601 timestamp string */
type ISOTimestamp = string;

/** SHA-256 hash string (64 hex characters) */
type ContentHash = string;

/** Agent execution status */
type AgentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'partial';

/** Database type identifier */
type DatabaseType = 'postgres' | 'snowflake';

/** Table priority for documentation order (1=core, 2=standard, 3=system) */
type TablePriority = 1 | 2 | 3;

/** Fully qualified table name: database.schema.table */
type FullyQualifiedTableName = string;

/** Domain name (lowercase, no spaces) */
type DomainName = string;

/** Error severity level */
type ErrorSeverity = 'warning' | 'error' | 'fatal';

/**
 * Base error structure used throughout the system.
 * All agents use this format for consistent error handling.
 */
interface AgentError {
  /** Machine-readable error code (e.g., "DB_CONNECTION_FAILED") */
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
```

---

## 3. Planner Output Interfaces

### 3.1 DocumentationPlan (Root)

```typescript
/**
 * Root structure of the documentation plan.
 * File: progress/documentation-plan.json
 * Producer: Planner
 * Consumer: Documenter
 */
interface DocumentationPlan {
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
```

### 3.2 DatabaseAnalysis

```typescript
/**
 * Analysis results for a single database.
 */
interface DatabaseAnalysis {
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
```

### 3.3 WorkUnit (Key for Parallelization)

```typescript
/**
 * A discrete, self-contained unit of work for the Documenter.
 * Each work unit can be processed independently and in parallel.
 * This is the KEY ENABLER for parallel domain processing.
 */
interface WorkUnit {
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
```

### 3.4 TableSpec

```typescript
/**
 * Specification for a single table to be documented.
 */
interface TableSpec {
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
```

### 3.5 PlanSummary

```typescript
/**
 * Summary statistics for the entire plan.
 */
interface PlanSummary {
  total_databases: number;
  reachable_databases: number;
  total_tables: number;
  total_work_units: number;
  domain_count: number;
  total_estimated_minutes: number;
  /** Recommended number of parallel workers */
  recommended_parallelism: number;
}
```

---

## 4. Documenter Interfaces

### 4.1 DocumenterProgress

```typescript
/**
 * Progress tracking for overall documentation process.
 * File: progress/documenter-progress.json
 * Producer: Documenter
 * Consumer: Orchestrator, CLI
 */
interface DocumenterProgress {
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
```

### 4.2 WorkUnitProgress

```typescript
/**
 * Progress tracking for a single work unit.
 * File: progress/work_units/{id}/progress.json
 */
interface WorkUnitProgress {
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
```

### 4.3 DocumenterStats

```typescript
interface DocumenterStats {
  total_tables: number;
  completed_tables: number;
  failed_tables: number;
  skipped_tables: number;
  llm_tokens_used: number;
  llm_time_ms: number;
  db_query_time_ms: number;
}
```

### 4.4 DocumentationManifest (Handoff to Indexer)

```typescript
/**
 * Manifest of completed documentation.
 * File: docs/documentation-manifest.json
 * Producer: Documenter (on completion)
 * Consumer: Indexer
 * 
 * THIS IS THE PRIMARY HANDOFF CONTRACT FROM DOCUMENTER TO INDEXER.
 */
interface DocumentationManifest {
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

interface DatabaseManifest {
  name: string;
  type: DatabaseType;
  docs_directory: string;
  tables_documented: number;
  tables_failed: number;
  domains: string[];
}

interface WorkUnitManifest {
  id: string;
  status: 'completed' | 'failed' | 'partial';
  output_directory: string;
  files_generated: number;
  output_hash: ContentHash;
  /** Can this work unit be re-processed independently? */
  reprocessable: boolean;
  errors?: AgentError[];
}

interface IndexableFile {
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
```

---

## 5. Indexer Interfaces

### 5.1 IndexerProgress

```typescript
/**
 * Progress tracking for indexing process.
 * File: progress/indexer-progress.json
 */
interface IndexerProgress {
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
```

### 5.2 IndexMetadata

```typescript
/**
 * Index metadata stored in SQLite.
 * Table: index_metadata
 */
interface IndexMetadata {
  last_full_index: ISOTimestamp;
  manifest_hash: ContentHash;
  document_count: number;
  embedding_count: number;
  index_version: string;
  embedding_model: string;
  embedding_dimensions: number;
}
```

### 5.3 DocumentRecord

```typescript
/**
 * Document record stored in SQLite.
 * Table: documents
 */
interface DocumentRecord {
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
```

---

## 6. Retriever/MCP Interfaces

### 6.1 search_tables Tool

```typescript
interface SearchTablesInput {
  /** Natural language search query (required) */
  query: string;
  /** Filter to specific database */
  database?: string;
  /** Filter to specific domain */
  domain?: DomainName;
  /** Max results (default: 5, max: 20) */
  limit?: number;
  /** Min relevance score threshold (0-1) */
  min_score?: number;
}

interface SearchTablesOutput {
  success: boolean;
  tables: TableSearchResult[];
  total_matches: number;
  tokens_used: number;
  query_interpretation?: QueryInterpretation;
  error?: AgentError;
}

interface TableSearchResult {
  name: FullyQualifiedTableName;
  database: string;
  schema: string;
  table: string;
  domain: DomainName;
  description: string;
  key_columns: ColumnSummary[];
  row_count: number;
  relevance_score: number;
}

interface ColumnSummary {
  name: string;
  type: string;
  description: string;
  is_primary_key: boolean;
  is_foreign_key: boolean;
}

interface QueryInterpretation {
  original_query: string;
  concepts: string[];
  expanded_terms: string[];
  domain_hint: DomainName | null;
  is_relationship_query: boolean;
}
```

### 6.2 get_table_schema Tool

```typescript
interface GetTableSchemaInput {
  /** Fully qualified table name (required) */
  table: FullyQualifiedTableName;
  /** Include sample values? */
  include_samples?: boolean;
  /** Include related tables? */
  include_relationships?: boolean;
}

interface GetTableSchemaOutput {
  success: boolean;
  schema?: TableSchema;
  tokens_used: number;
  error?: AgentError;
}

interface TableSchema {
  name: FullyQualifiedTableName;
  database: string;
  schema: string;
  table: string;
  domain: DomainName;
  description: string;
  row_count: number;
  columns: ColumnDetail[];
  primary_key: string[];
  foreign_keys: ForeignKeyDetail[];
  indexes: IndexDetail[];
  related_tables?: RelatedTable[];
}

interface ColumnDetail {
  name: string;
  type: string;
  nullable: boolean;
  default_value: string | null;
  description: string;
  samples?: string[];
}

interface ForeignKeyDetail {
  name: string;
  columns: string[];
  references_table: FullyQualifiedTableName;
  references_columns: string[];
}

interface IndexDetail {
  name: string;
  columns: string[];
  unique: boolean;
}

interface RelatedTable {
  name: FullyQualifiedTableName;
  relationship: 'references' | 'referenced_by';
  via_columns: string[];
  description: string;
}
```

### 6.3 get_join_path Tool

```typescript
interface GetJoinPathInput {
  source_table: FullyQualifiedTableName;
  target_table: FullyQualifiedTableName;
  max_hops?: number; // default: 3
}

interface GetJoinPathOutput {
  success: boolean;
  path_found: boolean;
  source: FullyQualifiedTableName;
  target: FullyQualifiedTableName;
  hop_count?: number;
  path?: JoinStep[];
  sql_snippet?: string;
  tokens_used: number;
  error?: AgentError;
}

interface JoinStep {
  step: number;
  from_table: FullyQualifiedTableName;
  to_table: FullyQualifiedTableName;
  join_type: 'INNER' | 'LEFT' | 'RIGHT';
  on_clause: string;
}
```

### 6.4 get_domain_overview Tool

```typescript
interface GetDomainOverviewInput {
  domain: DomainName;
  database?: string;
}

interface GetDomainOverviewOutput {
  success: boolean;
  domain: DomainName;
  description: string;
  databases: string[];
  tables: DomainTableSummary[];
  er_diagram?: string; // Mermaid syntax
  common_joins?: string[];
  tokens_used: number;
  error?: AgentError;
}

interface DomainTableSummary {
  name: FullyQualifiedTableName;
  description: string;
  row_count: number;
}
```

### 6.5 list_domains Tool

```typescript
interface ListDomainsInput {
  database?: string;
}

interface ListDomainsOutput {
  success: boolean;
  domains: DomainInfo[];
  tokens_used: number;
  error?: AgentError;
}

interface DomainInfo {
  name: DomainName;
  description: string;
  table_count: number;
  databases: string[];
}
```

---

## 7. JSON Schema (Condensed)

### 7.1 documentation-plan.json Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "documentation-plan.schema.json",
  "type": "object",
  "required": ["schema_version", "generated_at", "config_hash", "work_units", "summary"],
  "properties": {
    "schema_version": { "const": "1.0" },
    "generated_at": { "type": "string", "format": "date-time" },
    "config_hash": { "type": "string", "minLength": 64 },
    "complexity": { "enum": ["simple", "moderate", "complex"] },
    "databases": { "type": "array" },
    "work_units": { "type": "array", "minItems": 1 },
    "summary": { "type": "object" },
    "errors": { "type": "array" }
  }
}
```

### 7.2 documentation-manifest.json Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "documentation-manifest.schema.json",
  "type": "object",
  "required": ["schema_version", "completed_at", "status", "indexable_files"],
  "properties": {
    "schema_version": { "const": "1.0" },
    "completed_at": { "type": "string", "format": "date-time" },
    "plan_hash": { "type": "string" },
    "status": { "enum": ["complete", "partial"] },
    "databases": { "type": "array" },
    "work_units": { "type": "array" },
    "total_files": { "type": "integer" },
    "indexable_files": { "type": "array" }
  }
}
```

---

## 8. File Location Summary

| File | Producer | Consumer | Purpose |
|------|----------|----------|---------|
| `progress/documentation-plan.json` | Planner | Documenter | Plan with work units |
| `progress/documenter-progress.json` | Documenter | Orchestrator | Aggregated progress |
| `progress/work_units/{id}/progress.json` | Documenter | Parent Documenter | Per-unit progress |
| `docs/documentation-manifest.json` | Documenter | Indexer | Completion handoff |
| `progress/indexer-progress.json` | Indexer | Orchestrator | Indexing progress |
| `data/tribal-knowledge.db` | Indexer | Retriever | Search index |

---

## 9. Type Export Summary

For implementation, export all types from a central module:

```typescript
// src/contracts/types.ts

// Common
export type { ISOTimestamp, ContentHash, AgentStatus, DatabaseType };
export type { TablePriority, FullyQualifiedTableName, DomainName };
export type { ErrorSeverity, AgentError };

// Planner
export type { DocumentationPlan, DatabaseAnalysis, WorkUnit, TableSpec, PlanSummary };

// Documenter
export type { DocumenterProgress, WorkUnitProgress, DocumenterStats };
export type { DocumentationManifest, DatabaseManifest, WorkUnitManifest, IndexableFile };

// Indexer
export type { IndexerProgress, IndexMetadata, DocumentRecord };

// Retriever
export type { SearchTablesInput, SearchTablesOutput, TableSearchResult };
export type { GetTableSchemaInput, GetTableSchemaOutput, TableSchema };
export type { GetJoinPathInput, GetJoinPathOutput, JoinStep };
export type { GetDomainOverviewInput, GetDomainOverviewOutput };
export type { ListDomainsInput, ListDomainsOutput, DomainInfo };
export type { ColumnSummary, ColumnDetail, ForeignKeyDetail, IndexDetail };
export type { QueryInterpretation, RelatedTable };
```

---

## Appendix A: Error Code Registry

All agents must use these canonical error codes. Do not invent new codes without adding them here first.

```typescript
// src/contracts/errors.ts

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

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];
```

---

## Appendix B: Configuration File Schemas

### B.1 databases.yaml

```typescript
/**
 * Root configuration for database connections.
 * File: config/databases.yaml
 */
interface DatabaseCatalog {
  /** Schema version for config format */
  version: '1.0';
  
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
interface DatabaseConfig {
  /** Unique identifier for this database (used in output paths) */
  name: string;
  
  /** Database platform */
  type: DatabaseType;  // 'postgres' | 'snowflake'
  
  /** Environment variable containing connection string (Postgres) */
  connection_string_env?: string;
  
  /** Snowflake-specific connection parameters */
  snowflake?: {
    account_env: string;      // env var for account
    username_env: string;     // env var for username
    password_env: string;     // env var for password
    warehouse: string;
    database: string;
    role?: string;
  };
  
  /** Schemas to include (if omitted, all non-system schemas) */
  schemas_include?: string[];
  
  /** Schemas to exclude (applied after include) */
  schemas_exclude?: string[];
  
  /** Table name patterns to exclude (glob patterns) */
  tables_exclude?: string[];
  
  /** Override default query timeout for this database */
  query_timeout_ms?: number;
  
  /** Override default sample size for this database */
  sample_size?: number;
  
  /** Human-readable description of this database */
  description?: string;
}
```

**Example databases.yaml:**
```yaml
version: "1.0"

defaults:
  query_timeout_ms: 30000
  sample_size: 100

databases:
  - name: production
    type: postgres
    connection_string_env: PRODUCTION_DATABASE_URL
    schemas_exclude:
      - pg_catalog
      - information_schema
    tables_exclude:
      - "*_backup"
      - "*_temp"
    description: "Main production database"

  - name: analytics
    type: snowflake
    snowflake:
      account_env: SNOWFLAKE_ACCOUNT
      username_env: SNOWFLAKE_USER
      password_env: SNOWFLAKE_PASSWORD
      warehouse: COMPUTE_WH
      database: ANALYTICS
      role: ANALYST
    schemas_include:
      - PUBLIC
      - REPORTING
    description: "Snowflake analytics warehouse"
```

### B.2 agent-config.yaml

```typescript
/**
 * Configuration for agent behavior.
 * File: config/agent-config.yaml
 */
interface AgentConfig {
  /** Schema version */
  version: '1.0';
  
  /** Planner configuration */
  planner: {
    /** Whether to use LLM for domain inference (vs prefix-based fallback) */
    use_llm_for_domains: boolean;
    /** LLM model for domain inference */
    llm_model?: string;
    /** Maximum tables before splitting into multiple LLM calls */
    domain_inference_batch_size?: number;
  };
  
  /** Documenter configuration */
  documenter: {
    /** Max parallel work units */
    max_parallel_work_units: number;
    /** Max parallel tables within each work unit */
    max_parallel_tables: number;
    /** Max parallel LLM calls across all work units */
    max_parallel_llm_calls: number;
    /** Timeout for sampling queries (ms) */
    sampling_timeout_ms: number;
    /** Max rows to sample per table */
    sample_size: number;
    /** LLM model for descriptions */
    llm_model: string;
    /** Max tokens for column description */
    column_description_max_tokens: number;
    /** Max tokens for table description */
    table_description_max_tokens: number;
    /** Checkpoint after this many tables */
    checkpoint_interval: number;
  };
  
  /** Indexer configuration */
  indexer: {
    /** Embedding model */
    embedding_model: string;
    /** Documents per embedding API call */
    embedding_batch_size: number;
    /** Max retries for embedding API */
    embedding_max_retries: number;
    /** Checkpoint after this many files */
    checkpoint_interval: number;
  };
  
  /** Retriever configuration */
  retriever: {
    /** Default search result limit */
    default_limit: number;
    /** Maximum search result limit */
    max_limit: number;
    /** RRF constant for hybrid search */
    rrf_k: number;
    /** Whether to use LLM for query understanding */
    use_query_understanding: boolean;
    /** Context budget tiers (tokens) */
    context_budgets: {
      simple: number;
      moderate: number;
      complex: number;
    };
  };
  
  /** Logging configuration */
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    format: 'json' | 'pretty';
    /** Include full error stack traces */
    include_stack_traces: boolean;
  };
}
```

**Example agent-config.yaml:**
```yaml
version: "1.0"

planner:
  use_llm_for_domains: true
  llm_model: claude-sonnet-4-20250514
  domain_inference_batch_size: 100

documenter:
  max_parallel_work_units: 4
  max_parallel_tables: 3
  max_parallel_llm_calls: 5
  sampling_timeout_ms: 5000
  sample_size: 100
  llm_model: claude-sonnet-4-20250514
  column_description_max_tokens: 100
  table_description_max_tokens: 200
  checkpoint_interval: 10

indexer:
  embedding_model: text-embedding-3-small
  embedding_batch_size: 50
  embedding_max_retries: 3
  checkpoint_interval: 100

retriever:
  default_limit: 5
  max_limit: 20
  rrf_k: 60
  use_query_understanding: false
  context_budgets:
    simple: 750
    moderate: 1500
    complex: 3000

logging:
  level: info
  format: json
  include_stack_traces: false
```

---

## Appendix C: LLM Wrapper Interface

All agents use a shared LLM wrapper for consistent behavior, token tracking, and error handling.

```typescript
// src/llm/types.ts

/**
 * Request to the LLM wrapper.
 */
interface LLMRequest {
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
interface LLMResponse {
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

/**
 * LLM wrapper interface - all agents import this.
 */
interface LLMClient {
  /**
   * Call LLM with a prompt template.
   * Handles: template loading, variable substitution, retries, token tracking.
   */
  call(request: LLMRequest): Promise<LLMResponse>;
  
  /**
   * Get cumulative token usage for this session.
   */
  getTokenUsage(): { input: number; output: number; total: number };
  
  /**
   * Reset token counter (e.g., at start of new work unit).
   */
  resetTokenUsage(): void;
}
```

**Usage example:**
```typescript
const llm: LLMClient = createLLMClient(config);

const response = await llm.call({
  template: 'column-description.md',
  variables: {
    database: 'production',
    schema: 'public',
    table: 'customers',
    column: 'email',
    data_type: 'varchar(255)',
    sample_values: 'john@example.com, jane@test.org',
  },
  max_tokens: 100,
  response_format: 'text',
  purpose: 'column_description',
});

if (response.success) {
  const description = response.content as string;
} else {
  // Handle error, use fallback
}
```

---

## Appendix D: Logging Contract

All agents use structured JSON logging with correlation IDs for tracing across parallel execution.

```typescript
// src/logging/types.ts

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type AgentName = 'planner' | 'documenter' | 'indexer' | 'retriever' | 'orchestrator';

/**
 * Structured log entry format.
 * All log output must conform to this structure.
 */
interface LogEntry {
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
    error_code?: ErrorCode;
    /** Duration of operation in ms */
    duration_ms?: number;
    /** Token counts for LLM operations */
    tokens?: { input: number; output: number };
    /** Any additional context */
    [key: string]: unknown;
  };
}

/**
 * Logger interface - all agents import this.
 */
interface Logger {
  debug(message: string, context?: LogEntry['context']): void;
  info(message: string, context?: LogEntry['context']): void;
  warn(message: string, context?: LogEntry['context']): void;
  error(message: string, context?: LogEntry['context']): void;
  
  /** Create a child logger with preset context (e.g., work_unit_id) */
  child(context: Partial<LogEntry>): Logger;
}
```

**Log output example (JSON format):**
```json
{"timestamp":"2025-12-10T14:30:00.123Z","level":"info","agent":"documenter","work_unit_id":"production_customers","correlation_id":"abc123","message":"Starting table documentation","context":{"operation":"document_table","database":"production","table":"public.customers"}}
{"timestamp":"2025-12-10T14:30:02.456Z","level":"info","agent":"documenter","work_unit_id":"production_customers","correlation_id":"abc123","message":"Column descriptions complete","context":{"operation":"describe_columns","database":"production","table":"public.customers","duration_ms":2333,"tokens":{"input":1250,"output":340}}}
{"timestamp":"2025-12-10T14:30:02.789Z","level":"warn","agent":"documenter","work_unit_id":"production_customers","correlation_id":"abc123","message":"Sampling timed out, continuing without samples","context":{"operation":"sample_data","database":"production","table":"public.customers","error_code":"DOC_SAMPLING_TIMEOUT"}}
```

**Correlation ID flow:**
```
Orchestrator generates: correlation_id = "run-20251210-143000"
    │
    ├─► Planner logs with correlation_id
    │
    ├─► Documenter logs with correlation_id
    │       │
    │       ├─► WorkUnit "production_customers" logs with correlation_id + work_unit_id
    │       ├─► WorkUnit "production_orders" logs with correlation_id + work_unit_id
    │       └─► WorkUnit "production_products" logs with correlation_id + work_unit_id
    │
    ├─► Indexer logs with correlation_id
    │
    └─► All logs can be filtered by correlation_id to see full pipeline
```

---

## Appendix E: Example Contract Files

### E.1 Example documentation-plan.json

```json
{
  "schema_version": "1.0",
  "generated_at": "2025-12-10T14:00:00.000Z",
  "config_hash": "a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd",
  "complexity": "moderate",
  "databases": [
    {
      "name": "production",
      "type": "postgres",
      "status": "reachable",
      "table_count": 47,
      "schema_count": 2,
      "estimated_time_minutes": 12,
      "domains": {
        "customers": ["public.customers", "public.addresses", "public.customer_preferences"],
        "orders": ["public.orders", "public.order_items", "public.order_status_history"],
        "products": ["inventory.products", "inventory.categories", "inventory.suppliers"],
        "payments": ["public.payments", "public.refunds", "public.payment_methods"],
        "system": ["public.audit_log", "public.migrations"]
      },
      "schema_hash": "f1e2d3c4b5a6789012345678901234567890123456789012345678901234wxyz"
    }
  ],
  "work_units": [
    {
      "id": "production_customers",
      "database": "production",
      "domain": "customers",
      "tables": [
        {
          "fully_qualified_name": "production.public.customers",
          "schema_name": "public",
          "table_name": "customers",
          "domain": "customers",
          "priority": 1,
          "column_count": 15,
          "row_count_approx": 125000,
          "incoming_fk_count": 8,
          "outgoing_fk_count": 0,
          "metadata_hash": "cust123hash",
          "existing_comment": "Core customer records"
        },
        {
          "fully_qualified_name": "production.public.addresses",
          "schema_name": "public",
          "table_name": "addresses",
          "domain": "customers",
          "priority": 2,
          "column_count": 10,
          "row_count_approx": 180000,
          "incoming_fk_count": 2,
          "outgoing_fk_count": 1,
          "metadata_hash": "addr456hash"
        },
        {
          "fully_qualified_name": "production.public.customer_preferences",
          "schema_name": "public",
          "table_name": "customer_preferences",
          "domain": "customers",
          "priority": 2,
          "column_count": 8,
          "row_count_approx": 95000,
          "incoming_fk_count": 0,
          "outgoing_fk_count": 1,
          "metadata_hash": "pref789hash"
        }
      ],
      "estimated_time_minutes": 2,
      "output_directory": "databases/production/domains/customers",
      "priority_order": 1,
      "depends_on": [],
      "content_hash": "workunit_customers_hash_abc123"
    },
    {
      "id": "production_orders",
      "database": "production",
      "domain": "orders",
      "tables": [
        {
          "fully_qualified_name": "production.public.orders",
          "schema_name": "public",
          "table_name": "orders",
          "domain": "orders",
          "priority": 1,
          "column_count": 18,
          "row_count_approx": 500000,
          "incoming_fk_count": 3,
          "outgoing_fk_count": 2,
          "metadata_hash": "orders123hash"
        }
      ],
      "estimated_time_minutes": 3,
      "output_directory": "databases/production/domains/orders",
      "priority_order": 2,
      "depends_on": [],
      "content_hash": "workunit_orders_hash_def456"
    }
  ],
  "summary": {
    "total_databases": 1,
    "reachable_databases": 1,
    "total_tables": 47,
    "total_work_units": 5,
    "domain_count": 5,
    "total_estimated_minutes": 12,
    "recommended_parallelism": 4
  },
  "errors": []
}
```

### E.2 Example documentation-manifest.json

```json
{
  "schema_version": "1.0",
  "completed_at": "2025-12-10T14:15:00.000Z",
  "plan_hash": "a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd",
  "status": "complete",
  "databases": [
    {
      "name": "production",
      "type": "postgres",
      "docs_directory": "databases/production",
      "tables_documented": 47,
      "tables_failed": 0,
      "domains": ["customers", "orders", "products", "payments", "system"]
    }
  ],
  "work_units": [
    {
      "id": "production_customers",
      "status": "completed",
      "output_directory": "databases/production/domains/customers",
      "files_generated": 8,
      "output_hash": "output_customers_xyz789",
      "reprocessable": true
    },
    {
      "id": "production_orders",
      "status": "completed",
      "output_directory": "databases/production/domains/orders",
      "files_generated": 6,
      "output_hash": "output_orders_abc123",
      "reprocessable": true
    }
  ],
  "total_files": 62,
  "indexable_files": [
    {
      "path": "databases/production/tables/public.customers.md",
      "type": "table",
      "database": "production",
      "schema": "public",
      "table": "customers",
      "domain": "customers",
      "content_hash": "file_customers_md_hash123",
      "size_bytes": 4523,
      "modified_at": "2025-12-10T14:12:30.000Z"
    },
    {
      "path": "databases/production/tables/public.addresses.md",
      "type": "table",
      "database": "production",
      "schema": "public",
      "table": "addresses",
      "domain": "customers",
      "content_hash": "file_addresses_md_hash456",
      "size_bytes": 3201,
      "modified_at": "2025-12-10T14:12:45.000Z"
    },
    {
      "path": "databases/production/domains/customers.md",
      "type": "domain",
      "database": "production",
      "domain": "customers",
      "content_hash": "file_customers_domain_hash789",
      "size_bytes": 2150,
      "modified_at": "2025-12-10T14:14:00.000Z"
    },
    {
      "path": "databases/production/tables/public.orders.md",
      "type": "table",
      "database": "production",
      "schema": "public",
      "table": "orders",
      "domain": "orders",
      "content_hash": "file_orders_md_hashabc",
      "size_bytes": 5102,
      "modified_at": "2025-12-10T14:13:15.000Z"
    }
  ]
}
```

---

*End of Interface Definitions - See `agent-contracts-execution.md` for parallel execution model*
