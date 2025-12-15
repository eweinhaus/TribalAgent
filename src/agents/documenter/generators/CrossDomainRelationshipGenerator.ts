/**
 * Cross-Domain Relationship Generator
 * 
 * Generates cross-domain relationship maps showing how different business
 * domains connect through foreign keys and common columns.
 * 
 * Output: docs/{database}/cross_domain_relationships.md
 */

import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../../../utils/logger.js';
import { callLLM, getConfiguredModel } from '../../../utils/llm.js';
import type { DocumentationPlan, WorkUnit } from '../types.js';

/**
 * Relationship between two tables across domains
 */
interface CrossDomainRelationship {
  sourceDomain: string;
  sourceTable: string;
  sourceColumn: string;
  targetDomain: string;
  targetTable: string;
  targetColumn: string;
  relationshipType: 'foreign_key' | 'common_column';
}

/**
 * Domain connection summary
 */
interface DomainConnection {
  fromDomain: string;
  toDomain: string;
  relationships: CrossDomainRelationship[];
  useCases: string[];
}

/**
 * Generate cross-domain relationship documentation for a database
 * 
 * @param database Database name
 * @param plan Documentation plan containing work units
 * @param docsPath Base docs path
 */
export async function generateCrossDomainRelationships(
  database: string,
  plan: DocumentationPlan,
  docsPath: string
): Promise<string | null> {
  logger.info(`Generating cross-domain relationships for ${database}`);

  try {
    // Get all work units for this database
    const dbWorkUnits = plan.work_units.filter(wu => wu.database === database);
    
    if (dbWorkUnits.length < 2) {
      logger.debug(`Skipping cross-domain relationships for ${database}: only ${dbWorkUnits.length} domain(s)`);
      return null;
    }

    // Collect all table metadata from JSON files
    const tableMetadataMap = await collectTableMetadata(database, docsPath);
    
    if (tableMetadataMap.size === 0) {
      logger.warn(`No table metadata found for ${database}`);
      return null;
    }

    // Find cross-domain relationships
    const relationships = findCrossDomainRelationships(tableMetadataMap, dbWorkUnits);
    
    if (relationships.length === 0) {
      logger.info(`No cross-domain relationships found for ${database}`);
      return null;
    }

    // Group relationships by domain pairs
    const domainConnections = groupByDomainPairs(relationships);

    // Generate use cases for each domain connection using LLM
    await enrichWithUseCases(domainConnections);

    // Generate markdown content
    const content = generateMarkdownContent(database, domainConnections, tableMetadataMap);

    // Write file
    const filePath = path.join(docsPath, 'databases', database, 'cross_domain_relationships.md');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);

    logger.info(`Generated cross-domain relationships: ${filePath}`);
    return filePath;

  } catch (error) {
    logger.error(`Failed to generate cross-domain relationships for ${database}`, error);
    return null;
  }
}

/**
 * Collect table metadata from generated JSON files
 */
async function collectTableMetadata(
  database: string,
  docsPath: string
): Promise<Map<string, TableMetadataEntry>> {
  const metadataMap = new Map<string, TableMetadataEntry>();
  
  const dbDocsPath = path.join(docsPath, 'databases', database, 'domains');
  
  try {
    const domains = await fs.readdir(dbDocsPath);
    
    for (const domain of domains) {
      const tablesPath = path.join(dbDocsPath, domain, 'tables');
      
      try {
        const files = await fs.readdir(tablesPath);
        const jsonFiles = files.filter(f => f.endsWith('.json'));
        
        for (const jsonFile of jsonFiles) {
          try {
            const content = await fs.readFile(path.join(tablesPath, jsonFile), 'utf-8');
            const tableData = JSON.parse(content);
            
            const key = `${tableData.schema}.${tableData.table}`;
            metadataMap.set(key, {
              schema: tableData.schema,
              table: tableData.table,
              domain,
              columns: tableData.columns || [],
              foreignKeys: tableData.foreign_keys || [],
              primaryKey: tableData.primary_key || [],
              description: tableData.description || '',
            });
          } catch (err) {
            // Skip invalid JSON files
          }
        }
      } catch (err) {
        // Domain folder might not have tables subfolder
      }
    }
  } catch (err) {
    logger.warn(`Could not read docs path: ${dbDocsPath}`);
  }
  
  return metadataMap;
}

interface TableMetadataEntry {
  schema: string;
  table: string;
  domain: string;
  columns: Array<{ name: string; type: string; description?: string }>;
  foreignKeys: Array<{
    column_name: string;
    referenced_table: string;
    referenced_column: string;
  }>;
  primaryKey: string[];
  description: string;
}

/**
 * Find relationships that cross domain boundaries
 */
function findCrossDomainRelationships(
  metadataMap: Map<string, TableMetadataEntry>,
  _workUnits: WorkUnit[]
): CrossDomainRelationship[] {
  const relationships: CrossDomainRelationship[] = [];
  
  // Build domain lookup
  const tableToDomain = new Map<string, string>();
  for (const [key, metadata] of metadataMap) {
    tableToDomain.set(key, metadata.domain);
    tableToDomain.set(metadata.table, metadata.domain); // Also lookup by table name only
  }

  // Find FK-based relationships across domains
  for (const [, sourceMetadata] of metadataMap) {
    const sourceDomain = sourceMetadata.domain;
    
    for (const fk of sourceMetadata.foreignKeys) {
      // Parse referenced table (could be schema.table or just table)
      const refTableParts = fk.referenced_table.split('.');
      const refTable = refTableParts[refTableParts.length - 1];
      const refSchema = refTableParts.length > 1 ? refTableParts[0] : sourceMetadata.schema;
      const refKey = `${refSchema}.${refTable}`;
      
      const targetDomain = tableToDomain.get(refKey) || tableToDomain.get(refTable);
      
      if (targetDomain && targetDomain !== sourceDomain) {
        relationships.push({
          sourceDomain,
          sourceTable: sourceMetadata.table,
          sourceColumn: fk.column_name,
          targetDomain,
          targetTable: refTable,
          targetColumn: fk.referenced_column,
          relationshipType: 'foreign_key',
        });
      }
    }
  }

  // Find common column relationships across domains
  const columnToTables = new Map<string, Array<{ table: string; domain: string; schema: string }>>();
  
  for (const [, metadata] of metadataMap) {
    for (const col of metadata.columns) {
      // Only consider likely join columns (ending with _id or being a known key pattern)
      if (col.name.endsWith('_id') || col.name === 'id') {
        if (!columnToTables.has(col.name)) {
          columnToTables.set(col.name, []);
        }
        columnToTables.get(col.name)!.push({
          table: metadata.table,
          domain: metadata.domain,
          schema: metadata.schema,
        });
      }
    }
  }

  // Find columns that appear in multiple domains (potential implicit joins)
  for (const [columnName, tables] of columnToTables) {
    const domains = new Set(tables.map(t => t.domain));
    
    if (domains.size > 1) {
      // Group tables by domain
      const tablesByDomain = new Map<string, typeof tables>();
      for (const table of tables) {
        if (!tablesByDomain.has(table.domain)) {
          tablesByDomain.set(table.domain, []);
        }
        tablesByDomain.get(table.domain)!.push(table);
      }

      // Create relationships between domains
      const domainList = Array.from(tablesByDomain.keys());
      for (let i = 0; i < domainList.length; i++) {
        for (let j = i + 1; j < domainList.length; j++) {
          const domain1 = domainList[i];
          const domain2 = domainList[j];
          
          // Only add if not already covered by FK relationship
          const tables1 = tablesByDomain.get(domain1)!;
          const tables2 = tablesByDomain.get(domain2)!;
          
          for (const t1 of tables1) {
            for (const t2 of tables2) {
              const existingFK = relationships.find(r =>
                r.sourceTable === t1.table && r.targetTable === t2.table &&
                r.sourceColumn === columnName
              );
              
              if (!existingFK) {
                relationships.push({
                  sourceDomain: domain1,
                  sourceTable: t1.table,
                  sourceColumn: columnName,
                  targetDomain: domain2,
                  targetTable: t2.table,
                  targetColumn: columnName,
                  relationshipType: 'common_column',
                });
              }
            }
          }
        }
      }
    }
  }

  return relationships;
}

/**
 * Group relationships by domain pairs
 */
function groupByDomainPairs(relationships: CrossDomainRelationship[]): DomainConnection[] {
  const pairMap = new Map<string, DomainConnection>();
  
  for (const rel of relationships) {
    // Normalize pair key (alphabetically sorted)
    const domains = [rel.sourceDomain, rel.targetDomain].sort();
    const pairKey = `${domains[0]}|${domains[1]}`;
    
    if (!pairMap.has(pairKey)) {
      pairMap.set(pairKey, {
        fromDomain: domains[0],
        toDomain: domains[1],
        relationships: [],
        useCases: [],
      });
    }
    
    pairMap.get(pairKey)!.relationships.push(rel);
  }
  
  return Array.from(pairMap.values());
}

/**
 * Use LLM to generate use cases for domain connections
 */
async function enrichWithUseCases(connections: DomainConnection[]): Promise<void> {
  const model = await getConfiguredModel();
  
  for (const conn of connections) {
    try {
      const prompt = buildUseCasePrompt(conn);
      const { content } = await callLLM(prompt, model, { maxTokens: 500 });
      
      // Parse use cases from response
      const useCases = content
        .split('\n')
        .filter(line => line.trim().startsWith('-') || line.trim().startsWith('•'))
        .map(line => line.replace(/^[-•]\s*/, '').trim())
        .filter(line => line.length > 0);
      
      conn.useCases = useCases.length > 0 ? useCases : ['Cross-domain analysis'];
    } catch (error) {
      logger.warn(`Failed to generate use cases for ${conn.fromDomain} → ${conn.toDomain}`);
      conn.useCases = ['Cross-domain analysis'];
    }
  }
}

/**
 * Build prompt for generating use cases
 */
function buildUseCasePrompt(conn: DomainConnection): string {
  const relSummary = conn.relationships
    .slice(0, 5)
    .map(r => `- ${r.sourceTable}.${r.sourceColumn} → ${r.targetTable}.${r.targetColumn}`)
    .join('\n');
  
  return `Given these table relationships between the "${conn.fromDomain}" and "${conn.toDomain}" business domains:

${relSummary}

List 2-4 common business use cases that would require joining data across these domains. Be specific and practical.

Format each use case as a bullet point starting with "-".`;
}

/**
 * Generate markdown content for cross-domain relationships
 */
function generateMarkdownContent(
  database: string,
  connections: DomainConnection[],
  _metadataMap: Map<string, TableMetadataEntry>
): string {
  const lines: string[] = [];
  
  lines.push(`# Cross-Domain Relationships`);
  lines.push('');
  lines.push(`**Database:** ${database}`);
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push('');
  lines.push('This document maps relationships between business domains, showing how tables connect across domain boundaries.');
  lines.push('');

  // Summary section
  lines.push('## Summary');
  lines.push('');
  lines.push('| From Domain | To Domain | Relationships | Primary Join Column |');
  lines.push('|-------------|-----------|---------------|---------------------|');
  
  for (const conn of connections) {
    const primaryJoin = conn.relationships[0];
    lines.push(`| ${conn.fromDomain} | ${conn.toDomain} | ${conn.relationships.length} | ${primaryJoin?.sourceColumn || 'N/A'} |`);
  }
  lines.push('');

  // Detailed sections for each domain pair
  for (const conn of connections) {
    lines.push(`## ${capitalize(conn.fromDomain)} ↔ ${capitalize(conn.toDomain)}`);
    lines.push('');
    
    // Use cases
    if (conn.useCases.length > 0) {
      lines.push('### Use Cases');
      lines.push('');
      for (const useCase of conn.useCases) {
        lines.push(`- ${useCase}`);
      }
      lines.push('');
    }

    // Relationships
    lines.push('### Relationships');
    lines.push('');
    
    // Group by relationship type
    const fkRels = conn.relationships.filter(r => r.relationshipType === 'foreign_key');
    const commonColRels = conn.relationships.filter(r => r.relationshipType === 'common_column');
    
    if (fkRels.length > 0) {
      lines.push('#### Foreign Key Relationships');
      lines.push('');
      lines.push('| Source Table | Column | Target Table | Column |');
      lines.push('|--------------|--------|--------------|--------|');
      for (const rel of fkRels) {
        lines.push(`| ${rel.sourceTable} | ${rel.sourceColumn} | ${rel.targetTable} | ${rel.targetColumn} |`);
      }
      lines.push('');
    }
    
    if (commonColRels.length > 0) {
      lines.push('#### Common Column Relationships (Implicit Joins)');
      lines.push('');
      lines.push('These tables share common columns that can be used for joins:');
      lines.push('');
      lines.push('| Table 1 | Column | Table 2 |');
      lines.push('|---------|--------|---------|');
      for (const rel of commonColRels.slice(0, 10)) { // Limit to 10
        lines.push(`| ${rel.sourceTable} | ${rel.sourceColumn} | ${rel.targetTable} |`);
      }
      if (commonColRels.length > 10) {
        lines.push(`| ... | ... | ... |`);
        lines.push(`| *(${commonColRels.length - 10} more)* | | |`);
      }
      lines.push('');
    }

    // Example SQL
    const primaryRel = fkRels[0] || commonColRels[0];
    if (primaryRel) {
      lines.push('### Example Join');
      lines.push('');
      lines.push('```sql');
      lines.push(`SELECT *`);
      lines.push(`FROM ${primaryRel.sourceTable}`);
      lines.push(`JOIN ${primaryRel.targetTable}`);
      lines.push(`  ON ${primaryRel.sourceTable}.${primaryRel.sourceColumn} = ${primaryRel.targetTable}.${primaryRel.targetColumn}`);
      lines.push('```');
      lines.push('');
    }
  }

  // Quick reference
  lines.push('---');
  lines.push('');
  lines.push('## Quick Reference: Common Join Columns');
  lines.push('');
  
  // Find most common join columns
  const columnCounts = new Map<string, number>();
  for (const conn of connections) {
    for (const rel of conn.relationships) {
      const count = columnCounts.get(rel.sourceColumn) || 0;
      columnCounts.set(rel.sourceColumn, count + 1);
    }
  }
  
  const topColumns = Array.from(columnCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  
  lines.push('| Column | Cross-Domain Occurrences |');
  lines.push('|--------|--------------------------|');
  for (const [col, count] of topColumns) {
    lines.push(`| \`${col}\` | ${count} |`);
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Capitalize first letter
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

