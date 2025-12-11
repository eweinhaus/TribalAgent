/**
 * Type definitions for output generators
 * 
 * These types define the data structures used by MarkdownGenerator and JSONGenerator
 * to produce documentation files.
 */

/**
 * Foreign key relationship data
 */
export interface ForeignKeyData {
  /** Column name in the current table */
  column_name: string;
  /** Referenced table name */
  referenced_table: string;
  /** Referenced column name */
  referenced_column: string;
}

/**
 * Referenced by relationship data
 * Indicates that other tables reference this table
 */
export interface ReferencedByData {
  /** Table that references this table */
  referencing_table: string;
  /** Column in the referencing table */
  referencing_column: string;
}

/**
 * Index metadata
 */
export interface IndexData {
  /** Index name */
  index_name?: string;
  /** Index definition or columns */
  index_definition?: string;
  /** Index name (alternative field) */
  name?: string;
}

/**
 * Table metadata for documentation
 */
export interface TableMetadata {
  /** Approximate row count */
  row_count_approx?: number;
  /** Number of columns */
  column_count: number;
  /** Primary key columns */
  primary_key: string[];
  /** Foreign key relationships */
  foreign_keys: ForeignKeyData[];
  /** Indexes on this table */
  indexes?: IndexData[];
  /** Tables that reference this table */
  referenced_by?: ReferencedByData[];
}

/**
 * Column data for documentation
 */
export interface ColumnData {
  /** Column name */
  name: string;
  /** Data type */
  data_type: string;
  /** Nullable status (YES/NO) */
  is_nullable: string;
  /** Column description */
  description: string;
  /** Sample values from the column */
  sample_values?: string[];
  /** Default value */
  column_default?: string | null;
}

/**
 * Complete table documentation data
 * This is the input structure for both MarkdownGenerator and JSONGenerator
 */
export interface TableDocumentationData {
  /** Database name */
  database: string;
  /** Schema name */
  schema: string;
  /** Table name */
  table: string;
  /** Table description */
  description: string;
  /** Table metadata */
  metadata: TableMetadata;
  /** Column data with descriptions */
  columns: ColumnData[];
  /** Sample data rows (up to 5) */
  sampleData: any[];
}
