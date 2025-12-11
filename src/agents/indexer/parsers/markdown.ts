/**
 * Markdown Parser Helpers
 *
 * Utilities for parsing markdown documentation files including:
 * - YAML frontmatter extraction
 * - Section parsing
 * - File path parsing
 * - Content extraction helpers
 */

import matter from 'gray-matter';

// =============================================================================
// Frontmatter Extraction
// =============================================================================

/**
 * Extract YAML frontmatter from markdown content
 * Uses gray-matter library for robust parsing
 */
export function extractFrontmatter(content: string): {
  frontmatter: Record<string, unknown> | null;
  body: string;
} {
  const result = matter(content);
  return {
    frontmatter: Object.keys(result.data).length > 0 ? result.data : null,
    body: result.content,
  };
}

// =============================================================================
// Section Parsing
// =============================================================================

export interface MarkdownSection {
  heading: string;
  level: number;
  content: string;
}

/**
 * Parse markdown into sections by heading
 * Supports headings levels 1-3 (# to ###)
 */
export function parseMarkdownSections(body: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  const lines = body.split('\n');
  let currentHeading = '';
  let currentLevel = 0;
  let currentContent: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      // Save previous section
      if (currentHeading || currentContent.length > 0) {
        sections.push({
          heading: currentHeading,
          level: currentLevel,
          content: currentContent.join('\n').trim(),
        });
      }
      currentHeading = headingMatch[2];
      currentLevel = headingMatch[1].length;
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  // Don't forget the last section
  if (currentHeading || currentContent.length > 0) {
    sections.push({
      heading: currentHeading,
      level: currentLevel,
      content: currentContent.join('\n').trim(),
    });
  }

  return sections;
}

/**
 * Extract content from a specific section by heading name
 */
export function extractFromSection(
  sections: MarkdownSection[],
  headingPattern: string
): string | undefined {
  const section = sections.find(s =>
    s.heading.toLowerCase().includes(headingPattern.toLowerCase())
  );
  return section?.content?.trim();
}

/**
 * Extract the first paragraph from content (useful for descriptions)
 */
export function extractDescription(content: string): string {
  if (!content) return '';

  // Split by double newline to get paragraphs
  const paragraphs = content.split(/\n\n+/);
  const firstPara = paragraphs[0]?.trim() || '';

  // Remove markdown formatting for clean description
  return firstPara
    .replace(/\*\*([^*]+)\*\*/g, '$1')  // Bold
    .replace(/\*([^*]+)\*/g, '$1')       // Italic
    .replace(/`([^`]+)`/g, '$1')         // Code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // Links
    .trim();
}

/**
 * Extract title from markdown body (first # heading)
 */
export function extractTitle(body: string): string {
  const match = body.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || '';
}

// =============================================================================
// File Path Parsing
// =============================================================================

export interface ParsedFilePath {
  database: string;
  schema?: string;
  table?: string;
  domain?: string;
  fileType: 'table' | 'domain' | 'overview' | 'relationship' | 'unknown';
}

/**
 * Parse file path to extract database, schema, table, domain info
 *
 * Expected paths:
 * - databases/{db}/tables/{schema}.{table}.md
 * - databases/{db}/domains/{domain}.md
 * - databases/{db}/relationships/{source}_to_{target}.md
 * - databases/{db}/overview.md
 */
export function parseFilePath(filePath: string): ParsedFilePath {
  const parts = filePath.split('/');
  const dbIndex = parts.indexOf('databases');
  const database = dbIndex >= 0 && parts[dbIndex + 1] ? parts[dbIndex + 1] : 'unknown';

  // Table: databases/{db}/tables/{schema}.{table}.md
  if (filePath.includes('/tables/')) {
    const tableFile = parts[parts.length - 1].replace('.md', '');
    const [schema, ...tableParts] = tableFile.split('.');
    return {
      database,
      schema: schema || 'public',
      table: tableParts.join('.') || tableFile,
      fileType: 'table',
    };
  }

  // Domain: databases/{db}/domains/{domain}.md
  if (filePath.includes('/domains/')) {
    const domainFile = parts[parts.length - 1].replace('.md', '');
    return {
      database,
      domain: domainFile,
      fileType: 'domain',
    };
  }

  // Relationship: databases/{db}/relationships/{name}.md
  if (filePath.includes('/relationships/')) {
    return {
      database,
      fileType: 'relationship',
    };
  }

  // Overview: databases/{db}/overview.md
  if (filePath.includes('overview')) {
    return {
      database,
      fileType: 'overview',
    };
  }

  return {
    database,
    fileType: 'unknown',
  };
}

// =============================================================================
// Table Content Parsing
// =============================================================================

export interface ParsedColumnFromTable {
  name: string;
  dataType: string;
  nullable: boolean;
  description: string;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  foreignKeyTarget?: string;
  sampleValues?: string[];
}

/**
 * Parse columns from a markdown table in the "Columns" section
 *
 * Expected format:
 * | Column | Type | Nullable | Description |
 * |--------|------|----------|-------------|
 * | id     | int  | No       | Primary key |
 */
export function parseColumnsTable(content: string): ParsedColumnFromTable[] {
  const columns: ParsedColumnFromTable[] = [];

  // Find table rows (skip header and separator)
  const lines = content.split('\n').filter(line => line.trim().startsWith('|'));

  if (lines.length < 3) return columns;  // Need header, separator, and at least one row

  // Skip header and separator (first two lines)
  const dataRows = lines.slice(2);

  for (const row of dataRows) {
    const cells = row.split('|').map(c => c.trim()).filter(c => c);

    if (cells.length < 2) continue;

    const name = cells[0] || '';
    const dataType = cells[1] || '';
    const nullable = cells.length > 2 ? cells[2].toLowerCase() !== 'no' : true;
    const description = cells.length > 3 ? cells[3] : '';

    // Detect primary key from description or name
    const isPrimaryKey = description.toLowerCase().includes('primary key') ||
                         name.toLowerCase() === 'id' ||
                         name.toLowerCase().endsWith('_id');

    // Detect foreign key from description
    const fkMatch = description.match(/foreign key|references?\s+(\w+)/i);
    const isForeignKey = !!fkMatch;
    const foreignKeyTarget = fkMatch?.[1];

    columns.push({
      name,
      dataType,
      nullable,
      description,
      isPrimaryKey,
      isForeignKey,
      foreignKeyTarget,
    });
  }

  return columns;
}

/**
 * Parse foreign keys from the "Relationships" section
 */
export interface ParsedForeignKey {
  sourceColumn: string;
  targetSchema: string;
  targetTable: string;
  targetColumn: string;
}

export function parseForeignKeys(content: string): ParsedForeignKey[] {
  const foreignKeys: ParsedForeignKey[] = [];

  // Look for patterns like:
  // - customer_id -> customers.id
  // - customer_id references customers(id)
  // - FK: customer_id -> schema.table.column
  const patterns = [
    /(\w+)\s*->\s*(?:(\w+)\.)?(\w+)\.(\w+)/g,  // col -> [schema.]table.col
    /(\w+)\s+references?\s+(?:(\w+)\.)?(\w+)\((\w+)\)/gi,  // col references [schema.]table(col)
    /FK:\s*(\w+)\s*->\s*(?:(\w+)\.)?(\w+)\.(\w+)/gi,  // FK: col -> [schema.]table.col
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      foreignKeys.push({
        sourceColumn: match[1],
        targetSchema: match[2] || 'public',
        targetTable: match[3],
        targetColumn: match[4],
      });
    }
  }

  return foreignKeys;
}

/**
 * Extract primary key columns from parsed columns
 */
export function extractPrimaryKey(columns: ParsedColumnFromTable[]): string[] {
  return columns.filter(c => c.isPrimaryKey).map(c => c.name);
}

/**
 * Parse table list from a domain document section
 */
export function parseTableList(content: string): string[] {
  const tables: string[] = [];

  // Look for bullet points or links
  const bulletPattern = /^[-*]\s+(?:\[([^\]]+)\]|(\w+\.?\w*))/gm;
  let match;
  while ((match = bulletPattern.exec(content)) !== null) {
    tables.push(match[1] || match[2]);
  }

  return tables;
}

/**
 * Extract Mermaid diagram block from content
 */
export function extractMermaidBlock(content: string): string | undefined {
  const match = content.match(/```mermaid\n([\s\S]*?)```/);
  return match?.[1]?.trim();
}

// =============================================================================
// Domain Inference
// =============================================================================

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  customers: ['customer', 'user', 'account', 'profile', 'member'],
  orders: ['order', 'purchase', 'transaction', 'cart', 'checkout'],
  products: ['product', 'item', 'catalog', 'inventory', 'sku'],
  payments: ['payment', 'billing', 'invoice', 'charge', 'subscription'],
  authentication: ['auth', 'login', 'session', 'token', 'password'],
  analytics: ['metric', 'event', 'log', 'tracking', 'analytics'],
  messaging: ['message', 'notification', 'email', 'sms', 'alert'],
  content: ['content', 'post', 'article', 'comment', 'media'],
};

/**
 * Infer domain from table name when not explicitly specified
 */
export function inferDomain(tableName: string): string {
  const lowerName = tableName.toLowerCase();

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    if (keywords.some(kw => lowerName.includes(kw))) {
      return domain;
    }
  }

  return 'general';
}
