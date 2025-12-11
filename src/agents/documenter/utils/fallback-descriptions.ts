/**
 * Fallback Description Utilities
 * 
 * Generates basic metadata-only descriptions when LLM fails.
 * These functions never throw errors and always return valid strings.
 */

/**
 * Generate fallback description for a table using only metadata
 * 
 * Format: "Table {table_name} contains {column_count} columns with approximately {row_count_approx} rows."
 * 
 * @param tableSpec Table specification
 * @returns Fallback description string
 */
export function generateTableFallbackDescription(tableSpec: {
  table_name?: string;
  column_count?: number;
  row_count_approx?: number;
}): string {
  const tableName = tableSpec.table_name || 'unknown table';
  const columnCount = tableSpec.column_count ?? 0;
  const rowCount = tableSpec.row_count_approx ?? 0;

  return `Table ${tableName} contains ${columnCount} columns with approximately ${rowCount} rows.`;
}

/**
 * Generate fallback description for a column using only metadata
 * 
 * Format: "Column {column_name} of type {data_type}."
 * 
 * @param column Column metadata
 * @returns Fallback description string
 */
export function generateColumnFallbackDescription(column: {
  name?: string;
  data_type?: string;
}): string {
  const columnName = column.name || 'unknown column';
  const dataType = column.data_type || 'unknown type';

  return `Column ${columnName} of type ${dataType}.`;
}

