/**
 * Validation Functions
 *
 * Validation functions for plan output and inter-agent contracts as specified
 * in agent-contracts-execution.md §4.
 *
 * @module contracts/validators
 */

import { z } from 'zod';
import type {
  DocumentationPlan,
  WorkUnit,
  TableSpec,
  ValidationResult,
  ValidationError,
} from './types.js';

// =============================================================================
// ZOD SCHEMAS
// =============================================================================

/**
 * AgentError schema
 */
const AgentErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.enum(['warning', 'error', 'fatal']),
  timestamp: z.string(),
  context: z.record(z.unknown()).optional(),
  recoverable: z.boolean(),
});

/**
 * TableSpec schema - all fields required per contract
 */
const TableSpecSchema = z.object({
  fully_qualified_name: z.string().min(1),
  schema_name: z.string().min(1),
  table_name: z.string().min(1),
  domain: z.string().min(1),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  column_count: z.number().int().min(0),
  row_count_approx: z.number().int().min(0),
  incoming_fk_count: z.number().int().min(0),
  outgoing_fk_count: z.number().int().min(0),
  metadata_hash: z.string().length(64),
  existing_comment: z.string().optional(),
});

/**
 * WorkUnit schema
 */
const WorkUnitSchema = z.object({
  id: z.string().min(1),
  database: z.string().min(1),
  domain: z.string().min(1),
  tables: z.array(TableSpecSchema).min(1),
  estimated_time_minutes: z.number().min(0),
  output_directory: z.string().min(1),
  priority_order: z.number().int().min(1),
  depends_on: z.array(z.string()),
  content_hash: z.string().length(64),
});

/**
 * DatabaseAnalysis schema
 */
const DatabaseAnalysisSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['postgres', 'snowflake']),
  status: z.enum(['reachable', 'unreachable']),
  connection_error: AgentErrorSchema.optional(),
  table_count: z.number().int().min(0),
  schema_count: z.number().int().min(0),
  estimated_time_minutes: z.number().min(0),
  domains: z.record(z.array(z.string())),
  schema_hash: z.string(),
});

/**
 * PlanSummary schema
 */
const PlanSummarySchema = z.object({
  total_databases: z.number().int().min(0),
  reachable_databases: z.number().int().min(0),
  total_tables: z.number().int().min(0),
  total_work_units: z.number().int().min(0),
  domain_count: z.number().int().min(0),
  total_estimated_minutes: z.number().min(0),
  recommended_parallelism: z.number().int().min(1),
});

/**
 * DocumentationPlan schema - root schema for plan validation
 */
const DocumentationPlanSchema = z.object({
  schema_version: z.literal('1.0'),
  generated_at: z.string(),
  config_hash: z.string().length(64),
  complexity: z.enum(['simple', 'moderate', 'complex']),
  databases: z.array(DatabaseAnalysisSchema),
  work_units: z.array(WorkUnitSchema),
  summary: PlanSummarySchema,
  errors: z.array(AgentErrorSchema),
});

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

/**
 * Validate a DocumentationPlan against the contract schema.
 * Returns a ValidationResult with either the validated plan or errors.
 */
export function validatePlan(plan: unknown): ValidationResult<DocumentationPlan> {
  // Step 1: Zod schema validation
  const result = DocumentationPlanSchema.safeParse(plan);

  if (!result.success) {
    const errors: ValidationError[] = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    return { success: false, errors };
  }

  const validatedPlan = result.data as DocumentationPlan;
  const semanticErrors: ValidationError[] = [];

  // Step 2: Schema version check
  if (validatedPlan.schema_version !== '1.0') {
    semanticErrors.push({
      path: 'schema_version',
      message: `Expected '1.0', got '${validatedPlan.schema_version}'`,
    });
  }

  // Step 3: Work units not empty (at least one for reachable databases)
  const reachableDBs = validatedPlan.databases.filter((db) => db.status === 'reachable');
  if (reachableDBs.length > 0 && validatedPlan.work_units.length === 0) {
    semanticErrors.push({
      path: 'work_units',
      message: 'No work units but reachable databases exist',
    });
  }

  // Step 4: Validate each work unit
  for (let i = 0; i < validatedPlan.work_units.length; i++) {
    const unit = validatedPlan.work_units[i];
    const unitErrors = validateWorkUnitSemantics(unit, i);
    semanticErrors.push(...unitErrors);
  }

  // Step 5: Validate no circular dependencies
  const cycleResult = validateNoCycles(validatedPlan.work_units);
  if (!cycleResult.valid) {
    semanticErrors.push({
      path: 'work_units',
      message: `Cyclic dependency detected: ${cycleResult.cycle?.join(' -> ')}`,
    });
  }

  // Step 6: Validate summary matches data
  const summaryErrors = validateSummaryConsistency(validatedPlan);
  semanticErrors.push(...summaryErrors);

  if (semanticErrors.length > 0) {
    return { success: false, errors: semanticErrors };
  }

  return { success: true, data: validatedPlan };
}

/**
 * Validate a single WorkUnit against contract requirements.
 */
export function validateWorkUnit(unit: unknown): ValidationResult<WorkUnit> {
  const result = WorkUnitSchema.safeParse(unit);

  if (!result.success) {
    const errors: ValidationError[] = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    return { success: false, errors };
  }

  return { success: true, data: result.data as WorkUnit };
}

/**
 * Semantic validation for a work unit
 */
function validateWorkUnitSemantics(unit: WorkUnit, index: number): ValidationError[] {
  const errors: ValidationError[] = [];
  const prefix = `work_units[${index}]`;

  // Check ID format: {database}_{domain}
  const expectedIdPattern = `${unit.database}_${unit.domain}`;
  if (unit.id !== expectedIdPattern) {
    errors.push({
      path: `${prefix}.id`,
      message: `ID '${unit.id}' should follow pattern '{database}_{domain}'`,
    });
  }

  // Check all tables belong to this domain
  for (let i = 0; i < unit.tables.length; i++) {
    const table = unit.tables[i];
    if (table.domain !== unit.domain) {
      errors.push({
        path: `${prefix}.tables[${i}].domain`,
        message: `Table domain '${table.domain}' doesn't match work unit domain '${unit.domain}'`,
      });
    }
  }

  // Check output directory format
  const expectedDir = `databases/${unit.database}/domains/${unit.domain}`;
  if (unit.output_directory !== expectedDir) {
    // Warning only - could be valid custom path
  }

  return errors;
}

/**
 * Validate that work units have no cyclic dependencies.
 * Uses Kahn's algorithm for topological sort.
 */
export function validateNoCycles(workUnits: WorkUnit[]): { valid: boolean; cycle?: string[] } {
  const unitMap = new Map<string, WorkUnit>();
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  // Build graph
  for (const unit of workUnits) {
    unitMap.set(unit.id, unit);
    inDegree.set(unit.id, 0);
    adjacency.set(unit.id, []);
  }

  // Count incoming edges
  for (const unit of workUnits) {
    for (const dep of unit.depends_on) {
      if (unitMap.has(dep)) {
        adjacency.get(dep)!.push(unit.id);
        inDegree.set(unit.id, (inDegree.get(unit.id) || 0) + 1);
      }
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    for (const neighbor of adjacency.get(current) || []) {
      const newDegree = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // If not all nodes processed, there's a cycle
  if (sorted.length !== workUnits.length) {
    // Find a cycle for reporting
    const remaining = workUnits.filter((u) => !sorted.includes(u.id));
    if (remaining.length > 0) {
      const cycle = findCycle(remaining, adjacency);
      return { valid: false, cycle };
    }
  }

  return { valid: true };
}

/**
 * Find a cycle in the remaining nodes (helper for cycle detection)
 */
function findCycle(remaining: WorkUnit[], adjacency: Map<string, string[]>): string[] {
  const visited = new Set<string>();
  const path: string[] = [];

  function dfs(id: string): string[] | null {
    if (path.includes(id)) {
      const cycleStart = path.indexOf(id);
      return [...path.slice(cycleStart), id];
    }
    if (visited.has(id)) return null;

    visited.add(id);
    path.push(id);

    for (const neighbor of adjacency.get(id) || []) {
      const cycle = dfs(neighbor);
      if (cycle) return cycle;
    }

    path.pop();
    return null;
  }

  for (const unit of remaining) {
    const cycle = dfs(unit.id);
    if (cycle) return cycle;
  }

  return remaining.map((u) => u.id);
}

/**
 * Validate that summary statistics match actual data
 */
function validateSummaryConsistency(plan: DocumentationPlan): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check total_databases
  if (plan.summary.total_databases !== plan.databases.length) {
    errors.push({
      path: 'summary.total_databases',
      message: `Summary says ${plan.summary.total_databases} but found ${plan.databases.length} databases`,
    });
  }

  // Check reachable_databases
  const reachableCount = plan.databases.filter((db) => db.status === 'reachable').length;
  if (plan.summary.reachable_databases !== reachableCount) {
    errors.push({
      path: 'summary.reachable_databases',
      message: `Summary says ${plan.summary.reachable_databases} but found ${reachableCount} reachable`,
    });
  }

  // Check total_tables
  const totalTables = plan.work_units.reduce((sum, wu) => sum + wu.tables.length, 0);
  if (plan.summary.total_tables !== totalTables) {
    errors.push({
      path: 'summary.total_tables',
      message: `Summary says ${plan.summary.total_tables} but work units contain ${totalTables} tables`,
    });
  }

  // Check total_work_units
  if (plan.summary.total_work_units !== plan.work_units.length) {
    errors.push({
      path: 'summary.total_work_units',
      message: `Summary says ${plan.summary.total_work_units} but found ${plan.work_units.length} work units`,
    });
  }

  return errors;
}

// =============================================================================
// TABLE SPEC VALIDATION
// =============================================================================

/**
 * Validate that a TableSpec has all required fields populated.
 */
export function validateTableSpec(table: unknown): ValidationResult<TableSpec> {
  const result = TableSpecSchema.safeParse(table);

  if (!result.success) {
    const errors: ValidationError[] = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    return { success: false, errors };
  }

  return { success: true, data: result.data as TableSpec };
}

/**
 * Validate all required TableSpec fields are populated (for debugging)
 */
export function assertTableSpecComplete(table: TableSpec): void {
  const checks = [
    { field: 'fully_qualified_name', value: table.fully_qualified_name, check: (v: string) => v.length > 0 },
    { field: 'row_count_approx', value: table.row_count_approx, check: (v: number) => v >= 0 },
    { field: 'incoming_fk_count', value: table.incoming_fk_count, check: (v: number) => v >= 0 },
    { field: 'outgoing_fk_count', value: table.outgoing_fk_count, check: (v: number) => v >= 0 },
    { field: 'column_count', value: table.column_count, check: (v: number) => v > 0 },
    { field: 'metadata_hash', value: table.metadata_hash, check: (v: string) => v.length === 64 },
  ];

  for (const { field, value, check } of checks) {
    if (!check(value as never)) {
      throw new Error(`TableSpec ${table.fully_qualified_name}: ${field} is invalid (value: ${value})`);
    }
  }
}

// =============================================================================
// EXPORT SCHEMAS FOR EXTERNAL USE
// =============================================================================

export {
  DocumentationPlanSchema,
  WorkUnitSchema,
  TableSpecSchema,
  DatabaseAnalysisSchema,
  PlanSummarySchema,
  AgentErrorSchema,
};
