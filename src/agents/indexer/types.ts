/**
 * Indexer Agent Type Definitions
 *
 * All interfaces for the document indexing pipeline including:
 * - Manifest types (input from Documenter)
 * - Parsed document types (table, column, domain, relationship, overview)
 * - Index population types
 * - Progress tracking types
 */

import { z } from 'zod';

// =============================================================================
// Manifest Types (Input Contract from Documenter)
// =============================================================================

export type ISOTimestamp = string;
export type ContentHash = string;
export type DomainName = string;

export interface IndexableFile {
  path: string;                    // Relative path from /docs
  type: 'table' | 'domain' | 'overview' | 'relationship';
  database: string;
  schema?: string;
  table?: string;
  domain?: DomainName;
  content_hash: ContentHash;       // SHA-256 for change detection
  size_bytes: number;
  modified_at: ISOTimestamp;
}

export interface DatabaseManifest {
  name: string;
  connection_name: string;
  table_count: number;
  status: 'complete' | 'partial' | 'failed';
}

export interface WorkUnitManifest {
  id: string;
  database: string;
  table_count: number;
  status: 'complete' | 'partial' | 'failed';
}

export interface DocumentationManifest {
  schema_version: '1.0';
  completed_at: ISOTimestamp;
  plan_hash: ContentHash;
  status: 'complete' | 'partial';
  databases: DatabaseManifest[];
  work_units: WorkUnitManifest[];
  total_files: number;
  indexable_files: IndexableFile[];
}

// Zod schema for manifest validation
export const IndexableFileSchema = z.object({
  path: z.string(),
  type: z.enum(['table', 'domain', 'overview', 'relationship']),
  database: z.string(),
  schema: z.string().optional(),
  table: z.string().optional(),
  domain: z.string().optional(),
  content_hash: z.string(),
  size_bytes: z.number(),
  modified_at: z.string(),
});

export const DocumentationManifestSchema = z.object({
  schema_version: z.literal('1.0'),
  completed_at: z.string(),
  plan_hash: z.string(),
  status: z.enum(['complete', 'partial']),
  databases: z.array(z.object({
    name: z.string(),
    connection_name: z.string(),
    table_count: z.number(),
    status: z.enum(['complete', 'partial', 'failed']),
  })),
  work_units: z.array(z.object({
    id: z.string(),
    database: z.string(),
    table_count: z.number(),
    status: z.enum(['complete', 'partial', 'failed']),
  })),
  total_files: z.number(),
  indexable_files: z.array(IndexableFileSchema),
});

// =============================================================================
// Parsed Document Types
// =============================================================================

export interface ParsedColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  description: string;
  sampleValues?: string[];
}

export interface ForeignKeyInfo {
  sourceColumn: string;
  targetSchema: string;
  targetTable: string;
  targetColumn: string;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  isUnique: boolean;
}

export interface ParsedTableDoc {
  docType: 'table';
  database: string;
  schema: string;
  table: string;
  domain: string;
  description: string;
  columns: ParsedColumn[];
  primaryKey: string[];
  foreignKeys: ForeignKeyInfo[];
  indexes: IndexInfo[];
  rowCount: number;
  sampleData?: Record<string, unknown>[];
  keywords: string[];
  rawContent: string;
}

export interface ParsedColumnDoc {
  docType: 'column';
  database: string;
  schema: string;
  table: string;
  column: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  foreignKeyTarget?: string;
  description: string;
  sampleValues?: string[];
  keywords: string[];
  parentTablePath: string;  // Reference to parent table doc
  rawContent: string;       // Required for embedding text generation
}

export interface ParsedDomainDoc {
  docType: 'domain';
  database: string;
  domain: string;
  description: string;
  tables: string[];
  erDiagram?: string;
  keywords: string[];
  rawContent: string;
}

export interface ParsedOverviewDoc {
  docType: 'overview';
  database: string;
  title: string;
  description: string;
  sections: { heading: string; content: string }[];
  keywords: string[];
  rawContent: string;
}

export interface ParsedRelationshipDoc {
  docType: 'relationship';
  database: string;
  sourceSchema: string;
  sourceTable: string;
  sourceColumn: string;
  targetSchema: string;
  targetTable: string;
  targetColumn: string;
  relationshipType: string;
  description: string;
  joinCondition: string;
  keywords: string[];
  rawContent: string;
}

export type ParsedDocument =
  | ParsedTableDoc
  | ParsedColumnDoc
  | ParsedDomainDoc
  | ParsedOverviewDoc
  | ParsedRelationshipDoc;

// =============================================================================
// Processed Document Types (Ready for Index Population)
// =============================================================================

export interface ProcessedDocument {
  docType: ParsedDocument['docType'];
  database: string;
  schema?: string;
  table?: string;
  column?: string;
  domain?: string;
  content: string;
  summary: string;
  keywords: string[];
  filePath: string;
  contentHash: string;
  modifiedAt: string;
  parentTablePath?: string;  // For column docs
}

// =============================================================================
// Embedding Types
// =============================================================================

export interface EmbeddingResult {
  text: string;
  embedding: number[];
  tokenCount: number;
}

// =============================================================================
// Index Statistics
// =============================================================================

export interface IndexStats {
  inserted: number;
  updated: number;
  failed: number;
}

// =============================================================================
// Progress Tracking Types
// =============================================================================

export type AgentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'partial';

export interface AgentError {
  code: string;
  message: string;
  context?: Record<string, unknown>;
  timestamp?: ISOTimestamp;
}

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
  files_skipped: number;            // Already indexed, hash unchanged

  current_file?: string;
  current_phase: 'validating' | 'parsing' | 'embedding' | 'indexing' | 'relationships' | 'optimizing';

  embeddings_generated: number;
  embeddings_failed: number;

  last_checkpoint: ISOTimestamp;

  // Resume support
  indexed_files: string[];          // List of successfully indexed file paths
  failed_files: string[];           // List of failed file paths
  pending_files: string[];          // Files remaining to be processed

  errors: AgentError[];

  stats: {
    parse_time_ms: number;
    embedding_time_ms: number;
    index_time_ms: number;
    total_time_ms: number;
    table_docs: number;
    column_docs: number;
    domain_docs: number;
    relationship_docs: number;
  };
}

export const IndexerProgressSchema = z.object({
  schema_version: z.literal('1.0'),
  started_at: z.string(),
  completed_at: z.string().nullable(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'partial']),
  manifest_file: z.string(),
  manifest_hash: z.string(),
  files_total: z.number(),
  files_indexed: z.number(),
  files_failed: z.number(),
  files_skipped: z.number(),
  current_file: z.string().optional(),
  current_phase: z.enum(['validating', 'parsing', 'embedding', 'indexing', 'relationships', 'optimizing']),
  embeddings_generated: z.number(),
  embeddings_failed: z.number(),
  last_checkpoint: z.string(),
  indexed_files: z.array(z.string()),
  failed_files: z.array(z.string()),
  pending_files: z.array(z.string()),
  errors: z.array(z.object({
    code: z.string(),
    message: z.string(),
    context: z.record(z.unknown()).optional(),
    timestamp: z.string().optional(),
  })),
  stats: z.object({
    parse_time_ms: z.number(),
    embedding_time_ms: z.number(),
    index_time_ms: z.number(),
    total_time_ms: z.number(),
    table_docs: z.number(),
    column_docs: z.number(),
    domain_docs: z.number(),
    relationship_docs: z.number(),
  }),
});

// =============================================================================
// Incremental Indexing Types
// =============================================================================

export interface IncrementalIndexResult {
  newFiles: string[];
  changedFiles: string[];
  unchangedFiles: string[];
  deletedFiles: string[];
}

// =============================================================================
// Relationship Types
// =============================================================================

export interface DirectRelationship {
  database_name: string;
  source_schema: string;
  source_table: string;
  source_column: string;
  target_schema: string;
  target_table: string;
  target_column: string;
  join_sql: string;
}

export interface PathHop {
  sourceSchema: string;
  sourceTable: string;
  sourceColumn: string;
  targetSchema: string;
  targetTable: string;
  targetColumn: string;
  joinSql: string;
}

export interface JoinPath {
  hops: PathHop[];
  tables: string[];
}

// =============================================================================
// CLI Options
// =============================================================================

export interface IndexerOptions {
  incremental?: boolean;
  resume?: boolean;
  force?: boolean;
  skipEmbeddings?: boolean;
  dryRun?: boolean;
  workUnit?: string;
}

// =============================================================================
// Error Types
// =============================================================================

export type IndexerErrorCode =
  | 'IDX_MANIFEST_NOT_FOUND'
  | 'IDX_MANIFEST_INVALID'
  | 'IDX_FILE_NOT_FOUND'
  | 'IDX_FILE_HASH_MISMATCH'
  | 'IDX_PARSE_FAILED'
  | 'IDX_EMBEDDING_FAILED'
  | 'IDX_EMBEDDING_RATE_LIMITED'
  | 'IDX_DB_WRITE_FAILED'
  | 'IDX_FTS_FAILED'
  | 'IDX_VECTOR_FAILED';

export class IndexerError extends Error {
  code: IndexerErrorCode;
  recoverable: boolean;
  context?: Record<string, unknown>;

  constructor(code: IndexerErrorCode, message: string, recoverable = false, context?: Record<string, unknown>) {
    super(message);
    this.name = 'IndexerError';
    this.code = code;
    this.recoverable = recoverable;
    this.context = context;
  }
}
