/**
 * Domain Inference Module
 *
 * Implements LLM-based domain detection using the domain-inference.md prompt template.
 * Falls back to prefix-based grouping when LLM is unavailable or fails.
 *
 * @module agents/planner/domain-inference
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { callLLM } from '../../utils/llm.js';
import { logger } from '../../utils/logger.js';
import { createPlannerError } from '../../contracts/errors.js';
import type {
  DomainName,
  TableMetadata,
  Relationship,
  PlannerConfig,
  AgentError,
} from '../../contracts/types.js';

/**
 * Result of domain inference
 */
export interface DomainInferenceResult {
  /** Domain to table name mapping */
  domains: Record<DomainName, string[]>;
  /** Whether LLM was used (vs fallback) */
  usedLLM: boolean;
  /** LLM token usage (if LLM was used) */
  tokensUsed?: number;
  /** Time spent on inference (ms) */
  durationMs: number;
  /** Any warnings during inference */
  warnings: string[];
  /** Error if inference failed (but recovered via fallback) */
  error?: AgentError;
}

/**
 * Main entry point for domain inference.
 * Uses LLM if enabled and available, falls back to prefix-based if not.
 */
export async function inferDomains(
  database: string,
  tables: TableMetadata[],
  relationships: Relationship[],
  config: PlannerConfig
): Promise<DomainInferenceResult> {
  const startTime = Date.now();

  // Skip LLM if disabled in config
  if (!config.domain_inference) {
    logger.info('Domain inference disabled, using prefix-based fallback');
    const domains = inferDomainsByPrefix(tables);
    return {
      domains,
      usedLLM: false,
      durationMs: Date.now() - startTime,
      warnings: [],
    };
  }

  // Check if OpenRouter API key is available
  if (!process.env.OPENROUTER_API_KEY) {
    logger.warn('OPENROUTER_API_KEY not set, using prefix-based fallback');
    const domains = inferDomainsByPrefix(tables);
    return {
      domains,
      usedLLM: false,
      durationMs: Date.now() - startTime,
      warnings: ['LLM unavailable - API key not set'],
    };
  }

  // Use domain_inference_batch_size for LLM batching (default: 100)
  const batchSize = config.domain_inference_batch_size ?? 100;

  // For large databases, batch the domain inference calls
  if (tables.length > batchSize) {
    return inferDomainsInBatches(database, tables, relationships, batchSize, config, startTime);
  }

  // Single LLM call for smaller databases
  return inferDomainsWithLLM(database, tables, relationships, config, startTime);
}

/**
 * Infer domains using LLM with the domain-inference.md prompt template.
 */
async function inferDomainsWithLLM(
  database: string,
  tables: TableMetadata[],
  relationships: Relationship[],
  config: PlannerConfig,
  startTime: number
): Promise<DomainInferenceResult> {
  try {
    // Load and populate the prompt template
    const prompt = await buildDomainInferencePrompt(database, tables, relationships);

    // Call LLM - env var takes priority, then config, then default
    // LLM_PRIMARY_MODEL env var allows quick switching without config changes
    const model = process.env.LLM_PRIMARY_MODEL || config.llm_model || 'claude-haiku-4.5';
    logger.info(`Calling LLM for domain inference (${tables.length} tables)`, { model });

    const response = await callLLM(prompt, model, {
      maxTokens: 4096,
      maxRetries: 2,
    });

    // Parse JSON response
    const domains = parseDomainsResponse(response.content, tables);

    // Validate coverage
    const allTableNames = tables.map((t) => t.name || `${t.table_schema}.${t.table_name}`);
    const validation = validateDomainAssignments(domains, allTableNames);

    return {
      domains: validation.domains,
      usedLLM: true,
      tokensUsed: estimateTokens(prompt) + response.tokens.total,
      durationMs: Date.now() - startTime,
      warnings: validation.warnings,
    };
  } catch (error) {
    logger.warn('LLM domain inference failed, using fallback', { error });

    const fallbackDomains = inferDomainsByPrefix(tables);
    return {
      domains: fallbackDomains,
      usedLLM: false,
      durationMs: Date.now() - startTime,
      warnings: ['LLM inference failed - using prefix-based fallback'],
      error: createPlannerError(
        'domainInferenceFailed',
        error instanceof Error ? error.message : String(error),
        { database }
      ),
    };
  }
}

/**
 * Batch domain inference for large databases.
 */
async function inferDomainsInBatches(
  database: string,
  tables: TableMetadata[],
  relationships: Relationship[],
  batchSize: number,
  config: PlannerConfig,
  startTime: number
): Promise<DomainInferenceResult> {
  const batches = chunkArray(tables, batchSize);
  const partialDomains: Record<DomainName, string[]>[] = [];
  const warnings: string[] = [];
  let totalTokens = 0;

  logger.info(`Domain inference: processing ${batches.length} batches of ${batchSize} tables`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    logger.info(`Domain inference batch ${i + 1}/${batches.length}`, { tables: batch.length });

    // Filter relationships to only those relevant to this batch
    const batchTableNames = new Set(
      batch.map((t) => t.name || `${t.table_schema}.${t.table_name}`)
    );
    const batchRelationships = relationships.filter(
      (r) => batchTableNames.has(r.source_table) || batchTableNames.has(r.target_table)
    );

    try {
      const result = await inferDomainsWithLLM(
        database,
        batch,
        batchRelationships,
        config,
        Date.now()
      );
      partialDomains.push(result.domains);
      if (result.tokensUsed) totalTokens += result.tokensUsed;
      warnings.push(...result.warnings);
    } catch (error) {
      logger.warn(`Batch ${i + 1} domain inference failed, using prefix fallback`, { error });
      partialDomains.push(inferDomainsByPrefix(batch));
      warnings.push(`Batch ${i + 1} failed - used prefix fallback`);
    }
  }

  // Merge batch results
  const mergedDomains = mergeDomainResults(partialDomains);

  // Final validation
  const allTableNames = tables.map((t) => t.name || `${t.table_schema}.${t.table_name}`);
  const validation = validateDomainAssignments(mergedDomains, allTableNames);

  return {
    domains: validation.domains,
    usedLLM: true,
    tokensUsed: totalTokens,
    durationMs: Date.now() - startTime,
    warnings: [...warnings, ...validation.warnings],
  };
}

/**
 * Build the domain inference prompt from the template.
 */
async function buildDomainInferencePrompt(
  database: string,
  tables: TableMetadata[],
  relationships: Relationship[]
): Promise<string> {
  // Try to load template, fall back to inline if not found
  let template: string;
  try {
    const templatePath = path.join(process.cwd(), 'prompts', 'domain-inference.md');
    template = await fs.readFile(templatePath, 'utf-8');
  } catch {
    // Use inline template as fallback
    template = getInlineTemplate();
  }

  // Format table list
  const tableList = tables
    .map((t) => {
      const name = t.name || `${t.table_schema}.${t.table_name}`;
      const cols = t.columns?.length || 0;
      return `- ${name} (${cols} columns)`;
    })
    .join('\n');

  // Format relationship summary
  const relationshipSummary =
    relationships.length > 0
      ? relationships
          .slice(0, 50) // Limit to avoid token overflow
          .map((r) => `${r.source_table} -> ${r.target_table}`)
          .join('\n')
      : 'No foreign key relationships detected.';

  // Substitute variables
  return template
    .replace(/\{\{database\}\}/g, database)
    .replace(/\{\{table_count\}\}/g, String(tables.length))
    .replace(/\{\{table_list\}\}/g, tableList)
    .replace(/\{\{relationship_summary\}\}/g, relationshipSummary);
}

/**
 * Parse the LLM response to extract domain mappings.
 */
function parseDomainsResponse(
  response: string,
  tables: TableMetadata[]
): Record<DomainName, string[]> {
  // Try to extract JSON from the response
  let jsonStr = response.trim();

  // Handle markdown code blocks
  if (jsonStr.startsWith('```')) {
    const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      jsonStr = match[1].trim();
    }
  }

  try {
    const parsed = JSON.parse(jsonStr);

    // Validate it's an object with string arrays
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Response is not an object');
    }

    const domains: Record<DomainName, string[]> = {};
    for (const [domain, domainTables] of Object.entries(parsed)) {
      if (!Array.isArray(domainTables)) {
        logger.warn(`Domain ${domain} has non-array value, skipping`);
        continue;
      }
      // Normalize domain name
      const normalizedDomain = domain.toLowerCase().trim();
      domains[normalizedDomain] = domainTables.map((t) => String(t));
    }

    return domains;
  } catch (error) {
    logger.warn('Failed to parse LLM response as JSON, using prefix fallback', {
      error,
      response: response.substring(0, 200),
    });
    return inferDomainsByPrefix(tables);
  }
}

/**
 * Fallback: Infer domains by table name prefix.
 * Groups tables by their first underscore-separated segment.
 */
export function inferDomainsByPrefix(tables: TableMetadata[]): Record<DomainName, string[]> {
  const domains: Record<DomainName, string[]> = {};

  for (const table of tables) {
    const tableName = table.table_name || (table.name || '').split('.').pop() || '';
    const prefix = tableName.split('_')[0] || 'other';
    const normalizedPrefix = prefix.toLowerCase();

    if (!domains[normalizedPrefix]) {
      domains[normalizedPrefix] = [];
    }

    const fullName = table.name || `${table.table_schema}.${table.table_name}`;
    domains[normalizedPrefix].push(fullName);
  }

  // Consolidate small domains into 'other'
  const minDomainSize = 2;
  const smallDomains = Object.entries(domains).filter(([_, tables]) => tables.length < minDomainSize);

  if (smallDomains.length > 0) {
    const otherTables = smallDomains.flatMap(([_, tables]) => tables);
    for (const [domain, _] of smallDomains) {
      delete domains[domain];
    }
    if (otherTables.length > 0) {
      if (!domains['other']) {
        domains['other'] = [];
      }
      domains['other'].push(...otherTables);
    }
  }

  return domains;
}

/**
 * Validate that every table is assigned to exactly one domain.
 * Catches LLM omissions and duplicate assignments.
 */
export function validateDomainAssignments(
  domains: Record<DomainName, string[]>,
  allTables: string[]
): { valid: boolean; domains: Record<DomainName, string[]>; warnings: string[] } {
  const warnings: string[] = [];
  const assignedTables = new Set<string>();
  const tableAssignments = new Map<string, string[]>();

  // Track all assignments
  for (const [domain, tables] of Object.entries(domains)) {
    for (const table of tables) {
      assignedTables.add(table);
      if (!tableAssignments.has(table)) {
        tableAssignments.set(table, []);
      }
      tableAssignments.get(table)!.push(domain);
    }
  }

  // Check for duplicate assignments (table in multiple domains)
  for (const [table, assignedDomains] of tableAssignments) {
    if (assignedDomains.length > 1) {
      warnings.push(
        `Table ${table} assigned to multiple domains: ${assignedDomains.join(', ')}. Using first: ${assignedDomains[0]}`
      );
      // Remove from all but the first domain
      for (let i = 1; i < assignedDomains.length; i++) {
        domains[assignedDomains[i]] = domains[assignedDomains[i]].filter((t) => t !== table);
      }
    }
  }

  // Check for unassigned tables
  const unassignedTables = allTables.filter((t) => !assignedTables.has(t));
  if (unassignedTables.length > 0) {
    warnings.push(
      `${unassignedTables.length} tables not assigned to any domain. Assigning to 'uncategorized'.`
    );
    logger.warn('Unassigned tables detected', {
      count: unassignedTables.length,
      tables: unassignedTables.slice(0, 10),
    });

    // Create 'uncategorized' domain for unassigned tables
    if (!domains['uncategorized']) {
      domains['uncategorized'] = [];
    }
    domains['uncategorized'].push(...unassignedTables);
  }

  // Remove empty domains
  for (const [domain, tables] of Object.entries(domains)) {
    if (tables.length === 0) {
      delete domains[domain];
    }
  }

  return {
    valid: unassignedTables.length === 0 && warnings.length === 0,
    domains,
    warnings,
  };
}

/**
 * Merge domain results from multiple batches.
 */
function mergeDomainResults(
  partials: Record<DomainName, string[]>[]
): Record<DomainName, string[]> {
  const merged: Record<DomainName, string[]> = {};

  for (const partial of partials) {
    for (const [domain, tables] of Object.entries(partial)) {
      // Normalize domain names for deterministic merging
      const normalizedDomain = domain.toLowerCase().trim();
      if (!merged[normalizedDomain]) {
        merged[normalizedDomain] = [];
      }
      merged[normalizedDomain].push(...tables);
    }
  }

  return merged;
}

/**
 * Split an array into chunks of specified size.
 */
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Rough token estimation (1 token ~ 4 characters).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Inline template fallback if file is not found.
 */
function getInlineTemplate(): string {
  return `You are a database architect. Analyze these tables and group them into logical business domains.

## Database
{{database}} ({{table_count}} tables)

## Tables
{{table_list}}

## Relationships
{{relationship_summary}}

## Instructions
1. Identify 3-10 business domains based on table naming and relationships
2. Tables that reference each other frequently belong together
3. Common domains: customers, orders, products, inventory, analytics, users, payments, system
4. Every table must be assigned to exactly one domain
5. If a table doesn't fit, assign to "system" domain
6. Use lowercase domain names

## Output Format
Return a JSON object mapping domain names to table arrays:
{
  "domain_name": ["table1", "table2"],
  "other_domain": ["table3"]
}

Provide only the JSON, no other text.`;
}
