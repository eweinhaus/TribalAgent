/**
 * TableDocumenter Sub-Agent
 *
 * Handles complete documentation of a single table.
 * 
 * Responsibilities:
 * - Extracts table metadata via getTableMetadata()
 * - Samples data from database (with 5-second timeout)
 * - Spawns ColumnInferencer sub-agents for each column (sequential processing)
 * - Generates table description using LLM
 * - Writes Markdown and JSON documentation files
 * - Returns summary object only (context quarantine - no raw data)
 * 
 * @module TableDocumenter
 */

import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../../../utils/logger.js';
import type { DatabaseConnector } from '../../../connectors/index.js';
import { loadPromptTemplate, interpolateTemplate, mapTableVariables } from '../../../utils/prompts.js';
import { callLLM } from '../../../utils/llm.js';
import { generateTableFallbackDescription } from '../utils/fallback-descriptions.js';
import { createAgentError, ErrorCodes } from '../errors.js';
import type { AgentError, WorkUnit, TableSpec } from '../types.js';

/**
 * TableDocumenter result type - enforces context quarantine
 * Returns summary object with no raw sample data
 */
export interface TableDocumenterResult {
  table: string;
  schema: string;
  description: string;
  column_count: number;
  output_files: string[];
}

export class TableDocumenter {
  private tableSpec: TableSpec;
  private workUnit: WorkUnit;
  private databaseConnector: DatabaseConnector;
  private docsPath: string;

  constructor(
    tableSpec: TableSpec,
    workUnit: WorkUnit,
    connector: DatabaseConnector
  ) {
    this.tableSpec = tableSpec;
    this.workUnit = workUnit;
    this.databaseConnector = connector;
    // Use TRIBAL_DOCS_PATH if set, otherwise default to docs/ in cwd
    this.docsPath = process.env.TRIBAL_DOCS_PATH || path.join(process.cwd(), 'docs');
  }

  /**
   * Main documentation method
   * Returns summary object (context quarantine - no raw data)
   * 
   * @returns Summary object with table description and file paths - NO raw sample data
   */
  async document(): Promise<TableDocumenterResult> {
    const schema = this.tableSpec.schema_name;
    const table = this.tableSpec.table_name;
    const fullyQualifiedName = `${schema}.${table}`;

    try {
      logger.debug(`Documenting table: ${fullyQualifiedName}`);

      // Extract table metadata via getTableMetadata()
      let tableMetadata: any;
      try {
        tableMetadata = await this.databaseConnector.getTableMetadata(schema, table);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const agentError = createAgentError(
          ErrorCodes.DOC_TABLE_EXTRACTION_FAILED,
          `Failed to extract table metadata for ${fullyQualifiedName}: ${errorMessage}`,
          'error',
          true,
          { schema, table, originalError: errorMessage }
        );
        logger.error(agentError.message, { code: agentError.code, context: agentError.context });
        throw agentError;
      }

      // Sample data from table
      const sampleData = await this.sampleTableData();

      // Spawn ColumnInferencer for each column sequentially
      const columnDescriptions = await this.documentColumns(tableMetadata.columns, sampleData);

      // Generate table description
      const tableDescriptionResult = await this.generateTableDescription(tableMetadata, sampleData);
      const tableDescription = tableDescriptionResult.description;
      // TODO: Track tokens and timing in progress system (Phase 7)

      // Generate documentation files
      // Error isolation: Markdown failure should not prevent JSON write
      let markdownPath: string | null = null;
      let jsonPath: string | null = null;

      try {
        markdownPath = await this.generateMarkdownDoc(
          tableDescription,
          columnDescriptions,
          tableMetadata,
          sampleData
        );
      } catch (error) {
        logger.error(`Markdown generation failed for ${fullyQualifiedName}, continuing with JSON`, {
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue to JSON generation
      }

      try {
        jsonPath = await this.generateJSONDoc(
          tableDescription,
          columnDescriptions,
          tableMetadata,
          sampleData
        );
      } catch (error) {
        logger.error(`JSON generation failed for ${fullyQualifiedName}`, {
          error: error instanceof Error ? error.message : String(error),
        });
        // If both failed, throw error
        if (!markdownPath) {
          throw error;
        }
      }

      // At least one file must succeed
      if (!markdownPath && !jsonPath) {
        throw new Error('Both Markdown and JSON generation failed');
      }

      logger.debug(`Completed documentation for table: ${fullyQualifiedName}`);

      // Return summary object (context quarantine - no raw data)
      const outputFiles: string[] = [];
      if (markdownPath) outputFiles.push(markdownPath);
      if (jsonPath) outputFiles.push(jsonPath);

      const summary: TableDocumenterResult = {
        table,
        schema,
        description: tableDescription,
        column_count: tableMetadata.columns?.length || 0,
        output_files: outputFiles,
      };

      // Runtime validation: ensure no raw data in summary
      if ('sample_data' in summary || 'raw_data' in summary) {
        throw new Error('Context quarantine violation: summary contains raw data');
      }

      return summary;
    } catch (error) {
      const agentError = error as AgentError;
      logger.error(`Failed to document table ${fullyQualifiedName}`, {
        code: agentError.code,
        message: agentError.message,
        context: agentError.context,
      });
      throw error;
    }
  }

  /**
   * Sample data from the table for inference
   * Implements 5-second timeout and proper error handling
   */
  private async sampleTableData(): Promise<any[]> {
    const timeoutMs = 5000; // 5 seconds
    const schema = this.tableSpec.schema_name;
    const table = this.tableSpec.table_name;

    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Query timeout'));
        }, timeoutMs);
      });

      // Create query promise
      const sampleQuery = `SELECT * FROM ${schema}.${table} LIMIT 100`;
      const queryPromise = this.databaseConnector.query(sampleQuery);

      // Race between query and timeout
      const samples = await Promise.race([queryPromise, timeoutPromise]);

      // Format sample data
      return this.formatSampleData(samples as any[]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('timeout') || errorMessage === 'Query timeout') {
        // Timeout error
        const agentError = createAgentError(
          ErrorCodes.DOC_SAMPLING_TIMEOUT,
          `Sampling query exceeded ${timeoutMs}ms timeout for table ${schema}.${table}`,
          'warning',
          true,
          { schema, table, timeout_ms: timeoutMs }
        );
        logger.warn(agentError.message, { code: agentError.code, context: agentError.context });
        return [];
      } else {
        // Other query error
        const agentError = createAgentError(
          ErrorCodes.DOC_SAMPLING_FAILED,
          `Sampling query failed for table ${schema}.${table}: ${errorMessage}`,
          'warning',
          true,
          { schema, table, originalError: errorMessage }
        );
        logger.warn(agentError.message, { code: agentError.code, context: agentError.context });
        return [];
      }
    }
  }

  /**
   * Format sample data rows for use in prompts and output files
   */
  private formatSampleData(samples: any[]): any[] {
    return samples.map(row => {
      const formatted: any = {};
      for (const [key, value] of Object.entries(row)) {
        formatted[key] = this.truncateValue(value, 100);
      }
      return formatted;
    });
  }

  /**
   * Truncate value if it exceeds max length
   */
  private truncateValue(value: any, maxLength: number): any {
    if (value === null || value === undefined) {
      return null;
    }

    const str = String(value);
    if (str.length > maxLength) {
      return str.substring(0, maxLength) + '...';
    }

    return value;
  }

  /**
   * Spawn ColumnInferencer sub-agents for each column in parallel
   * Uses batched parallelism to avoid overwhelming the LLM API
   */
  private async documentColumns(
    columns: any[],
    sampleData: any[]
  ): Promise<Record<string, string>> {
    const columnDescriptions: Record<string, string> = {};
    const schema = this.tableSpec.schema_name;
    const table = this.tableSpec.table_name;
    const database = this.workUnit.database;

    // Batch size for parallel processing (avoid overwhelming LLM API)
    const BATCH_SIZE = 5;

    // Import ColumnInferencer once
    const { ColumnInferencer } = await import('./ColumnInferencer.js');

    // Process columns in parallel batches
    for (let i = 0; i < columns.length; i += BATCH_SIZE) {
      const batch = columns.slice(i, i + BATCH_SIZE);
      
      const batchPromises = batch.map(async (column) => {
        const columnName = column.column_name || column.name;
        
        try {
          // Extract sample values for this column from sampled data
          const sampleValues = sampleData
            .map(row => row[columnName])
            .filter(val => val !== null && val !== undefined);

          const inferencer = new ColumnInferencer(
            {
              name: columnName,
              data_type: column.data_type,
              is_nullable: column.is_nullable,
              column_default: column.column_default,
              comment: column.comment,
            },
            {
              database_name: database,
              schema_name: schema,
              table_name: table,
            },
            sampleValues
          );

          const description = await inferencer.infer();
          return { columnName, description };
        } catch (error) {
          logger.warn(`Failed to document column ${columnName}`, error);
          // Use fallback description
          return { columnName, description: `Column ${columnName} of type ${column.data_type}.` };
        }
      });

      // Wait for batch to complete
      const results = await Promise.all(batchPromises);
      
      // Collect results
      for (const { columnName, description } of results) {
        columnDescriptions[columnName] = description;
      }
    }

    return columnDescriptions;
  }

  /**
   * Generate semantic description for the table
   * Returns description and token usage info for tracking
   */
  private async generateTableDescription(
    tableMetadata: any,
    sampleData: any[]
  ): Promise<{
    description: string;
    tokens: { prompt: number; completion: number; total: number };
    duration: number;
  }> {
    const startTime = Date.now();
    const schema = this.tableSpec.schema_name;
    const table = this.tableSpec.table_name;
    const fullyQualifiedName = `${schema}.${table}`;

    try {
      const template = await loadPromptTemplate('table-description');

      // Map template variables using utility function
      const variables = mapTableVariables(
        {
          schema_name: schema,
          table_name: table,
          row_count_approx: this.tableSpec.row_count_approx,
          column_count: tableMetadata.columns?.length || 0,
          existing_comment: this.tableSpec.existing_comment,
        },
        {
          database: this.workUnit.database,
        },
        {
          columns: tableMetadata.columns,
          primary_key: tableMetadata.primary_key,
          foreign_keys: tableMetadata.foreign_keys,
          referenced_by: [], // TODO: Extract from relationships if needed
        },
        sampleData
      );

      const prompt = interpolateTemplate(template, variables);
      const { content, tokens } = await callLLM(prompt, 'claude-sonnet-4');

      const duration = Date.now() - startTime;
      logger.debug(
        `Generated table description for ${fullyQualifiedName} (${tokens.total} tokens, ${duration}ms)`
      );

      return {
        description: content.trim(),
        tokens,
        duration,
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      const agentError = error as AgentError;

      // Check if it's a parse failure - use fallback immediately
      if (agentError.code === ErrorCodes.DOC_LLM_PARSE_FAILED) {
        logger.warn(
          `LLM parse failure for table ${fullyQualifiedName}, using fallback immediately`,
          { error: agentError.message, duration }
        );
        return {
          description: generateTableFallbackDescription({
            table_name: table,
            column_count: tableMetadata.columns?.length || 0,
            row_count_approx: this.tableSpec.row_count_approx,
          }),
          tokens: { prompt: 0, completion: 0, total: 0 },
          duration,
        };
      }

      // For other errors (after retries exhausted), use fallback
      logger.warn(
        `Failed to generate table description for ${fullyQualifiedName} after retries, using fallback`,
        { error: agentError.message, code: agentError.code, duration }
      );

      return {
        description: generateTableFallbackDescription({
          table_name: table,
          column_count: tableMetadata.columns?.length || 0,
          row_count_approx: this.tableSpec.row_count_approx,
        }),
        tokens: { prompt: 0, completion: 0, total: 0 },
        duration,
      };
    }
  }

  /**
   * Generate Markdown documentation file
   * Returns file path for summary
   */
  private async generateMarkdownDoc(
    tableDescription: string,
    columnDescriptions: Record<string, string>,
    tableMetadata: any,
    sampleData: any[]
  ): Promise<string> {
    const content = this.buildMarkdownContent(tableDescription, columnDescriptions, tableMetadata, sampleData);
    const filePath = this.getMarkdownFilePath();

    try {
      // Create directory structure
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      // Atomic write: write to temp file, then rename
      const tempPath = `${filePath}.tmp`;
      await fs.writeFile(tempPath, content);
      await fs.rename(tempPath, filePath);

      return filePath;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const agentError = createAgentError(
        ErrorCodes.DOC_FILE_WRITE_FAILED,
        `Failed to write Markdown file ${filePath}: ${errorMessage}`,
        'error',
        true,
        { filePath, originalError: errorMessage }
      );

      // Retry once
      try {
        await fs.writeFile(filePath, content);
        logger.warn(`Retry succeeded for Markdown file ${filePath}`);
        return filePath;
      } catch (retryError) {
        logger.error(agentError.message, { code: agentError.code, context: agentError.context });
        throw agentError;
      }
    }
  }

  /**
   * Generate JSON documentation file
   * Returns file path for summary
   */
  private async generateJSONDoc(
    tableDescription: string,
    columnDescriptions: Record<string, string>,
    tableMetadata: any,
    sampleData: any[]
  ): Promise<string> {
    const schema = this.tableSpec.schema_name;
    const table = this.tableSpec.table_name;

    const jsonData = {
      table,
      schema,
      database: this.workUnit.database,
      description: tableDescription,
      row_count: this.tableSpec.row_count_approx,
      columns: tableMetadata.columns.map((col: any) => ({
        name: col.column_name || col.name,
        type: col.data_type,
        nullable: col.is_nullable === 'YES',
        description: columnDescriptions[col.column_name || col.name] || 'No description available',
        default: col.column_default,
      })),
      primary_key: tableMetadata.primary_key,
      foreign_keys: tableMetadata.foreign_keys,
      indexes: tableMetadata.indexes,
      sample_data: sampleData.slice(0, 5), // Include up to 5 sample rows
      generated_at: new Date().toISOString(),
    };

    const filePath = this.getJSONFilePath();

    try {
      // Create directory structure
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      // Atomic write: write to temp file, then rename
      const tempPath = `${filePath}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(jsonData, null, 2));
      await fs.rename(tempPath, filePath);

      return filePath;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const agentError = createAgentError(
        ErrorCodes.DOC_FILE_WRITE_FAILED,
        `Failed to write JSON file ${filePath}: ${errorMessage}`,
        'error',
        true,
        { filePath, originalError: errorMessage }
      );

      // Retry once
      try {
        await fs.writeFile(filePath, JSON.stringify(jsonData, null, 2));
        logger.warn(`Retry succeeded for JSON file ${filePath}`);
        return filePath;
      } catch (retryError) {
        logger.error(agentError.message, { code: agentError.code, context: agentError.context });
        throw agentError;
      }
    }
  }

  // Helper methods

  /**
   * Sanitize file name by replacing invalid filesystem characters
   */
  private sanitizeFileName(name: string): string {
    // Don't lowercase - preserve case for schema/table names
    // Only replace invalid filesystem characters
    return name.replace(/[\/\\:*?"<>|]/g, '_');
  }

  /**
   * Build Markdown content for table documentation
   */
  private buildMarkdownContent(
    tableDescription: string,
    columnDescriptions: Record<string, string>,
    tableMetadata: any,
    sampleData: any[]
  ): string {
    const schema = this.tableSpec.schema_name;
    const table = this.tableSpec.table_name;
    const lines: string[] = [];

    lines.push(`# ${table}`);
    lines.push('');
    lines.push(`**Database:** ${this.workUnit.database}`);
    lines.push(`**Schema:** ${schema}`);
    lines.push(`**Description:** ${tableDescription}`);
    lines.push('');

    if (this.tableSpec.row_count_approx) {
      lines.push(`**Row Count:** ${this.tableSpec.row_count_approx.toLocaleString()}`);
      lines.push('');
    }

    // Columns section
    lines.push('## Columns');
    lines.push('');
    lines.push('| Column | Type | Nullable | Description |');
    lines.push('|--------|------|----------|-------------|');

    for (const column of tableMetadata.columns || []) {
      const columnName = column.column_name || column.name;
      const desc = columnDescriptions[columnName] || 'No description available';
      lines.push(`| ${columnName} | ${column.data_type} | ${column.is_nullable} | ${desc} |`);
    }

    lines.push('');

    // Keys section
    if (tableMetadata.primary_key && tableMetadata.primary_key.length > 0) {
      lines.push('## Primary Key');
      lines.push('');
      lines.push(`\`${tableMetadata.primary_key.join(', ')}\``);
      lines.push('');
    }

    if (tableMetadata.foreign_keys && tableMetadata.foreign_keys.length > 0) {
      lines.push('## Foreign Keys');
      lines.push('');
      for (const fk of tableMetadata.foreign_keys) {
        lines.push(`- \`${fk.column_name}\` → \`${fk.referenced_table}.${fk.referenced_column}\``);
      }
      lines.push('');
    }

    // Indexes section
    if (tableMetadata.indexes && tableMetadata.indexes.length > 0) {
      lines.push('## Indexes');
      lines.push('');
      for (const idx of tableMetadata.indexes) {
        lines.push(`- \`${idx.index_name || idx.name}\`: ${idx.index_definition || ''}`);
      }
      lines.push('');
    }

    // Sample data section
    if (sampleData.length > 0) {
      lines.push('## Sample Data');
      lines.push('');
      lines.push('| ' + Object.keys(sampleData[0]).join(' | ') + ' |');
      lines.push('| ' + Object.keys(sampleData[0]).map(() => '---').join(' | ') + ' |');

      for (const row of sampleData.slice(0, 5)) {
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

  /**
   * Get Markdown file path according to PRD specification
   * Path: docs/{work_unit.output_directory}/tables/{schema}.{table}.md
   */
  private getMarkdownFilePath(): string {
    const sanitizedSchema = this.sanitizeFileName(this.tableSpec.schema_name);
    const sanitizedTable = this.sanitizeFileName(this.tableSpec.table_name);
    return path.join(
      this.docsPath,
      this.workUnit.output_directory,
      'tables',
      `${sanitizedSchema}.${sanitizedTable}.md`
    );
  }

  /**
   * Get JSON file path according to PRD specification
   * Path: docs/{work_unit.output_directory}/tables/{schema}.{table}.json
   */
  private getJSONFilePath(): string {
    const sanitizedSchema = this.sanitizeFileName(this.tableSpec.schema_name);
    const sanitizedTable = this.sanitizeFileName(this.tableSpec.table_name);
    return path.join(
      this.docsPath,
      this.workUnit.output_directory,
      'tables',
      `${sanitizedSchema}.${sanitizedTable}.json`
    );
  }
}