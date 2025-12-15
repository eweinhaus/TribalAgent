/**
 * SemanticEnricher Sub-Agent
 * 
 * Enriches table documentation with semantic metadata:
 * - semantic_roles: Table's role in the data model (header, detail, bridge, reference, etc.)
 * - typical_joins: Common join patterns for this table
 * - analysis_patterns: Common analysis use cases
 * 
 * This metadata helps AI assistants understand table purposes and suggest appropriate joins.
 */

import { logger } from '../../../utils/logger.js';
import { callLLM, getConfiguredModel } from '../../../utils/llm.js';

/**
 * Semantic role types for tables
 */
export type SemanticRole = 
  | 'transaction_header'    // Order headers, invoice headers
  | 'transaction_detail'    // Line items, detail records
  | 'master_data'           // Products, customers, employees
  | 'reference_data'        // Lookup tables, codes
  | 'bridge_table'          // Many-to-many relationships
  | 'audit_log'             // Audit trails, history tables
  | 'configuration'         // Settings, config tables
  | 'aggregate'             // Summary/rollup tables
  | 'staging'               // ETL staging tables
  | 'archive';              // Historical/archived data

/**
 * Typical join information
 */
export interface TypicalJoin {
  toTable: string;
  relationship: 'parent' | 'child' | 'sibling' | 'bridge' | 'lookup' | 'aggregate';
  joinColumn: string;
  cardinality: '1:1' | '1:N' | 'N:1' | 'N:M';
  frequency: 'always' | 'common' | 'occasional';
  businessContext?: string;
}

/**
 * Analysis pattern
 */
export interface AnalysisPattern {
  name: string;
  description: string;
  requiredJoins?: string[];
}

/**
 * Complete semantic metadata for a table
 */
export interface SemanticMetadata {
  semantic_roles: SemanticRole[];
  typical_joins: TypicalJoin[];
  analysis_patterns: AnalysisPattern[];
}

/**
 * Table context for inference
 */
interface TableContext {
  tableName: string;
  schema: string;
  description: string;
  columns: Array<{
    name: string;
    type: string;
    description?: string;
  }>;
  primaryKey: string[];
  foreignKeys: Array<{
    column_name: string;
    referenced_table: string;
    referenced_column: string;
  }>;
  rowCount?: number;
}

/**
 * SemanticEnricher class for inferring semantic metadata
 */
export class SemanticEnricher {
  private tableContext: TableContext;

  constructor(tableContext: TableContext) {
    this.tableContext = tableContext;
  }

  /**
   * Infer semantic metadata for the table
   */
  async enrich(): Promise<SemanticMetadata> {
    logger.debug(`Enriching semantic metadata for ${this.tableContext.tableName}`);

    try {
      // First try rule-based inference for common patterns
      const ruleBasedMetadata = this.inferFromRules();

      // If we have foreign keys, try LLM enrichment for more context
      if (this.tableContext.foreignKeys.length > 0 || ruleBasedMetadata.semantic_roles.length === 0) {
        const llmEnriched = await this.inferFromLLM(ruleBasedMetadata);
        return this.mergeMetadata(ruleBasedMetadata, llmEnriched);
      }

      return ruleBasedMetadata;
    } catch (error) {
      logger.warn(`Semantic enrichment failed for ${this.tableContext.tableName}, using rule-based only`, error);
      return this.inferFromRules();
    }
  }

  /**
   * Rule-based inference from table structure
   */
  private inferFromRules(): SemanticMetadata {
    const roles: SemanticRole[] = [];
    const joins: TypicalJoin[] = [];
    const patterns: AnalysisPattern[] = [];

    const tableName = this.tableContext.tableName.toLowerCase();
    const columns = this.tableContext.columns.map(c => c.name.toLowerCase());
    const fkCount = this.tableContext.foreignKeys.length;

    // =========================================================================
    // Infer semantic roles from naming patterns and structure
    // =========================================================================

    // Transaction detail patterns (line items)
    if (
      tableName.includes('_line') ||
      tableName.includes('_item') ||
      tableName.includes('_detail') ||
      (tableName.endsWith('s') && columns.some(c => c.includes('_id') && c !== tableName.replace(/s$/, '_id')))
    ) {
      roles.push('transaction_detail');
    }

    // Transaction header patterns
    if (
      (tableName.includes('order') || tableName.includes('invoice') || tableName.includes('transaction')) &&
      !tableName.includes('_line') && !tableName.includes('_item') && !tableName.includes('_detail')
    ) {
      roles.push('transaction_header');
    }

    // Master data patterns
    if (
      tableName === 'products' || tableName === 'customers' || tableName === 'employees' ||
      tableName === 'accounts' || tableName === 'contacts' || tableName === 'suppliers' ||
      tableName === 'users' || tableName === 'vendors'
    ) {
      roles.push('master_data');
    }

    // Reference/lookup data
    if (
      tableName.endsWith('_types') || tableName.endsWith('_codes') || tableName.endsWith('_status') ||
      tableName.endsWith('_categories') || tableName.includes('lookup') || tableName.includes('reference')
    ) {
      roles.push('reference_data');
    }

    // Bridge tables (many-to-many)
    if (
      (tableName.includes('_') && fkCount >= 2 && this.tableContext.columns.length <= 5) ||
      tableName.endsWith('_map') || tableName.endsWith('_mapping') || tableName.endsWith('_link')
    ) {
      roles.push('bridge_table');
    }

    // Audit/history tables
    if (
      tableName.includes('_log') || tableName.includes('_history') || tableName.includes('_audit') ||
      tableName.includes('_archive')
    ) {
      roles.push('audit_log');
    }

    // Configuration tables
    if (
      tableName.includes('config') || tableName.includes('setting') || tableName.includes('preference')
    ) {
      roles.push('configuration');
    }

    // Default to master_data if no role identified and has common master data columns
    if (roles.length === 0) {
      if (columns.some(c => c === 'name' || c.endsWith('_name'))) {
        roles.push('master_data');
      }
    }

    // =========================================================================
    // Infer typical joins from foreign keys
    // =========================================================================

    for (const fk of this.tableContext.foreignKeys) {
      const refTableParts = fk.referenced_table.split('.');
      const refTable = refTableParts[refTableParts.length - 1];
      
      // Determine relationship type
      let relationship: TypicalJoin['relationship'] = 'lookup';
      let cardinality: TypicalJoin['cardinality'] = 'N:1';
      
      if (roles.includes('transaction_detail') && refTable.includes('order')) {
        relationship = 'parent';
      } else if (fk.column_name.endsWith('_id')) {
        relationship = 'lookup';
      }

      joins.push({
        toTable: refTable,
        relationship,
        joinColumn: fk.column_name,
        cardinality,
        frequency: 'common',
      });
    }

    // =========================================================================
    // Infer analysis patterns from table type
    // =========================================================================

    if (roles.includes('transaction_detail')) {
      patterns.push({
        name: 'revenue_analysis',
        description: 'Analyze revenue by product, customer, or time period',
        requiredJoins: joins.filter(j => j.relationship === 'parent').map(j => j.toTable),
      });
    }

    if (roles.includes('transaction_header')) {
      patterns.push({
        name: 'order_metrics',
        description: 'Calculate order totals, averages, and trends',
      });
    }

    if (roles.includes('master_data')) {
      patterns.push({
        name: 'entity_summary',
        description: `Aggregate ${tableName} data and related transactions`,
      });
    }

    return {
      semantic_roles: roles,
      typical_joins: joins,
      analysis_patterns: patterns,
    };
  }

  /**
   * LLM-based enrichment for more nuanced inference
   */
  private async inferFromLLM(ruleBasedMetadata: SemanticMetadata): Promise<Partial<SemanticMetadata>> {
    const model = await getConfiguredModel();
    
    const prompt = this.buildEnrichmentPrompt(ruleBasedMetadata);
    
    try {
      const { content } = await callLLM(prompt, model, { maxTokens: 800 });
      return this.parseEnrichmentResponse(content);
    } catch (error) {
      logger.warn(`LLM enrichment failed for ${this.tableContext.tableName}`);
      return {};
    }
  }

  /**
   * Build prompt for LLM enrichment
   */
  private buildEnrichmentPrompt(ruleBasedMetadata: SemanticMetadata): string {
    const fkSummary = this.tableContext.foreignKeys
      .map(fk => `- ${fk.column_name} → ${fk.referenced_table}.${fk.referenced_column}`)
      .join('\n');

    const columnSummary = this.tableContext.columns
      .slice(0, 15)
      .map(c => `- ${c.name}: ${c.type}`)
      .join('\n');

    return `Analyze this database table and provide semantic metadata.

Table: ${this.tableContext.schema}.${this.tableContext.tableName}
Description: ${this.tableContext.description || 'Not available'}

Columns:
${columnSummary}
${this.tableContext.columns.length > 15 ? `... and ${this.tableContext.columns.length - 15} more columns` : ''}

Foreign Keys:
${fkSummary || 'None'}

Primary Key: ${this.tableContext.primaryKey.join(', ') || 'Unknown'}

Current inferred roles: ${ruleBasedMetadata.semantic_roles.join(', ') || 'None'}

Please provide:
1. SEMANTIC_ROLES: One or more roles from: transaction_header, transaction_detail, master_data, reference_data, bridge_table, audit_log, configuration, aggregate
2. ANALYSIS_PATTERNS: 2-3 common business analysis patterns this table supports

Format your response as:
SEMANTIC_ROLES: role1, role2
ANALYSIS_PATTERNS:
- pattern_name: description
- pattern_name: description`;
  }

  /**
   * Parse LLM response into metadata
   */
  private parseEnrichmentResponse(content: string): Partial<SemanticMetadata> {
    const result: Partial<SemanticMetadata> = {};

    // Parse semantic roles
    const rolesMatch = content.match(/SEMANTIC_ROLES:\s*(.+?)(?=\n|ANALYSIS)/is);
    if (rolesMatch) {
      const rolesStr = rolesMatch[1].trim();
      const validRoles: SemanticRole[] = [
        'transaction_header', 'transaction_detail', 'master_data', 'reference_data',
        'bridge_table', 'audit_log', 'configuration', 'aggregate', 'staging', 'archive'
      ];
      
      result.semantic_roles = rolesStr
        .split(/[,\s]+/)
        .map(r => r.trim().toLowerCase().replace(/\s+/g, '_') as SemanticRole)
        .filter(r => validRoles.includes(r));
    }

    // Parse analysis patterns
    const patternsMatch = content.match(/ANALYSIS_PATTERNS:([\s\S]*?)(?=$)/i);
    if (patternsMatch) {
      const patternsStr = patternsMatch[1].trim();
      const patternLines = patternsStr.split('\n').filter(l => l.trim().startsWith('-'));
      
      result.analysis_patterns = patternLines.map(line => {
        const parts = line.replace(/^-\s*/, '').split(':');
        return {
          name: parts[0]?.trim().toLowerCase().replace(/\s+/g, '_') || 'analysis',
          description: parts[1]?.trim() || parts[0]?.trim() || 'Data analysis',
        };
      });
    }

    return result;
  }

  /**
   * Merge rule-based and LLM-enriched metadata
   */
  private mergeMetadata(
    ruleBased: SemanticMetadata,
    llmEnriched: Partial<SemanticMetadata>
  ): SemanticMetadata {
    return {
      semantic_roles: [
        ...new Set([
          ...ruleBased.semantic_roles,
          ...(llmEnriched.semantic_roles || []),
        ])
      ],
      typical_joins: ruleBased.typical_joins, // Keep rule-based joins (more accurate)
      analysis_patterns: [
        ...ruleBased.analysis_patterns,
        ...(llmEnriched.analysis_patterns || []).filter(
          p => !ruleBased.analysis_patterns.some(rp => rp.name === p.name)
        ),
      ],
    };
  }
}

/**
 * Create semantic metadata for a table
 * 
 * @param tableContext Table context information
 * @returns Semantic metadata
 */
export async function enrichTableSemantics(tableContext: TableContext): Promise<SemanticMetadata> {
  const enricher = new SemanticEnricher(tableContext);
  return enricher.enrich();
}

