/**
 * Keyword Extraction Module
 *
 * Extracts semantic keywords from parsed documents for improved search.
 * Includes identifier splitting, abbreviation expansion, and domain-specific patterns.
 */

import {
  ParsedDocument,
  ParsedTableDoc,
  ParsedDomainDoc,
  ParsedOverviewDoc,
  ParsedRelationshipDoc,
} from './types.js';

// =============================================================================
// Main Keyword Extraction
// =============================================================================

/**
 * Extract keywords based on document type
 */
export function extractKeywordsForDocument(doc: ParsedDocument): string[] {
  switch (doc.docType) {
    case 'table':
      return extractKeywordsFromTable(doc);
    case 'column':
      // Column keywords are already populated during generation
      return doc.keywords;
    case 'domain':
      return extractKeywordsFromDomain(doc);
    case 'relationship':
      return extractKeywordsFromRelationship(doc);
    case 'overview':
      return extractKeywordsFromOverview(doc);
    default:
      return [];
  }
}

// =============================================================================
// Table Keyword Extraction
// =============================================================================

/**
 * Extract keywords from a table document
 */
export function extractKeywordsFromTable(doc: ParsedTableDoc): string[] {
  const keywords = new Set<string>();

  // 1. Table name parts
  const tableNameParts = splitIdentifier(doc.table);
  tableNameParts.forEach(part => {
    keywords.add(part.toLowerCase());
    expandAbbreviations(part).forEach(exp => keywords.add(exp.toLowerCase()));
  });

  // 2. Schema name
  if (doc.schema && doc.schema !== 'public') {
    keywords.add(doc.schema.toLowerCase());
  }

  // 3. Column names
  for (const column of doc.columns) {
    const colParts = splitIdentifier(column.name);
    colParts.forEach(part => {
      keywords.add(part.toLowerCase());
      expandAbbreviations(part).forEach(exp => keywords.add(exp.toLowerCase()));
    });
  }

  // 4. Domain
  if (doc.domain) {
    keywords.add(doc.domain.toLowerCase());
    splitIdentifier(doc.domain).forEach(part => keywords.add(part.toLowerCase()));
  }

  // 5. Data patterns from sample data
  if (doc.sampleData && doc.sampleData.length > 0) {
    const patterns = detectDataPatterns(doc.sampleData);
    patterns.forEach(p => keywords.add(p));
  }

  // 6. Description terms (nouns and technical terms)
  const descTerms = extractNounsFromDescription(doc.description);
  descTerms.forEach(t => keywords.add(t.toLowerCase()));

  // 7. Foreign key targets
  for (const fk of doc.foreignKeys) {
    splitIdentifier(fk.targetTable).forEach(part => keywords.add(part.toLowerCase()));
  }

  // Filter out very short keywords
  return Array.from(keywords).filter(k => k.length > 2);
}

// =============================================================================
// Domain Keyword Extraction
// =============================================================================

/**
 * Extract keywords from a domain document
 */
export function extractKeywordsFromDomain(doc: ParsedDomainDoc): string[] {
  const keywords = new Set<string>();

  // Domain name parts
  splitIdentifier(doc.domain).forEach(part => {
    keywords.add(part.toLowerCase());
    expandAbbreviations(part).forEach(exp => keywords.add(exp.toLowerCase()));
  });

  // Table names in domain
  doc.tables.forEach(table => {
    splitIdentifier(table).forEach(part => keywords.add(part.toLowerCase()));
  });

  // Description terms
  extractNounsFromDescription(doc.description).forEach(t => keywords.add(t.toLowerCase()));

  return Array.from(keywords).filter(k => k.length > 2);
}

// =============================================================================
// Relationship Keyword Extraction
// =============================================================================

/**
 * Extract keywords from a relationship document
 */
export function extractKeywordsFromRelationship(doc: ParsedRelationshipDoc): string[] {
  const keywords = new Set<string>();

  // Source and target table names
  splitIdentifier(doc.sourceTable).forEach(part => {
    keywords.add(part.toLowerCase());
    expandAbbreviations(part).forEach(exp => keywords.add(exp.toLowerCase()));
  });
  splitIdentifier(doc.targetTable).forEach(part => {
    keywords.add(part.toLowerCase());
    expandAbbreviations(part).forEach(exp => keywords.add(exp.toLowerCase()));
  });

  // Column names
  if (doc.sourceColumn) {
    splitIdentifier(doc.sourceColumn).forEach(part => keywords.add(part.toLowerCase()));
  }
  if (doc.targetColumn) {
    splitIdentifier(doc.targetColumn).forEach(part => keywords.add(part.toLowerCase()));
  }

  // Relationship type keywords
  keywords.add(doc.relationshipType.toLowerCase());

  // Semantic keywords based on relationship type
  if (doc.relationshipType === 'foreign_key' || doc.relationshipType === 'fk') {
    keywords.add('fk');
    keywords.add('foreign key');
    keywords.add('reference');
  }
  if (doc.relationshipType === 'one_to_many') {
    keywords.add('one to many');
    keywords.add('1:n');
    keywords.add('parent child');
  }
  if (doc.relationshipType === 'many_to_many' || doc.relationshipType === 'm2m') {
    keywords.add('many to many');
    keywords.add('m:n');
    keywords.add('junction');
  }
  if (doc.relationshipType === 'one_to_one' || doc.relationshipType === '1:1') {
    keywords.add('one to one');
    keywords.add('1:1');
  }

  // Join-related keywords
  keywords.add('join');
  keywords.add('relationship');
  keywords.add('link');
  keywords.add('connection');

  // Description terms
  const descTerms = extractNounsFromDescription(doc.description);
  descTerms.forEach(t => keywords.add(t.toLowerCase()));

  return Array.from(keywords).filter(k => k.length > 2);
}

// =============================================================================
// Overview Keyword Extraction
// =============================================================================

/**
 * Extract keywords from an overview document
 */
export function extractKeywordsFromOverview(doc: ParsedOverviewDoc): string[] {
  const keywords = new Set<string>();

  // Title words
  doc.title.split(/\s+/).forEach(word => {
    const cleaned = word.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (cleaned.length > 2) keywords.add(cleaned);
  });

  // Description terms
  extractNounsFromDescription(doc.description).forEach(t => keywords.add(t.toLowerCase()));

  // Section headings
  for (const section of doc.sections) {
    section.heading.split(/\s+/).forEach(word => {
      const cleaned = word.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      if (cleaned.length > 2) keywords.add(cleaned);
    });
  }

  return Array.from(keywords).filter(k => k.length > 2);
}

// =============================================================================
// Identifier Splitting
// =============================================================================

/**
 * Split an identifier on underscores and camelCase boundaries
 */
export function splitIdentifier(identifier: string): string[] {
  return identifier
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split('_')
    .filter(p => p.length > 0);
}

// =============================================================================
// Abbreviation Expansion
// =============================================================================

/**
 * Common database abbreviation expansions
 */
export const ABBREVIATION_MAP: Record<string, string[]> = {
  // Entity abbreviations
  'cust': ['customer', 'customers'],
  'usr': ['user', 'users'],
  'acct': ['account', 'accounts'],
  'txn': ['transaction', 'transactions'],
  'prd': ['product', 'products'],
  'ord': ['order', 'orders'],
  'inv': ['invoice', 'inventory'],
  'emp': ['employee', 'employees'],
  'mgr': ['manager', 'managers'],
  'dept': ['department', 'departments'],
  'org': ['organization', 'organizations'],
  'cat': ['category', 'categories'],
  'grp': ['group', 'groups'],

  // Field abbreviations
  'amt': ['amount'],
  'qty': ['quantity'],
  'dt': ['date'],
  'ts': ['timestamp'],
  'addr': ['address'],
  'desc': ['description'],
  'num': ['number'],
  'msg': ['message'],
  'cfg': ['config', 'configuration'],
  'pwd': ['password'],
  'ref': ['reference'],
  'stat': ['status', 'statistics'],
  'seq': ['sequence'],
  'loc': ['location'],
  'src': ['source'],
  'tgt': ['target'],
  'dst': ['destination'],
  'bal': ['balance'],
  'chg': ['change', 'charge'],

  // Technical abbreviations
  'auth': ['authentication', 'authorization'],
  'idx': ['index'],
  'fk': ['foreign key'],
  'pk': ['primary key'],
  'id': ['identifier', 'identity'],
  'cnt': ['count'],
  'avg': ['average'],
  'max': ['maximum'],
  'min': ['minimum'],
  'tot': ['total'],
  'calc': ['calculated', 'calculation'],
  'proc': ['process', 'procedure'],
  'func': ['function'],
  'tmp': ['temporary'],
  'sys': ['system'],
  'app': ['application'],
  'db': ['database'],
  'tbl': ['table'],
  'col': ['column'],
  'rec': ['record'],
  'val': ['value', 'valid', 'validation'],
  'err': ['error'],
  'log': ['logging'],
  'ver': ['version'],
  'rev': ['revision'],
  'doc': ['document'],
  'img': ['image'],
  'url': ['uniform resource locator', 'link'],
  'api': ['application programming interface'],
};

/**
 * Expand common database abbreviations
 */
export function expandAbbreviations(term: string): string[] {
  const lower = term.toLowerCase();
  return ABBREVIATION_MAP[lower] || [];
}

// =============================================================================
// Data Pattern Detection
// =============================================================================

/**
 * Detect data patterns from sample data
 * Returns semantic keywords based on detected patterns
 */
export function detectDataPatterns(sampleData: Record<string, unknown>[]): string[] {
  const patterns: string[] = [];

  if (sampleData.length === 0) return patterns;

  // Analyze first sample to detect patterns
  const sample = sampleData[0];

  for (const [key, value] of Object.entries(sample)) {
    if (typeof value === 'string') {
      // Email pattern
      if (value.includes('@') && value.includes('.')) {
        patterns.push('email');
      }

      // URL pattern
      if (value.startsWith('http://') || value.startsWith('https://')) {
        patterns.push('url');
        patterns.push('link');
      }

      // Phone pattern
      if (/^\+?\d{10,15}$/.test(value.replace(/[-\s()]/g, ''))) {
        patterns.push('phone');
        patterns.push('telephone');
      }

      // UUID pattern
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
        patterns.push('uuid');
        patterns.push('unique identifier');
      }

      // Currency pattern
      if (/^\$[\d,]+(\.\d{2})?$/.test(value) || /^[\d,]+(\.\d{2})?\s*(USD|EUR|GBP)$/i.test(value)) {
        patterns.push('currency');
        patterns.push('money');
        patterns.push('price');
      }

      // Date pattern
      if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
        patterns.push('date');
        patterns.push('temporal');
      }

      // JSON pattern
      if (value.startsWith('{') || value.startsWith('[')) {
        try {
          JSON.parse(value);
          patterns.push('json');
          patterns.push('structured data');
        } catch {
          // Not valid JSON
        }
      }
    }

    // Numeric patterns based on key name
    const keyLower = key.toLowerCase();
    if (typeof value === 'number') {
      if (keyLower.includes('price') || keyLower.includes('cost') || keyLower.includes('amount')) {
        patterns.push('monetary');
      }
      if (keyLower.includes('percent') || keyLower.includes('rate')) {
        patterns.push('percentage');
      }
      if (keyLower.includes('count') || keyLower.includes('qty') || keyLower.includes('quantity')) {
        patterns.push('quantity');
      }
    }
  }

  return [...new Set(patterns)];
}

// =============================================================================
// Description Analysis
// =============================================================================

/**
 * Database-related terms to always include as keywords
 */
const DB_TERMS = [
  'table', 'column', 'row', 'key', 'index', 'foreign', 'primary', 'unique',
  'constraint', 'reference', 'relationship', 'join', 'query', 'data',
  'record', 'field', 'entity', 'attribute', 'schema', 'database',
];

/**
 * Extract nouns from description text for keyword generation
 * Uses a simple heuristic: database terms and capitalized words
 */
export function extractNounsFromDescription(description: string): string[] {
  if (!description) return [];

  const terms: string[] = [];
  const words = description.split(/\s+/);

  for (const word of words) {
    const cleaned = word.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
    if (cleaned.length > 2) {
      // Include database terms
      if (DB_TERMS.includes(cleaned)) {
        terms.push(cleaned);
      }
      // Include capitalized words (likely proper nouns/entities)
      if (word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase()) {
        terms.push(cleaned);
      }
    }
  }

  return [...new Set(terms)];
}
