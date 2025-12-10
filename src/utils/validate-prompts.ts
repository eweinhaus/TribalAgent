/**
 * Prompt Template Validation Utility
 *
 * Validates prompt template syntax and structure.
 */

import { validatePromptTemplates } from './prompts.js';
import { logger } from './logger.js';

export async function validatePrompts(): Promise<void> {
  try {
    await validatePromptTemplates();
    logger.info('All prompt templates are valid');
  } catch (error) {
    logger.error('Prompt template validation failed', error);
    throw error;
  }
}