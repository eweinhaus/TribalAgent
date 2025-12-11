/**
 * Markdown Generator
 * 
 * Generates professional Markdown documentation files for database tables
 * following the PRD structure exactly.
 */

import type {
  TableDocumentationData,
  TableMetadata,
  ColumnData,
} from './types.js';

/**
 * MarkdownGenerator class for generating table documentation
 */
export class MarkdownGenerator {
  /**
   * Generate Markdown documentation for a table
   * 
   * @param tableData Complete table documentation data
   * @returns Markdown string following PRD structure
   */
  static generate(tableData: TableDocumentationData): string {
    const lines: string[] = [];

    // Header: # {schema}.{table}
    lines.push(`# ${tableData.schema}.${tableData.table}`);
    lines.push('');

    // Table description paragraph
    lines.push(tableData.description);
    lines.push('');

    // Schema Information section
    lines.push('## Schema Information');
    lines.push(`- **Database**: ${tableData.database}`);
    lines.push(`- **Schema**: ${tableData.schema}`);
    lines.push(`- **Table**: ${tableData.table}`);
    if (tableData.metadata.row_count_approx !== undefined) {
      lines.push(`- **Row Count**: ~${tableData.metadata.row_count_approx.toLocaleString()}`);
    }
    lines.push(`- **Columns**: ${tableData.metadata.column_count}`);
    lines.push('');

    // Columns section
    lines.push('## Columns');
    lines.push('');

    for (const column of tableData.columns) {
      lines.push(this.formatColumnSection(column));
      lines.push('');
    }

    // Relationships section
    lines.push('## Relationships');
    lines.push(this.formatRelationships(tableData.metadata));
    lines.push('');

    // Sample Data section
    if (tableData.sampleData.length > 0) {
      lines.push('## Sample Data');
      lines.push('');
      lines.push(this.formatSampleData(tableData.sampleData));
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Format a single column section
   * 
   * @param column Column data
   * @returns Formatted column section
   */
  static formatColumnSection(column: ColumnData): string {
    const lines: string[] = [];

    // Column name in header should not be escaped (it's a header, not body text)
    lines.push(`### ${column.name}`);
    lines.push(`- **Type**: ${this.escapeMarkdown(column.data_type)}`);
    lines.push(`- **Nullable**: ${column.is_nullable}`);
    lines.push(`- **Description**: ${this.escapeMarkdown(column.description)}`);

    if (column.sample_values && column.sample_values.length > 0) {
      const sampleValuesStr = column.sample_values
        .slice(0, 10) // Limit to 10 sample values
        .map(v => this.escapeMarkdown(String(v)))
        .join(', ');
      lines.push(`- **Sample Values**: ${sampleValuesStr}`);
    } else {
      lines.push(`- **Sample Values**: No sample values available`);
    }

    return lines.join('\n');
  }

  /**
   * Format sample data as code block
   * 
   * @param sampleRows Sample data rows
   * @param maxRows Maximum number of rows to include (default: 5)
   * @returns Formatted sample data as code block
   */
  static formatSampleData(sampleRows: any[], maxRows: number = 5): string {
    if (sampleRows.length === 0) {
      return '```\nNo sample data available\n```';
    }

    const rows = sampleRows.slice(0, maxRows);
    const formattedRows: string[] = [];

    for (const row of rows) {
      const formattedRow: Record<string, any> = {};
      for (const [key, value] of Object.entries(row)) {
        // Truncate string values > 100 characters
        if (value === null || value === undefined) {
          formattedRow[key] = null;
        } else {
          const str = String(value);
          formattedRow[key] = str.length > 100 ? str.substring(0, 97) + '...' : value;
        }
      }
      formattedRows.push(JSON.stringify(formattedRow, null, 2));
    }

    return '```\n' + formattedRows.join('\n\n') + '\n```';
  }

  /**
   * Format relationships section
   * 
   * @param metadata Table metadata
   * @returns Formatted relationships section
   */
  static formatRelationships(metadata: TableMetadata): string {
    const lines: string[] = [];

    // Primary Key
    if (metadata.primary_key && metadata.primary_key.length > 0) {
      lines.push(`- **Primary Key**: ${metadata.primary_key.join(', ')}`);
    } else {
      lines.push(`- **Primary Key**: None`);
    }

    // Foreign Keys
    if (metadata.foreign_keys && metadata.foreign_keys.length > 0) {
      const fkStrings = metadata.foreign_keys.map(fk => 
        `${fk.column_name} → ${fk.referenced_table}.${fk.referenced_column}`
      );
      lines.push(`- **Foreign Keys**: ${fkStrings.join(', ')}`);
    } else {
      lines.push(`- **Foreign Keys**: None`);
    }

    // Referenced By
    if (metadata.referenced_by && metadata.referenced_by.length > 0) {
      const refStrings = metadata.referenced_by.map(ref => 
        `${ref.referencing_table}.${ref.referencing_column}`
      );
      lines.push(`- **Referenced By**: ${refStrings.join(', ')}`);
    } else {
      lines.push(`- **Referenced By**: None`);
    }

    return lines.join('\n');
  }

  /**
   * Escape Markdown special characters
   * Only escape characters that are problematic in Markdown body text
   * 
   * @param text Text to escape
   * @returns Escaped text
   */
  private static escapeMarkdown(text: string): string {
    if (!text) return '';
    
    // Escape Markdown special characters that cause issues in body text
    // Note: Parentheses don't need escaping in Markdown body text
    return String(text)
      .replace(/\\/g, '\\\\')  // Backslash
      .replace(/\*/g, '\\*')   // Asterisk (only if not in code)
      .replace(/#/g, '\\#')    // Hash (only if at start of line)
      .replace(/</g, '&lt;')   // Less than
      .replace(/>/g, '&gt;')   // Greater than
      .replace(/\|/g, '\\|');  // Pipe (only if in table context)
    // Note: We don't escape /, _, [, ], (, ) as they're generally safe in body text
  }
}

