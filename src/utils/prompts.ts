/**
 * Prompt Template Management
 *
 * Loads and manages prompt templates from the /prompts directory.
 * Supports variable substitution and template validation.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { logger } from './logger.js';

export interface PromptTemplate {
  name: string;
  content: string;
  variables: string[];
}

/**
 * Cache for loaded templates
 */
const templateCache = new Map<string, PromptTemplate>();

/**
 * Load a prompt template by name
 */
export async function loadPromptTemplate(name: string): Promise<string> {
  try {
    // Check cache first
    if (templateCache.has(name)) {
      return templateCache.get(name)!.content;
    }

    const templatePath = path.join(process.cwd(), 'prompts', `${name}.md`);

    // Validate template exists
    await fs.access(templatePath);

    const content = await fs.readFile(templatePath, 'utf-8');

    // Basic validation
    validateTemplate(content, name);

    // Extract variables (simple regex for {{variable}} patterns)
    const variables = extractVariables(content);

    // Cache template
    const template: PromptTemplate = {
      name,
      content,
      variables,
    };

    templateCache.set(name, template);

    logger.debug(`Loaded prompt template: ${name}`);
    return content;

  } catch (error) {
    logger.error(`Failed to load prompt template: ${name}`, error);
    throw error;
  }
}

/**
 * Validate prompt template format
 */
function validateTemplate(content: string, name: string): void {
  if (!content || content.trim().length === 0) {
    throw new Error(`Template ${name} is empty`);
  }

  // Check for basic structure (should contain some instruction text)
  if (content.length < 50) {
    logger.warn(`Template ${name} seems very short (${content.length} chars)`);
  }
}

/**
 * Extract variable names from template using {{variable}} syntax
 * Handles edge cases: {{variable}}, {{ variable }}, {{variable_name}}
 */
function extractVariables(content: string): string[] {
  const variableRegex = /\{\{([^}]+)\}\}/g;
  const variables = new Set<string>();

  let match;
  while ((match = variableRegex.exec(content)) !== null) {
    // Trim whitespace and add to set
    const varName = match[1].trim();
    if (varName) {
      variables.add(varName);
    }
  }

  const variableArray = Array.from(variables);
  logger.debug(`Extracted ${variableArray.length} variables: ${variableArray.join(', ')}`);
  
  return variableArray;
}

/**
 * Interpolate variables in template
 */
export function interpolateTemplate(template: string, variables: Record<string, string>): string {
  let result = template;

  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(regex, value);
  }

  return result;
}

/**
 * Validate that all required variables are provided
 */
export function validateVariables(template: string, variables: Record<string, string>): void {
  const requiredVars = extractVariables(template);
  const providedVars = Object.keys(variables);

  const missing = requiredVars.filter(v => !providedVars.includes(v));

  if (missing.length > 0) {
    throw new Error(`Missing required variables: ${missing.join(', ')}`);
  }
}

/**
 * Validate all prompt templates on startup
 */
export async function validatePromptTemplates(): Promise<void> {
  try {
    logger.info('Validating prompt templates...');

    const promptsDir = path.join(process.cwd(), 'prompts');

    // Check directory exists
    await fs.access(promptsDir);

    // Get all .md files
    const entries = await fs.readdir(promptsDir, { withFileTypes: true });
    const templateFiles = entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
      .map(entry => entry.name);

    if (templateFiles.length === 0) {
      throw new Error('No prompt template files found in /prompts directory');
    }

    logger.info(`Found ${templateFiles.length} template files`);

    // Validate each template
    for (const file of templateFiles) {
      const name = file.replace('.md', '');
      try {
        await loadPromptTemplate(name);
        logger.info(`✓ Template ${name} validated`);
      } catch (error) {
        logger.error(`✗ Template ${name} validation failed`, error);
        throw error;
      }
    }

    logger.info('All prompt templates validated successfully');

  } catch (error) {
    logger.error('Prompt template validation failed', error);
    throw error;
  }
}

/**
 * Clear template cache (useful for testing)
 */
export function clearTemplateCache(): void {
  templateCache.clear();
  logger.debug('Template cache cleared');
}

// =============================================================================
// TEMPLATE VARIABLE MAPPING FUNCTIONS
// =============================================================================

/**
 * Map table metadata to template variables for table-description.md
 * 
 * @param tableSpec Table specification from work unit
 * @param workUnit Work unit containing database info
 * @param metadata Table metadata (columns, primary_key, foreign_keys, etc.)
 * @param samples Sample data rows
 * @returns Record of template variable names to values
 */
export function mapTableVariables(
  tableSpec: {
    schema_name: string;
    table_name: string;
    row_count_approx?: number;
    column_count?: number;
    existing_comment?: string;
  },
  workUnit: {
    database: string;
  },
  metadata: {
    columns?: Array<{ name: string }>;
    primary_key?: string[];
    foreign_keys?: Array<{ from_column: string; to_table: string; to_column: string }>;
    referenced_by?: Array<{ from_table: string; from_column: string }>;
  },
  samples: any[] = []
): Record<string, string> {
  // Format column list
  const columnList = metadata.columns
    ? metadata.columns.map((c) => c.name).join(', ')
    : '';

  // Format primary key
  const primaryKey = metadata.primary_key && metadata.primary_key.length > 0
    ? metadata.primary_key.join(', ')
    : 'None';

  // Format foreign keys (this table references others)
  const foreignKeys = metadata.foreign_keys && metadata.foreign_keys.length > 0
    ? metadata.foreign_keys
        .map((fk) => `${fk.from_column} → ${fk.to_table}.${fk.to_column}`)
        .join(', ')
    : 'None';

  // Format referenced by (other tables reference this)
  const referencedBy = metadata.referenced_by && metadata.referenced_by.length > 0
    ? metadata.referenced_by
        .map((ref) => `${ref.from_table}.${ref.from_column}`)
        .join(', ')
    : 'None';

  // Format sample row (first row as JSON-like string)
  let sampleRow = 'No sample data available';
  if (samples && samples.length > 0 && samples[0]) {
    try {
      // Format sample row as JSON-like string, truncate long values
      const formatted = JSON.stringify(samples[0], (_key, value) => {
        if (typeof value === 'string' && value.length > 100) {
          return value.substring(0, 100) + '...';
        }
        return value;
      });
      sampleRow = formatted;
    } catch (error) {
      sampleRow = 'Sample data formatting failed';
    }
  }

  return {
    database: workUnit.database || '',
    schema: tableSpec.schema_name || '',
    table: tableSpec.table_name || '',
    row_count: String(tableSpec.row_count_approx ?? 0),
    column_count: String(tableSpec.column_count ?? 0),
    column_list: columnList,
    primary_key: primaryKey,
    foreign_keys: foreignKeys,
    referenced_by: referencedBy,
    existing_comment: tableSpec.existing_comment || '',
    sample_row: sampleRow,
    // sample_values is typically used for columns, but include empty string for table template
    sample_values: '',
  };
}

/**
 * Map column metadata to template variables for column-description.md
 * 
 * @param column Column metadata
 * @param tableSpec Table specification
 * @param workUnit Work unit containing database info
 * @param sampleValues Sample values for this column
 * @returns Record of template variable names to values
 */
export function mapColumnVariables(
  column: {
    name: string;
    data_type?: string;
    is_nullable?: string;
    column_default?: string | null;
    comment?: string | null;
  },
  tableSpec: {
    schema_name: string;
    table_name: string;
  },
  workUnit: {
    database: string;
  },
  sampleValues: any[] = []
): Record<string, string> {
  // Format nullable
  const nullable = column.is_nullable === 'YES' || column.is_nullable === 'yes' ? 'YES' : 'NO';

  // Format default value
  const defaultValue = column.column_default ?? null;
  const defaultStr = defaultValue !== null ? String(defaultValue) : 'NULL';

  // Format sample values
  let sampleValuesStr = 'Sample values not available';
  if (sampleValues && sampleValues.length > 0) {
    try {
      // Take up to 10 sample values, truncate long strings
      const formatted = sampleValues
        .slice(0, 10)
        .map((val) => {
          if (val === null || val === undefined) {
            return 'null';
          }
          const str = String(val);
          return str.length > 50 ? str.substring(0, 50) + '...' : str;
        })
        .join(', ');
      sampleValuesStr = formatted || 'Sample values not available';
    } catch (error) {
      sampleValuesStr = 'Sample values formatting failed';
    }
  }

  return {
    database: workUnit.database || '',
    schema: tableSpec.schema_name || '',
    table: tableSpec.table_name || '',
    column: column.name || '',
    data_type: column.data_type || 'unknown',
    nullable: nullable,
    default: defaultStr,
    existing_comment: column.comment || '',
    sample_values: sampleValuesStr,
  };
}
