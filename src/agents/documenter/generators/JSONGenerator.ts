/**
 * JSON Generator
 * 
 * Generates structured JSON schema files for database tables
 * following the PRD structure exactly.
 */

import type {
  TableDocumentationData,
  TableMetadata,
  ColumnData,
} from './types.js';

/**
 * JSONGenerator class for generating table schema JSON files
 */
export class JSONGenerator {
  /**
   * Generate JSON documentation for a table
   * 
   * @param tableData Complete table documentation data
   * @returns JSON string following PRD structure
   */
  static generate(tableData: TableDocumentationData): string {
    const jsonObject = {
      schema_version: '1.0',
      database: tableData.database,
      schema: tableData.schema,
      table: tableData.table,
      description: tableData.description,
      metadata: this.formatMetadata(tableData.metadata),
      columns: tableData.columns.map(col => this.formatColumn(col)),
      sample_data: this.formatSampleData(tableData.sampleData),
    };

    // Generate JSON with 2-space indentation
    const jsonString = JSON.stringify(jsonObject, null, 2);

    // Validate JSON before returning
    try {
      JSON.parse(jsonString);
    } catch (error) {
      throw new Error(`Generated invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }

    return jsonString;
  }

  /**
   * Format column data for JSON output
   * 
   * @param column Column data
   * @returns Formatted column object
   */
  static formatColumn(column: ColumnData): object {
    const columnObj: any = {
      name: column.name,
      data_type: column.data_type,
      is_nullable: column.is_nullable, // Keep as "YES"/"NO" per PRD
      description: column.description,
    };

    // Add sample values if available
    if (column.sample_values && column.sample_values.length > 0) {
      columnObj.sample_values = column.sample_values.slice(0, 10); // Limit to 10
    }

    // Add default value if present
    if (column.column_default !== undefined && column.column_default !== null) {
      columnObj.column_default = column.column_default;
    }

    return columnObj;
  }

  /**
   * Format metadata for JSON output
   * 
   * @param metadata Table metadata
   * @returns Formatted metadata object
   */
  static formatMetadata(metadata: TableMetadata): object {
    const metaObj: any = {
      column_count: metadata.column_count,
      primary_key: metadata.primary_key || [],
      foreign_keys: metadata.foreign_keys || [],
      indexes: metadata.indexes || [],
    };

    // Add optional fields if present
    if (metadata.row_count_approx !== undefined) {
      metaObj.row_count_approx = metadata.row_count_approx;
    }

    if (metadata.referenced_by && metadata.referenced_by.length > 0) {
      metaObj.referenced_by = metadata.referenced_by;
    }

    return metaObj;
  }

  /**
   * Format sample data for JSON output
   * Limits to 5 rows and truncates string values > 100 characters
   * 
   * @param sampleRows Sample data rows
   * @param maxRows Maximum number of rows to include (default: 5)
   * @returns Formatted sample data array
   */
  static formatSampleData(sampleRows: any[], maxRows: number = 5): any[] {
    if (sampleRows.length === 0) {
      return [];
    }

    const rows = sampleRows.slice(0, maxRows);
    const formattedRows: any[] = [];

    for (const row of rows) {
      const formattedRow: any = {};
      for (const [key, value] of Object.entries(row)) {
        // Truncate string values > 100 characters
        if (value === null || value === undefined) {
          formattedRow[key] = null;
        } else if (typeof value === 'string') {
          formattedRow[key] = value.length > 100 ? value.substring(0, 97) + '...' : value;
        } else {
          // Preserve other data types (numbers, booleans, etc.)
          formattedRow[key] = value;
        }
      }
      formattedRows.push(formattedRow);
    }

    return formattedRows;
  }
}
