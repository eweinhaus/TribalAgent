/**
 * TableDocumenter Sub-Agent
 *
 * Handles complete documentation of a single table.
 * Receives complete metadata from the documentation plan (Planner has already extracted it).
 * Samples data, spawns ColumnInferencer sub-agents, and generates final documentation.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../../../utils/logger.js';
import { getDatabaseConnector } from '../../../connectors/index.js';
import { loadPromptTemplate } from '../../../utils/prompts.js';
import { callLLM } from '../../../utils/llm.js';

export class TableDocumenter {
  private tableMetadata: any;
  private databaseConnector: any;
  private docsPath: string;

  constructor(tableMetadata: any) {
    this.tableMetadata = tableMetadata;
    this.docsPath = path.join(process.cwd(), 'docs');

    // Initialize database connector for sampling
    const dbConfig = this.getDatabaseConfig();
    this.databaseConnector = getDatabaseConnector(dbConfig.type);
  }

  /**
   * Main documentation method
   */
  async document(): Promise<void> {
    try {
      logger.debug(`Documenting table: ${this.tableMetadata.name}`);

      // Connect to database for sampling
      await this.databaseConnector.connect(this.getConnectionEnv());

      // Sample data from table
      const sampleData = await this.sampleTableData();

      // Spawn ColumnInferencer for each column
      const columnDescriptions = await this.documentColumns();

      // Generate table description
      const tableDescription = await this.generateTableDescription(sampleData);

      // Generate documentation files
      await this.generateMarkdownDoc(tableDescription, columnDescriptions, sampleData);
      await this.generateJSONDoc(tableDescription, columnDescriptions, sampleData);

      // Disconnect from database
      await this.databaseConnector.disconnect();

      logger.debug(`Completed documentation for table: ${this.tableMetadata.name}`);

    } catch (error) {
      logger.error(`Failed to document table ${this.tableMetadata.name}`, error);
      throw error;
    }
  }

  /**
   * Sample data from the table for inference
   */
  private async sampleTableData(): Promise<any[]> {
    try {
      // Sample up to 100 rows for pattern inference
      const sampleQuery = `SELECT * FROM ${this.tableMetadata.schema}.${this.tableMetadata.name} LIMIT 100`;
      const samples = await this.databaseConnector.query(sampleQuery);
      return samples;
    } catch (error) {
      logger.warn(`Failed to sample data from ${this.tableMetadata.name}`, error);
      return [];
    }
  }

  /**
   * Spawn ColumnInferencer sub-agents for each column
   */
  private async documentColumns(): Promise<Record<string, string>> {
    const columnDescriptions: Record<string, string> = {};

    for (const column of this.tableMetadata.columns) {
      try {
        const { ColumnInferencer } = await import('./ColumnInferencer.js');
        const inferencer = new ColumnInferencer({
          ...column,
          table_name: this.tableMetadata.name,
          schema_name: this.tableMetadata.schema,
          database_name: this.tableMetadata.database,
        });

        const description = await inferencer.infer();
        columnDescriptions[column.name] = description;

      } catch (error) {
        logger.warn(`Failed to document column ${column.name}`, error);
        columnDescriptions[column.name] = 'Description unavailable';
      }
    }

    return columnDescriptions;
  }

  /**
   * Generate semantic description for the table
   */
  private async generateTableDescription(sampleData: any[]): Promise<string> {
    try {
      const template = await loadPromptTemplate('table-description');

      const variables = {
        database: this.tableMetadata.database,
        schema: this.tableMetadata.schema,
        table: this.tableMetadata.name,
        row_count: this.tableMetadata.row_count || 'Unknown',
        column_list: this.tableMetadata.columns.map((c: any) => c.name).join(', '),
        primary_key: this.tableMetadata.primary_key?.join(', ') || 'None',
        foreign_keys: this.formatForeignKeys(),
        existing_comment: this.tableMetadata.comment || '',
        sample_row: this.formatSampleRow(sampleData[0]),
      };

      const prompt = this.interpolateTemplate(template, variables);
      const response = await callLLM(prompt, 'claude-sonnet-4');

      return response.trim();

    } catch (error) {
      logger.warn(`Failed to generate table description for ${this.tableMetadata.name}`, error);
      return `Table ${this.tableMetadata.name} contains ${this.tableMetadata.columns.length} columns.`;
    }
  }

  /**
   * Generate Markdown documentation file
   */
  private async generateMarkdownDoc(
    tableDescription: string,
    columnDescriptions: Record<string, string>,
    sampleData: any[]
  ): Promise<void> {
    const content = this.buildMarkdownContent(tableDescription, columnDescriptions, sampleData);

    const filePath = this.getMarkdownFilePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  }

  /**
   * Generate JSON documentation file
   */
  private async generateJSONDoc(
    tableDescription: string,
    columnDescriptions: Record<string, string>,
    sampleData: any[]
  ): Promise<void> {
    const jsonData = {
      table: this.tableMetadata.name,
      schema: this.tableMetadata.schema,
      database: this.tableMetadata.database,
      description: tableDescription,
      row_count: this.tableMetadata.row_count,
      columns: this.tableMetadata.columns.map((col: any) => ({
        name: col.name,
        type: col.data_type,
        nullable: col.is_nullable === 'YES',
        description: columnDescriptions[col.name] || 'No description available',
        default: col.column_default,
      })),
      primary_key: this.tableMetadata.primary_key,
      foreign_keys: this.tableMetadata.foreign_keys,
      indexes: this.tableMetadata.indexes,
      sample_data: sampleData.slice(0, 5), // Include up to 5 sample rows
      generated_at: new Date().toISOString(),
    };

    const filePath = this.getJSONFilePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(jsonData, null, 2));
  }

  // Helper methods

  private getDatabaseConfig(): any {
    // TODO: Load from configuration
    return {
      type: 'postgres', // or 'snowflake'
      connection_env: 'DATABASE_URL',
    };
  }

  private getConnectionEnv(): string {
    return process.env.DATABASE_URL || '';
  }

  private formatForeignKeys(): string {
    if (!this.tableMetadata.foreign_keys || this.tableMetadata.foreign_keys.length === 0) {
      return 'None';
    }

    return this.tableMetadata.foreign_keys
      .map((fk: any) => `${fk.column_name} → ${fk.referenced_table}.${fk.referenced_column}`)
      .join(', ');
  }

  private formatSampleRow(sampleRow: any): string {
    if (!sampleRow) return 'No sample data available';

    return Object.entries(sampleRow)
      .map(([key, value]) => `${key}: ${String(value).substring(0, 50)}`)
      .join(', ');
  }

  private interpolateTemplate(template: string, variables: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }
    return result;
  }

  private buildMarkdownContent(
    tableDescription: string,
    columnDescriptions: Record<string, string>,
    sampleData: any[]
  ): string {
    const lines: string[] = [];

    lines.push(`# ${this.tableMetadata.name}`);
    lines.push('');
    lines.push(`**Database:** ${this.tableMetadata.database}`);
    lines.push(`**Schema:** ${this.tableMetadata.schema}`);
    lines.push(`**Description:** ${tableDescription}`);
    lines.push('');

    if (this.tableMetadata.row_count) {
      lines.push(`**Row Count:** ${this.tableMetadata.row_count.toLocaleString()}`);
      lines.push('');
    }

    // Columns section
    lines.push('## Columns');
    lines.push('');
    lines.push('| Column | Type | Nullable | Description |');
    lines.push('|--------|------|----------|-------------|');

    for (const column of this.tableMetadata.columns) {
      const desc = columnDescriptions[column.name] || 'No description available';
      lines.push(`| ${column.name} | ${column.data_type} | ${column.is_nullable} | ${desc} |`);
    }

    lines.push('');

    // Keys section
    if (this.tableMetadata.primary_key && this.tableMetadata.primary_key.length > 0) {
      lines.push('## Primary Key');
      lines.push('');
      lines.push(`\`${this.tableMetadata.primary_key.join(', ')}\``);
      lines.push('');
    }

    if (this.tableMetadata.foreign_keys && this.tableMetadata.foreign_keys.length > 0) {
      lines.push('## Foreign Keys');
      lines.push('');
      for (const fk of this.tableMetadata.foreign_keys) {
        lines.push(`- \`${fk.column_name}\` → \`${fk.referenced_table}.${fk.referenced_column}\``);
      }
      lines.push('');
    }

    // Sample data section
    if (sampleData.length > 0) {
      lines.push('## Sample Data');
      lines.push('');
      lines.push('| ' + Object.keys(sampleData[0]).join(' | ') + ' |');
      lines.push('| ' + Object.keys(sampleData[0]).map(() => '---').join(' | ') + ' |');

      for (const row of sampleData.slice(0, 3)) {
        const values = Object.values(row).map(val =>
          String(val).length > 50 ? String(val).substring(0, 47) + '...' : String(val)
        );
        lines.push('| ' + values.join(' | ') + ' |');
      }
      lines.push('');
    }

    lines.push(`*Generated at: ${new Date().toISOString()}*`);

    return lines.join('\n');
  }

  private getMarkdownFilePath(): string {
    return path.join(
      this.docsPath,
      'databases',
      this.tableMetadata.database,
      'tables',
      `${this.tableMetadata.name}.md`
    );
  }

  private getJSONFilePath(): string {
    return path.join(
      this.docsPath,
      'databases',
      this.tableMetadata.database,
      'schemas',
      `${this.tableMetadata.name}.json`
    );
  }
}