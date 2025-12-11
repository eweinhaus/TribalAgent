/**
 * Document Parsers
 *
 * Parses different document types from the Documenter output:
 * - Table documents
 * - Domain documents
 * - Overview documents
 * - Relationship documents
 */

import { promises as fs } from 'fs';
import path from 'path';
import {
  ParsedTableDoc,
  ParsedDomainDoc,
  ParsedOverviewDoc,
  ParsedRelationshipDoc,
  ParsedDocument,
  IndexableFile,
  IndexerError,
  ForeignKeyInfo,
} from '../types.js';
import {
  extractFrontmatter,
  parseMarkdownSections,
  parseFilePath,
  extractFromSection,
  extractDescription,
  extractTitle,
  parseColumnsTable,
  parseForeignKeys,
  extractPrimaryKey,
  parseTableList,
  extractMermaidBlock,
  inferDomain,
} from './markdown.js';
import { logger } from '../../../utils/logger.js';

// =============================================================================
// Main Document Parser Dispatcher
// =============================================================================

/**
 * Main document parsing dispatcher
 * Routes to the appropriate parser based on file type from manifest
 */
export async function parseDocument(file: IndexableFile): Promise<ParsedDocument> {
  const filePath = path.join(process.cwd(), 'docs', file.path);
  let content: string;

  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    throw new IndexerError(
      'IDX_FILE_NOT_FOUND',
      `Failed to read file: ${file.path}`,
      true,
      { path: file.path, error: String(error) }
    );
  }

  try {
    switch (file.type) {
      case 'table':
        return parseTableDocument(file.path, content);

      case 'domain':
        return parseDomainDocument(file.path, content);

      case 'overview':
        return parseOverviewDocument(file.path, content);

      case 'relationship':
        return parseRelationshipDocument(file.path, content);

      default:
        throw new IndexerError(
          'IDX_PARSE_FAILED',
          `Unknown document type: ${file.type}`,
          true,
          { path: file.path, type: file.type }
        );
    }
  } catch (error) {
    if (error instanceof IndexerError) throw error;

    throw new IndexerError(
      'IDX_PARSE_FAILED',
      `Failed to parse ${file.path}: ${error instanceof Error ? error.message : String(error)}`,
      true,
      { path: file.path }
    );
  }
}

// =============================================================================
// Table Document Parser
// =============================================================================

/**
 * Parse a table documentation file
 */
export function parseTableDocument(filePath: string, content: string): ParsedTableDoc {
  // Extract YAML frontmatter if present
  const { frontmatter, body } = extractFrontmatter(content);

  // Parse markdown sections
  const sections = parseMarkdownSections(body);

  // Extract from file path: databases/{db}/tables/{schema}.{table}.md
  const pathParts = parseFilePath(filePath);

  // Extract columns from the "Columns" section table
  const columnsSection = sections.find(s =>
    s.heading.toLowerCase().includes('column')
  );
  const parsedColumns = columnsSection ? parseColumnsTable(columnsSection.content) : [];

  // Convert to the expected format
  const columns = parsedColumns.map(col => ({
    name: col.name,
    dataType: col.dataType,
    nullable: col.nullable,
    description: col.description,
    sampleValues: col.sampleValues,
  }));

  // Extract foreign keys from "Relationships" section
  const relSection = sections.find(s =>
    s.heading.toLowerCase().includes('relationship') ||
    s.heading.toLowerCase().includes('foreign key')
  );
  const parsedFKs = relSection ? parseForeignKeys(relSection.content) : [];
  const foreignKeys: ForeignKeyInfo[] = parsedFKs.map(fk => ({
    sourceColumn: fk.sourceColumn,
    targetSchema: fk.targetSchema,
    targetTable: fk.targetTable,
    targetColumn: fk.targetColumn,
  }));

  // Also check columns for FK references
  for (const col of parsedColumns) {
    if (col.isForeignKey && col.foreignKeyTarget && !foreignKeys.some(fk => fk.sourceColumn === col.name)) {
      foreignKeys.push({
        sourceColumn: col.name,
        targetSchema: 'public',
        targetTable: col.foreignKeyTarget,
        targetColumn: 'id',  // Assume id as default
      });
    }
  }

  // Extract description from overview
  const overviewSection = sections.find(s =>
    s.heading.toLowerCase().includes('overview') ||
    s.heading.toLowerCase().includes('description')
  );
  const description = overviewSection
    ? extractDescription(overviewSection.content)
    : extractDescription(body);

  // Extract primary key
  const primaryKey = extractPrimaryKey(parsedColumns);

  // Get row count from frontmatter
  const rowCount = typeof frontmatter?.row_count === 'number' ? frontmatter.row_count : 0;

  // Get domain from frontmatter or infer
  const domain = (frontmatter?.domain as string) || inferDomain(pathParts.table || '');

  logger.debug(`Parsed table doc: ${pathParts.schema}.${pathParts.table} with ${columns.length} columns`);

  return {
    docType: 'table',
    database: pathParts.database,
    schema: pathParts.schema || 'public',
    table: pathParts.table || '',
    domain,
    description,
    columns,
    primaryKey,
    foreignKeys,
    indexes: [],  // Could be extracted from "Indexes" section if present
    rowCount,
    keywords: [],  // Populated in extraction step
    rawContent: content,
  };
}

// =============================================================================
// Domain Document Parser
// =============================================================================

/**
 * Parse a domain documentation file
 */
export function parseDomainDocument(filePath: string, content: string): ParsedDomainDoc {
  // Extract YAML frontmatter
  const { frontmatter, body } = extractFrontmatter(content);

  // Parse markdown sections
  const sections = parseMarkdownSections(body);

  // Extract from file path: databases/{db}/domains/{domain}.md
  const pathParts = parseFilePath(filePath);

  // Extract description from overview section
  const overviewSection = sections.find(s =>
    s.heading.toLowerCase().includes('overview') ||
    s.heading.toLowerCase().includes('description')
  );
  const description = overviewSection
    ? extractDescription(overviewSection.content)
    : extractDescription(body);

  // Extract table list from "Tables in this Domain" section
  const tablesSection = sections.find(s =>
    s.heading.toLowerCase().includes('table')
  );
  const tables = tablesSection ? parseTableList(tablesSection.content) : [];

  // Extract ER diagram if present (Mermaid block)
  const erSection = sections.find(s =>
    s.heading.toLowerCase().includes('diagram') ||
    s.heading.toLowerCase().includes('er')
  );
  const erDiagram = erSection ? extractMermaidBlock(erSection.content) : undefined;

  logger.debug(`Parsed domain doc: ${pathParts.domain} with ${tables.length} tables`);

  return {
    docType: 'domain',
    database: pathParts.database,
    domain: (frontmatter?.domain as string) || pathParts.domain || '',
    description,
    tables,
    erDiagram,
    keywords: [],  // Populated in extraction step
    rawContent: content,
  };
}

// =============================================================================
// Overview Document Parser
// =============================================================================

/**
 * Parse an overview documentation file
 */
export function parseOverviewDocument(filePath: string, content: string): ParsedOverviewDoc {
  const { frontmatter, body } = extractFrontmatter(content);
  const sections = parseMarkdownSections(body);
  const pathParts = parseFilePath(filePath);

  // Extract title from frontmatter or first heading
  const title = (frontmatter?.title as string) || extractTitle(body) || `${pathParts.database} Overview`;

  // First section content is the description
  const description = sections[0]?.content ? extractDescription(sections[0].content) : '';

  logger.debug(`Parsed overview doc: ${title}`);

  return {
    docType: 'overview',
    database: pathParts.database,
    title,
    description,
    sections: sections.map(s => ({ heading: s.heading, content: s.content })),
    keywords: [],
    rawContent: content,
  };
}

// =============================================================================
// Relationship Document Parser
// =============================================================================

/**
 * Parse a relationship documentation file
 * Extracts source/target table info, relationship type, and join conditions
 */
export function parseRelationshipDocument(filePath: string, content: string): ParsedRelationshipDoc {
  const { frontmatter, body } = extractFrontmatter(content);
  const sections = parseMarkdownSections(body);
  const pathParts = parseFilePath(filePath);

  // Extract relationship details from frontmatter or content
  const sourceTable = (frontmatter?.source_table as string) ||
    extractFromSection(sections, 'Source Table') ||
    extractFromSection(sections, 'From') ||
    '';

  const targetTable = (frontmatter?.target_table as string) ||
    extractFromSection(sections, 'Target Table') ||
    extractFromSection(sections, 'To') ||
    '';

  const sourceColumn = (frontmatter?.source_column as string) ||
    extractFromSection(sections, 'Source Column') ||
    '';

  const targetColumn = (frontmatter?.target_column as string) ||
    extractFromSection(sections, 'Target Column') ||
    '';

  // Extract join condition from "Join Condition" or "SQL" section
  const joinSection = sections.find(s =>
    s.heading.toLowerCase().includes('join') ||
    s.heading.toLowerCase().includes('sql') ||
    s.heading.toLowerCase().includes('condition')
  );
  const joinCondition = joinSection?.content ||
    (frontmatter?.join_sql as string) ||
    '';

  // Extract description
  const descSection = sections.find(s =>
    s.heading.toLowerCase().includes('description') ||
    s.heading.toLowerCase().includes('overview')
  );
  const description = descSection
    ? extractDescription(descSection.content)
    : extractDescription(body);

  // Get relationship type
  const relationshipType = (frontmatter?.relationship_type as string) ||
    extractFromSection(sections, 'Type') ||
    'foreign_key';

  logger.debug(`Parsed relationship doc: ${sourceTable} -> ${targetTable}`);

  return {
    docType: 'relationship',
    database: pathParts.database,
    sourceSchema: (frontmatter?.source_schema as string) || pathParts.schema || 'public',
    sourceTable,
    sourceColumn,
    targetSchema: (frontmatter?.target_schema as string) || pathParts.schema || 'public',
    targetTable,
    targetColumn,
    relationshipType,
    description,
    joinCondition,
    keywords: [],  // Populated in extraction step
    rawContent: content,
  };
}

// =============================================================================
// Helper: Parse relationship from document content (for cascade deletion)
// =============================================================================

/**
 * Parse relationship details from document content
 * Used by cascade deletion to remove the corresponding relationships record
 */
export function parseRelationshipFromContent(content: string): {
  sourceSchema?: string;
  sourceTable?: string;
  sourceColumn?: string;
  targetSchema?: string;
  targetTable?: string;
  targetColumn?: string;
  relationshipType?: string;
  joinCondition?: string;
} {
  const { frontmatter, body } = extractFrontmatter(content);

  // Try frontmatter first
  if (frontmatter) {
    return {
      sourceSchema: frontmatter.source_schema as string | undefined,
      sourceTable: frontmatter.source_table as string | undefined,
      sourceColumn: frontmatter.source_column as string | undefined,
      targetSchema: frontmatter.target_schema as string | undefined,
      targetTable: frontmatter.target_table as string | undefined,
      targetColumn: frontmatter.target_column as string | undefined,
      relationshipType: frontmatter.relationship_type as string | undefined,
      joinCondition: frontmatter.join_sql as string | undefined,
    };
  }

  // Fall back to parsing markdown content
  const sections = parseMarkdownSections(body);

  return {
    sourceTable: extractFromSection(sections, 'Source Table') ||
      extractFromSection(sections, 'From'),
    targetTable: extractFromSection(sections, 'Target Table') ||
      extractFromSection(sections, 'To'),
    sourceColumn: extractFromSection(sections, 'Source Column'),
    targetColumn: extractFromSection(sections, 'Target Column'),
    relationshipType: extractFromSection(sections, 'Type') ||
      extractFromSection(sections, 'Relationship Type'),
    joinCondition: extractFromSection(sections, 'Join') ||
      extractFromSection(sections, 'SQL'),
  };
}
