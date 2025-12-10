/**
 * ColumnInferencer Sub-Agent
 *
 * Generates semantic description for a single database column.
 * Uses LLM inference with prompt templates to understand column purpose from metadata and samples.
 * Follows context quarantine - returns only the description string.
 */

import { logger } from '../../../utils/logger.js';
import { loadPromptTemplate } from '../../../utils/prompts.js';
import { callLLM } from '../../../utils/llm.js';

export class ColumnInferencer {
  private columnMetadata: any;

  constructor(columnMetadata: any) {
    this.columnMetadata = columnMetadata;
  }

  /**
   * Main inference method - returns only description string (context quarantine)
   */
  async infer(): Promise<string> {
    try {
      logger.debug(`Inferring description for column: ${this.columnMetadata.table_name}.${this.columnMetadata.name}`);

      // Load prompt template
      const template = await loadPromptTemplate('column-description');

      // Prepare template variables
      const variables = {
        database: this.columnMetadata.database_name,
        schema: this.columnMetadata.schema_name,
        table: this.columnMetadata.table_name,
        column: this.columnMetadata.name,
        data_type: this.columnMetadata.data_type,
        nullable: this.columnMetadata.is_nullable || 'NO',
        default: this.columnMetadata.column_default || 'NULL',
        existing_comment: this.columnMetadata.comment || '',
        sample_values: this.formatSampleValues(),
      };

      // Interpolate template
      const prompt = this.interpolateTemplate(template, variables);

      // Call LLM for inference
      const response = await callLLM(prompt, 'claude-sonnet-4');

      // Validate and clean response
      const description = this.validateDescription(response.trim());

      logger.debug(`Generated description for ${this.columnMetadata.name}: ${description.substring(0, 50)}...`);

      return description;

    } catch (error) {
      logger.warn(`Failed to infer description for column ${this.columnMetadata.name}`, error);

      // Fallback description
      return `Column ${this.columnMetadata.name} of type ${this.columnMetadata.data_type}.`;
    }
  }

  /**
   * Format sample values for the prompt
   */
  private formatSampleValues(): string {
    // TODO: Get actual sample values from table sampling
    // For now, return placeholder
    return 'Sample values not available';
  }

  /**
   * Interpolate template variables
   */
  private interpolateTemplate(template: string, variables: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }
    return result;
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
      return `Column ${this.columnMetadata.name} of type ${this.columnMetadata.data_type}.`;
    }

    return clean;
  }
}