/**
 * Column Document Generation
 *
 * Generates separate column documents from parsed table documents
 * for granular search capabilities.
 */

import {
  ParsedTableDoc,
  ParsedColumnDoc,
  ParsedColumn,
  IndexableFile,
} from '../types.js';
import { logger } from '../../../utils/logger.js';

// =============================================================================
// Column Document Generation
// =============================================================================

/**
 * Generate column documents from a parsed table document
 * Each column becomes its own searchable document with parent linkage
 */
export function generateColumnDocuments(
  tableDoc: ParsedTableDoc,
  tableFilePath: string
): ParsedColumnDoc[] {
  return tableDoc.columns.map(col => ({
    docType: 'column' as const,
    database: tableDoc.database,
    schema: tableDoc.schema,
    table: tableDoc.table,
    column: col.name,
    dataType: col.dataType,
    nullable: col.nullable,
    isPrimaryKey: tableDoc.primaryKey.includes(col.name),
    isForeignKey: tableDoc.foreignKeys.some(fk => fk.sourceColumn === col.name),
    foreignKeyTarget: tableDoc.foreignKeys.find(fk => fk.sourceColumn === col.name)?.targetTable,
    description: col.description || '',
    sampleValues: col.sampleValues,
    keywords: extractKeywordsFromColumn(col, tableDoc),
    parentTablePath: tableFilePath,
    rawContent: generateColumnRawContent(col, tableDoc),
  }));
}

/**
 * Generate raw content string for column document
 * Used as fallback in createEmbeddingText and for content display
 */
export function generateColumnRawContent(col: ParsedColumn, tableDoc: ParsedTableDoc): string {
  const lines = [
    `# Column: ${tableDoc.schema}.${tableDoc.table}.${col.name}`,
    '',
    `**Table**: ${tableDoc.schema}.${tableDoc.table}`,
    `**Database**: ${tableDoc.database}`,
    `**Data Type**: ${col.dataType}`,
    `**Nullable**: ${col.nullable ? 'Yes' : 'No'}`,
  ];

  if (tableDoc.primaryKey.includes(col.name)) {
    lines.push('**Primary Key**: Yes');
  }

  const fk = tableDoc.foreignKeys.find(fk => fk.sourceColumn === col.name);
  if (fk) {
    lines.push(`**Foreign Key**: References ${fk.targetSchema}.${fk.targetTable}.${fk.targetColumn}`);
  }

  lines.push('');
  lines.push('## Description');
  lines.push(col.description || 'No description available.');

  if (col.sampleValues && col.sampleValues.length > 0) {
    lines.push('');
    lines.push('## Sample Values');
    lines.push(col.sampleValues.join(', '));
  }

  // Add domain context
  if (tableDoc.domain) {
    lines.push('');
    lines.push(`## Domain`);
    lines.push(`This column belongs to the **${tableDoc.domain}** domain.`);
  }

  return lines.join('\n');
}

/**
 * Extract keywords specific to a column
 * Includes column name parts, data type, constraints, and domain context
 */
export function extractKeywordsFromColumn(col: ParsedColumn, tableDoc: ParsedTableDoc): string[] {
  const keywords = new Set<string>();

  // Column name parts (split on underscore and camelCase)
  splitIdentifier(col.name).forEach(part => {
    keywords.add(part.toLowerCase());
    expandAbbreviations(part).forEach(exp => keywords.add(exp.toLowerCase()));
  });

  // Data type keywords
  const dataType = col.dataType.toLowerCase();
  keywords.add(dataType);

  // Add semantic data type keywords
  if (dataType.includes('int') || dataType.includes('serial') || dataType.includes('bigint')) {
    keywords.add('integer');
    keywords.add('number');
  }
  if (dataType.includes('varchar') || dataType.includes('text') || dataType.includes('char')) {
    keywords.add('string');
    keywords.add('text');
  }
  if (dataType.includes('timestamp') || dataType.includes('date') || dataType.includes('time')) {
    keywords.add('date');
    keywords.add('time');
    keywords.add('temporal');
  }
  if (dataType.includes('bool')) {
    keywords.add('boolean');
    keywords.add('flag');
  }
  if (dataType.includes('json') || dataType.includes('jsonb')) {
    keywords.add('json');
    keywords.add('object');
  }
  if (dataType.includes('uuid')) {
    keywords.add('uuid');
    keywords.add('identifier');
  }
  if (dataType.includes('numeric') || dataType.includes('decimal') || dataType.includes('real') || dataType.includes('float')) {
    keywords.add('decimal');
    keywords.add('number');
  }

  // Constraint keywords
  if (tableDoc.primaryKey.includes(col.name)) {
    keywords.add('primary key');
    keywords.add('pk');
    keywords.add('identifier');
  }
  if (tableDoc.foreignKeys.some(fk => fk.sourceColumn === col.name)) {
    keywords.add('foreign key');
    keywords.add('fk');
    keywords.add('reference');
  }

  // Parent context
  if (tableDoc.domain) {
    keywords.add(tableDoc.domain.toLowerCase());
  }

  // Table name for context
  splitIdentifier(tableDoc.table).forEach(part => {
    keywords.add(part.toLowerCase());
  });

  return Array.from(keywords).filter(k => k.length > 2);
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Split an identifier on underscores and camelCase boundaries
 */
function splitIdentifier(identifier: string): string[] {
  return identifier
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split('_')
    .filter(p => p.length > 0);
}

/**
 * Common database abbreviation expansions
 */
const ABBREVIATION_MAP: Record<string, string[]> = {
  'cust': ['customer', 'customers'],
  'usr': ['user', 'users'],
  'acct': ['account', 'accounts'],
  'txn': ['transaction', 'transactions'],
  'amt': ['amount'],
  'qty': ['quantity'],
  'dt': ['date'],
  'ts': ['timestamp'],
  'addr': ['address'],
  'desc': ['description'],
  'num': ['number'],
  'prd': ['product'],
  'ord': ['order'],
  'inv': ['invoice', 'inventory'],
  'msg': ['message'],
  'cfg': ['config', 'configuration'],
  'auth': ['authentication', 'authorization'],
  'pwd': ['password'],
  'ref': ['reference'],
  'stat': ['status', 'statistics'],
  'seq': ['sequence'],
  'idx': ['index'],
  'fk': ['foreign key'],
  'pk': ['primary key'],
  'id': ['identifier'],
  'cnt': ['count'],
  'avg': ['average'],
  'max': ['maximum'],
  'min': ['minimum'],
  'tot': ['total'],
  'bal': ['balance'],
  'chg': ['change', 'charge'],
  'cat': ['category'],
  'grp': ['group'],
  'src': ['source'],
  'tgt': ['target'],
  'dst': ['destination'],
  'loc': ['location'],
  'org': ['organization'],
  'dept': ['department'],
  'emp': ['employee'],
  'mgr': ['manager'],
};

/**
 * Expand common database abbreviations
 */
function expandAbbreviations(term: string): string[] {
  const lower = term.toLowerCase();
  return ABBREVIATION_MAP[lower] || [];
}

// =============================================================================
// File Path Helpers for Column Documents
// =============================================================================

/**
 * Find the file path for a table document with exact matching
 * CRITICAL: Must match on database + schema + table to avoid collisions
 */
export function findFilePathForTable(files: IndexableFile[], tableDoc: ParsedTableDoc): string {
  const file = files.find(f => {
    if (f.type !== 'table') return false;
    if (f.database !== tableDoc.database) return false;

    // Parse the file path to extract schema.table
    // Expected format: databases/{db}/tables/{schema}.{table}.md
    const fileName = f.path.split('/').pop()?.replace('.md', '') || '';
    const [fileSchema, ...tableNameParts] = fileName.split('.');
    const fileTable = tableNameParts.join('.');

    // Exact match on schema and table name
    return fileSchema === tableDoc.schema && fileTable === tableDoc.table;
  });

  if (!file) {
    logger.warn(`No file found for table ${tableDoc.database}.${tableDoc.schema}.${tableDoc.table}`);
  }

  return file?.path || '';
}

/**
 * Generate a virtual file path for a column document
 * Column docs don't have their own files - they're derived from table docs
 */
export function getColumnFilePath(tableFilePath: string, columnName: string): string {
  return `${tableFilePath}#${columnName}`;
}
