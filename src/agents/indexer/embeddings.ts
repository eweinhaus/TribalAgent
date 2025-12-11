/**
 * Embedding Service Module
 *
 * Handles embedding generation using OpenAI's text-embedding-3-small model.
 * Includes batching, retry logic, and fallback handling.
 */

import {
  ParsedDocument,
  ParsedTableDoc,
  ParsedColumnDoc,
  ParsedDomainDoc,
  ParsedOverviewDoc,
  ParsedRelationshipDoc,
  IndexerError,
} from './types.js';
import { generateEmbeddings } from '../../utils/llm.js';
import { logger } from '../../utils/logger.js';

// =============================================================================
// Embedding Service Configuration
// =============================================================================

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 1000;

// =============================================================================
// Embedding Text Generation
// =============================================================================

/**
 * Create embedding text from document - handles all doc types
 * The text is optimized for semantic search over database documentation
 */
export function createEmbeddingText(doc: ParsedDocument): string {
  switch (doc.docType) {
    case 'table':
      return createTableEmbeddingText(doc);
    case 'column':
      return createColumnEmbeddingText(doc);
    case 'domain':
      return createDomainEmbeddingText(doc);
    case 'relationship':
      return createRelationshipEmbeddingText(doc);
    case 'overview':
      return createOverviewEmbeddingText(doc);
    default:
      // Fallback to rawContent if available
      return (doc as { rawContent?: string }).rawContent || '';
  }
}

/**
 * Create embedding text for table document
 */
function createTableEmbeddingText(doc: ParsedTableDoc): string {
  const parts = [
    `Table: ${doc.schema}.${doc.table}`,
    `Database: ${doc.database}`,
    `Domain: ${doc.domain}`,
    `Description: ${doc.description}`,
    `Columns: ${doc.columns.map(c => `${c.name} (${c.dataType}): ${c.description || 'no description'}`).join('; ')}`,
  ];

  if (doc.primaryKey.length > 0) {
    parts.push(`Primary Key: ${doc.primaryKey.join(', ')}`);
  }

  if (doc.foreignKeys.length > 0) {
    parts.push(`Foreign Keys: ${doc.foreignKeys.map(fk => `${fk.sourceColumn} -> ${fk.targetTable}.${fk.targetColumn}`).join('; ')}`);
  }

  if (doc.keywords.length > 0) {
    parts.push(`Keywords: ${doc.keywords.join(', ')}`);
  }

  return parts.join('\n');
}

/**
 * Create embedding text for column document
 */
function createColumnEmbeddingText(doc: ParsedColumnDoc): string {
  const parts = [
    `Column: ${doc.table}.${doc.column}`,
    `Table: ${doc.schema}.${doc.table}`,
    `Database: ${doc.database}`,
    `Type: ${doc.dataType}`,
    `Nullable: ${doc.nullable ? 'yes' : 'no'}`,
    `Description: ${doc.description}`,
  ];

  if (doc.isPrimaryKey) {
    parts.push('Primary Key: yes');
  }

  if (doc.isForeignKey && doc.foreignKeyTarget) {
    parts.push(`Foreign Key to: ${doc.foreignKeyTarget}`);
  }

  if (doc.sampleValues && doc.sampleValues.length > 0) {
    parts.push(`Sample Values: ${doc.sampleValues.slice(0, 5).join(', ')}`);
  }

  if (doc.keywords.length > 0) {
    parts.push(`Keywords: ${doc.keywords.join(', ')}`);
  }

  return parts.join('\n');
}

/**
 * Create embedding text for domain document
 */
function createDomainEmbeddingText(doc: ParsedDomainDoc): string {
  const parts = [
    `Domain: ${doc.domain}`,
    `Database: ${doc.database}`,
    `Description: ${doc.description}`,
    `Tables: ${doc.tables.join(', ')}`,
  ];

  if (doc.keywords.length > 0) {
    parts.push(`Keywords: ${doc.keywords.join(', ')}`);
  }

  return parts.join('\n');
}

/**
 * Create embedding text for relationship document
 */
function createRelationshipEmbeddingText(doc: ParsedRelationshipDoc): string {
  const parts = [
    `Relationship: ${doc.sourceTable} -> ${doc.targetTable}`,
    `Type: ${doc.relationshipType}`,
    `Source: ${doc.sourceSchema}.${doc.sourceTable}.${doc.sourceColumn}`,
    `Target: ${doc.targetSchema}.${doc.targetTable}.${doc.targetColumn}`,
    `Description: ${doc.description}`,
  ];

  if (doc.joinCondition) {
    parts.push(`Join: ${doc.joinCondition}`);
  }

  if (doc.keywords.length > 0) {
    parts.push(`Keywords: ${doc.keywords.join(', ')}`);
  }

  return parts.join('\n');
}

/**
 * Create embedding text for overview document
 */
function createOverviewEmbeddingText(doc: ParsedOverviewDoc): string {
  const parts = [
    `Overview: ${doc.title}`,
    `Database: ${doc.database}`,
    `Description: ${doc.description}`,
  ];

  // Add section summaries
  for (const section of doc.sections.slice(0, 5)) {  // Limit to first 5 sections
    if (section.heading && section.content) {
      const contentSnippet = section.content.slice(0, 200);
      parts.push(`${section.heading}: ${contentSnippet}`);
    }
  }

  if (doc.keywords.length > 0) {
    parts.push(`Keywords: ${doc.keywords.join(', ')}`);
  }

  return parts.join('\n');
}

// =============================================================================
// Embedding Generation
// =============================================================================

/**
 * Generate embeddings for multiple documents in batches
 * Uses the existing generateEmbeddings utility from utils/llm.ts
 */
export async function generateDocumentEmbeddings(
  documents: ParsedDocument[]
): Promise<Map<string, number[]>> {
  const embeddings = new Map<string, number[]>();
  const texts = documents.map(doc => createEmbeddingText(doc));
  const docIds = documents.map(doc => getDocumentId(doc));

  logger.info(`Generating embeddings for ${documents.length} documents`);

  try {
    // Use the existing generateEmbeddings function from utils/llm.ts
    // It already handles batching and rate limiting
    const results = await generateEmbeddingsWithRetry(texts);

    // Map results back to document IDs
    for (let i = 0; i < results.length; i++) {
      if (results[i]) {
        embeddings.set(docIds[i], results[i]);
      }
    }

    logger.info(`Generated ${embeddings.size} embeddings successfully`);
  } catch (error) {
    logger.error('Embedding generation failed', error);
    throw new IndexerError(
      'IDX_EMBEDDING_FAILED',
      `Embedding generation failed: ${error instanceof Error ? error.message : String(error)}`,
      true
    );
  }

  return embeddings;
}

/**
 * Generate embeddings with retry logic for transient failures
 */
async function generateEmbeddingsWithRetry(texts: string[]): Promise<number[][]> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await generateEmbeddings(texts, EMBEDDING_MODEL);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if it's a rate limit error
      const isRateLimit = lastError.message.includes('rate') ||
                         lastError.message.includes('429') ||
                         lastError.message.includes('quota');

      if (attempt < MAX_RETRIES - 1) {
        // Exponential backoff (longer for rate limits)
        const delay = isRateLimit
          ? RETRY_BACKOFF_MS * Math.pow(2, attempt + 1)
          : RETRY_BACKOFF_MS * Math.pow(2, attempt);

        logger.warn(`Embedding attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  throw lastError || new Error('Embedding generation failed after retries');
}

/**
 * Generate a unique identifier for a document
 * IMPORTANT: This must match the filePath used in populateIndex for embedding lookup
 */
function getDocumentId(doc: ParsedDocument): string {
  // Use the same identity format as populate.ts getDocumentIdentity()
  // This ensures embeddings can be looked up by file path or identity
  switch (doc.docType) {
    case 'table': {
      const tableDoc = doc as ParsedTableDoc;
      return `${tableDoc.database}.${tableDoc.schema}.${tableDoc.table}`;
    }
    case 'column': {
      const colDoc = doc as ParsedColumnDoc;
      return `${colDoc.database}.${colDoc.schema}.${colDoc.table}.${colDoc.column}`;
    }
    case 'domain': {
      const domainDoc = doc as ParsedDomainDoc;
      return `${domainDoc.database}.${domainDoc.domain}`;
    }
    case 'relationship': {
      const relDoc = doc as ParsedRelationshipDoc;
      return `${relDoc.database}.${relDoc.sourceTable}_to_${relDoc.targetTable}`;
    }
    case 'overview': {
      const overDoc = doc as ParsedOverviewDoc;
      return `${overDoc.database}.overview`;
    }
    default:
      return `unknown:${Date.now()}`;
  }
}

// =============================================================================
// Embedding Utilities
// =============================================================================

/**
 * Get the embedding model name
 */
export function getEmbeddingModel(): string {
  return EMBEDDING_MODEL;
}

/**
 * Get the embedding dimensions
 */
export function getEmbeddingDimensions(): number {
  return EMBEDDING_DIMENSIONS;
}

/**
 * Check if embeddings are available (API key configured)
 */
export function areEmbeddingsAvailable(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/**
 * Simple sleep function for delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// Summary Generation
// =============================================================================

/**
 * Generate a summary for a document (for FTS)
 */
export function generateSummary(doc: ParsedDocument): string {
  switch (doc.docType) {
    case 'table': {
      const tableDoc = doc as ParsedTableDoc;
      return `${tableDoc.table} table in ${tableDoc.schema} schema. ${tableDoc.description.slice(0, 200)}`;
    }
    case 'column': {
      const colDoc = doc as ParsedColumnDoc;
      return `${colDoc.column} column (${colDoc.dataType}) in ${colDoc.table}. ${colDoc.description.slice(0, 150)}`;
    }
    case 'domain': {
      const domainDoc = doc as ParsedDomainDoc;
      return `${domainDoc.domain} domain. ${domainDoc.description.slice(0, 200)}`;
    }
    case 'relationship': {
      const relDoc = doc as ParsedRelationshipDoc;
      return `Relationship from ${relDoc.sourceTable} to ${relDoc.targetTable}. ${relDoc.description.slice(0, 150)}`;
    }
    case 'overview': {
      const overDoc = doc as ParsedOverviewDoc;
      return `${overDoc.title}. ${overDoc.description.slice(0, 200)}`;
    }
    default:
      return '';
  }
}
