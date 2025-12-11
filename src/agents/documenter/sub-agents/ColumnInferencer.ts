/**
 * ColumnInferencer Sub-Agent
 *
 * Generates semantic description for a single database column.
 * 
 * Responsibilities:
 * - Uses LLM inference with prompt templates
 * - Accepts sample values for semantic inference
 * - Returns description string only (context quarantine - no raw data)
 * - Handles LLM failures with retry and fallback
 * - Validates description length and punctuation
 * 
 * @module ColumnInferencer
 */

import { logger } from '../../../utils/logger.js';
import { loadPromptTemplate, interpolateTemplate, mapColumnVariables } from '../../../utils/prompts.js';
import { callLLM } from '../../../utils/llm.js';
import { generateColumnFallbackDescription } from '../utils/fallback-descriptions.js';
import { ErrorCodes } from '../errors.js';
import type { AgentError } from '../types.js';

/**
 * ColumnInferencer result type - enforces context quarantine
 * Returns only description string, never raw data
 */
export type ColumnInferencerResult = string;

export class ColumnInferencer {
  private columnMetadata: {
    name: string;
    data_type: string;
    is_nullable?: string;
    column_default?: string | null;
    comment?: string | null;
  };
  private tableContext: {
    database_name: string;
    schema_name: string;
    table_name: string;
  };
  private sampleValues: any[];

  constructor(
    columnMetadata: {
      name: string;
      data_type: string;
      is_nullable?: string;
      column_default?: string | null;
      comment?: string | null;
    },
    tableContext: {
      database_name: string;
      schema_name: string;
      table_name: string;
    },
    sampleValues?: any[]
  ) {
    this.columnMetadata = columnMetadata;
    this.tableContext = tableContext;
    this.sampleValues = sampleValues || [];
  }

  /**
   * Main inference method - returns only description string (context quarantine)
   * Also returns token usage for tracking (via side effect or return object)
   * 
   * @returns Description string only - no raw sample data (context quarantine enforced)
   */
  async infer(): Promise<ColumnInferencerResult> {
    const startTime = Date.now();
    
    try {
      logger.debug(`Inferring description for column: ${this.tableContext.table_name}.${this.columnMetadata.name}`);

      // Load prompt template
      const template = await loadPromptTemplate('column-description');

      // Map template variables using utility function
      const variables = mapColumnVariables(
        {
          name: this.columnMetadata.name,
          data_type: this.columnMetadata.data_type,
          is_nullable: this.columnMetadata.is_nullable,
          column_default: this.columnMetadata.column_default,
          comment: this.columnMetadata.comment,
        },
        {
          schema_name: this.tableContext.schema_name,
          table_name: this.tableContext.table_name,
        },
        {
          database: this.tableContext.database_name,
        },
        this.sampleValues
      );

      // Interpolate template
      const prompt = interpolateTemplate(template, variables);

      // Call LLM for inference
      const { content, tokens } = await callLLM(prompt, 'claude-sonnet-4');

      // Validate and clean response
      const description = this.validateDescription(content.trim());

      const duration = Date.now() - startTime;
      logger.debug(
        `Generated description for ${this.columnMetadata.name} (${tokens.total} tokens, ${duration}ms): ${description.substring(0, 50)}...`
      );

      // Store tokens for tracking (will be handled by parent agent)
      // For now, we just return the description (context quarantine)
      return description;

    } catch (error) {
      const duration = Date.now() - startTime;
      const agentError = error as AgentError;

      // Check if it's a parse failure - use fallback immediately
      if (agentError.code === ErrorCodes.DOC_LLM_PARSE_FAILED) {
        logger.warn(
          `LLM parse failure for column ${this.columnMetadata.name}, using fallback immediately`,
          { error: agentError.message, duration }
        );
        return generateColumnFallbackDescription({
          name: this.columnMetadata.name,
          data_type: this.columnMetadata.data_type,
        });
      }

      // For other errors (after retries exhausted), use fallback
      logger.warn(
        `Failed to infer description for column ${this.columnMetadata.name} after retries, using fallback`,
        { error: agentError.message, code: agentError.code, duration }
      );

      return generateColumnFallbackDescription({
        name: this.columnMetadata.name,
        data_type: this.columnMetadata.data_type,
      });
    }
  }


  /**
   * Validate and clean LLM response
   */
  private validateDescription(description: string): string {
    // Remove any extra whitespace
    let clean = description.trim();

    // Ensure it ends with proper punctuation
    if (!clean.match(/[.!?]$/)) {
      clean += '.';
    }

    // Check length constraints
    if (clean.length > 500) {
      // Truncate at sentence boundary if possible
      const sentences = clean.split(/[.!?]/).filter(s => s.trim().length > 0);
      clean = sentences.slice(0, 2).join('. ') + '.';
    }

    // Ensure minimum length
    if (clean.length < 10) {
      return generateColumnFallbackDescription({
        name: this.columnMetadata.name,
        data_type: this.columnMetadata.data_type,
      });
    }

    return clean;
  }
}