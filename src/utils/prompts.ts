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
 */
function extractVariables(content: string): string[] {
  const variableRegex = /\{\{([^}]+)\}\}/g;
  const variables = new Set<string>();

  let match;
  while ((match = variableRegex.exec(content)) !== null) {
    variables.add(match[1].trim());
  }

  return Array.from(variables);
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