/**
 * WorkUnit Generation Module
 *
 * Generates discrete WorkUnits from database analysis for parallel documentation.
 * Each WorkUnit represents a domain within a database that can be processed independently.
 *
 * @module agents/planner/generate-work-units
 */

import { computeWorkUnitHash, computeTableMetadataHash } from '../../utils/hash.js';
import type {
  WorkUnit,
  TableSpec,
  DatabaseAnalysis,
  TableMetadata,
  Relationship,
  TablePriority,
  DomainName,
} from '../../contracts/types.js';

/**
 * Extended table metadata with computed FK counts
 */
interface EnrichedTableMetadata extends TableMetadata {
  _fully_qualified_name?: string;
  _incoming_fk_count?: number;
  _outgoing_fk_count?: number;
  _metadata_hash?: string;
}

/**
 * Generate WorkUnits from database analysis results.
 */
export function generateWorkUnits(
  databases: DatabaseAnalysis[],
  tableMetadataMap: Map<string, EnrichedTableMetadata[]>,
  relationshipsMap: Map<string, Relationship[]>
): WorkUnit[] {
  const workUnits: WorkUnit[] = [];
  let priorityOrder = 1;

  for (const db of databases) {
    // Skip unreachable databases
    if (db.status !== 'reachable') continue;

    const tableMetadata = tableMetadataMap.get(db.name) || [];
    const relationships = relationshipsMap.get(db.name) || [];

    // Build a map of table name to metadata for quick lookup
    const tableMap = new Map<string, EnrichedTableMetadata>();
    for (const table of tableMetadata) {
      const name = table.name || `${table.table_schema}.${table.table_name}`;
      tableMap.set(name, table);
    }

    // Generate work unit for each domain
    for (const [domain, tableNames] of Object.entries(db.domains)) {
      const workUnitId = `${db.name}_${domain}`;

      // Get table specs for this domain
      const tables: TableSpec[] = [];
      for (const tableName of tableNames) {
        const metadata = tableMap.get(tableName);
        if (metadata) {
          tables.push(createTableSpec(db.name, metadata, domain, relationships));
        }
      }

      // Skip empty domains
      if (tables.length === 0) continue;

      // Sort tables by priority (core tables first)
      tables.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.table_name.localeCompare(b.table_name);
      });

      // Compute content hash for change detection
      const contentHash = computeWorkUnitHash(tables);

      workUnits.push({
        id: workUnitId,
        database: db.name,
        domain,
        tables,
        estimated_time_minutes: estimateWorkUnitTime(tables),
        output_directory: `databases/${db.name}/domains/${domain}`,
        priority_order: priorityOrder++,
        depends_on: [], // No dependencies between work units
        content_hash: contentHash,
      });
    }
  }

  // Sort work units by priority (core domains first)
  return sortWorkUnitsByPriority(workUnits);
}

/**
 * Create a TableSpec from table metadata.
 * Ensures ALL required fields are populated per contract.
 */
function createTableSpec(
  database: string,
  metadata: EnrichedTableMetadata,
  domain: DomainName,
  relationships: Relationship[]
): TableSpec {
  const schemaName = metadata.table_schema;
  const tableName = metadata.table_name;
  const fullName = metadata.name || `${schemaName}.${tableName}`;
  const fullyQualifiedName = `${database}.${fullName}`;

  // Get FK counts (use precomputed if available, otherwise compute)
  let incomingFkCount = metadata._incoming_fk_count ?? 0;
  let outgoingFkCount = metadata._outgoing_fk_count ?? 0;

  if (incomingFkCount === 0 && outgoingFkCount === 0) {
    // Compute from relationships
    for (const rel of relationships) {
      if (rel.target_table === fullName) incomingFkCount++;
      if (rel.source_table === fullName) outgoingFkCount++;
    }
  }

  // Get or compute metadata hash
  const metadataHash = metadata._metadata_hash || computeTableMetadataHash(metadata);

  // Determine priority
  const priority = determinePriority(domain, incomingFkCount);

  return {
    fully_qualified_name: fullyQualifiedName,
    schema_name: schemaName,
    table_name: tableName,
    domain,
    priority,
    column_count: metadata.columns?.length || 0,
    // PostgreSQL returns bigint as string, ensure it's a number
    row_count_approx: Number(metadata.row_count) || 0,
    incoming_fk_count: incomingFkCount,
    outgoing_fk_count: outgoingFkCount,
    metadata_hash: metadataHash,
    // Convert null to undefined (Zod expects string | undefined, not null)
    existing_comment: metadata.comment ?? undefined,
  };
}

/**
 * Determine table priority based on domain and relationships.
 * 1 = core tables (high centrality, core domains)
 * 2 = standard tables
 * 3 = system/auxiliary tables
 */
function determinePriority(domain: DomainName, incomingFkCount: number): TablePriority {
  // Core domains get highest priority
  const coreDomains = ['customers', 'users', 'orders', 'products'];
  if (coreDomains.includes(domain)) {
    return 1;
  }

  // System/auxiliary domains get lowest priority
  const systemDomains = ['system', 'audit', 'logs', 'migrations', 'other', 'uncategorized'];
  if (systemDomains.includes(domain)) {
    return 3;
  }

  // Tables with many incoming references are more important
  if (incomingFkCount >= 3) {
    return 1;
  }

  return 2;
}

/**
 * Estimate processing time for a work unit.
 * Based on table count and average complexity.
 */
function estimateWorkUnitTime(tables: TableSpec[]): number {
  // Base: 30 seconds per table for LLM calls
  // Additional: 10 seconds per table for sampling/processing
  const perTableSeconds = 40;
  const overheadSeconds = 30; // Setup/teardown

  const totalSeconds = overheadSeconds + tables.length * perTableSeconds;
  return Math.ceil(totalSeconds / 60); // Convert to minutes
}

/**
 * Sort work units by priority.
 * Core domains come first, then by table count (larger first for parallelism).
 */
function sortWorkUnitsByPriority(workUnits: WorkUnit[]): WorkUnit[] {
  const coreDomains = ['customers', 'users', 'orders', 'products'];

  return workUnits.sort((a, b) => {
    // Core domains first
    const aIsCore = coreDomains.includes(a.domain) ? 0 : 1;
    const bIsCore = coreDomains.includes(b.domain) ? 0 : 1;
    if (aIsCore !== bIsCore) return aIsCore - bIsCore;

    // Then by table count (larger work units first for better parallelism)
    if (a.tables.length !== b.tables.length) {
      return b.tables.length - a.tables.length;
    }

    // Finally by name for determinism
    return a.id.localeCompare(b.id);
  });
}

/**
 * Re-number priority_order after sorting.
 */
export function renumberPriorityOrder(workUnits: WorkUnit[]): void {
  for (let i = 0; i < workUnits.length; i++) {
    workUnits[i].priority_order = i + 1;
  }
}

/**
 * Calculate recommended parallelism based on work unit count.
 * Per spec: min(work_unit_count, 4)
 */
export function calculateRecommendedParallelism(workUnitCount: number): number {
  return Math.min(workUnitCount, 4);
}
