# Tribal Knowledge Deep Agent
## Agent Contracts - Execution Model

**Version**: 1.0  
**Date**: December 10, 2025  
**Author**: Systems Architect  
**Status**: Draft  
**Companion**: See `agent-contracts-interfaces.md` for TypeScript interfaces

---

## 1. Overview

This document defines the execution model for inter-agent communication:
- How agents hand off work to each other
- Parallel processing architecture
- Validation rules at each boundary
- Error propagation strategies
- Progress tracking mechanisms

### 1.1 Document Organization

| Section | Contents |
|---------|----------|
| §2 | Parallel execution model |
| §3 | Agent boundary contracts |
| §4 | Validation rules |
| §5 | Error propagation |
| §6 | Progress tracking |
| §7 | Selective re-processing |
| §8 | Directory structure |
| §9 | Implementation checklist |

---

## 2. Parallel Execution Model

### 2.1 Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     PARALLEL DOCUMENTATION MODEL                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   PLANNER                                                               │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ Analyze DB → Detect Domains → Create Work Units                │   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                    │                                    │
│                                    ▼                                    │
│                       documentation-plan.json                           │
│                       (contains N work units)                           │
│                                    │                                    │
│                    ┌───────────────┼───────────────┐                   │
│                    ▼               ▼               ▼                    │
│   DOCUMENTER  ┌─────────┐    ┌─────────┐    ┌─────────┐               │
│   spawns:     │Work Unit│    │Work Unit│    │Work Unit│               │
│               │ domain1 │    │ domain2 │    │ domainN │               │
│               └────┬────┘    └────┬────┘    └────┬────┘               │
│                    │              │              │     ← PARALLEL      │
│                    ▼              ▼              ▼                      │
│               /docs/db/     /docs/db/      /docs/db/                   │
│               domain1/      domain2/       domainN/                    │
│                    │              │              │                      │
│                    └──────────────┼──────────────┘                      │
│                                   ▼                                     │
│                      documentation-manifest.json                        │
│                                   │                                     │
│   INDEXER                         ▼                                     │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ Read manifest → Validate files → Generate embeddings → Index   │   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Work Unit Independence

Each work unit is designed to be **fully independent**:

| Property | Implementation |
|----------|----------------|
| **Self-contained** | All tables needed are in the work unit |
| **Isolated output** | Each unit writes to its own directory |
| **Separate progress** | Each sub-agent writes its own progress file |
| **No shared state** | Sub-agents don't communicate with each other |
| **Idempotent** | Can be re-run without affecting other units |

### 2.3 Parallelism Configuration

```typescript
interface ParallelConfig {
  /** Max concurrent work units (default: 4) */
  max_parallel_work_units: number;
  
  /** Max concurrent tables per work unit (default: 3) */
  max_parallel_tables_per_unit: number;
  
  /** Max concurrent LLM calls total (default: 5) */
  max_parallel_llm_calls: number;
}
```

### 2.4 Progress Aggregation

The parent Documenter aggregates progress from all work unit sub-agents:

```typescript
async function aggregateProgress(): Promise<DocumenterProgress> {
  const unitDirs = await fs.readdir('progress/work_units');
  const progress: DocumenterProgress = {
    schema_version: '1.0',
    started_at: startTime,
    completed_at: null,
    status: 'running',
    work_units: {},
    stats: { total_tables: 0, completed_tables: 0, failed_tables: 0, ... }
  };
  
  for (const dir of unitDirs) {
    const unitProgress = await readJson(`progress/work_units/${dir}/progress.json`);
    progress.work_units[dir] = unitProgress;
    
    // Aggregate stats
    progress.stats.total_tables += unitProgress.tables_total;
    progress.stats.completed_tables += unitProgress.tables_completed;
    progress.stats.failed_tables += unitProgress.tables_failed;
  }
  
  progress.status = determineOverallStatus(progress.work_units);
  return progress;
}

function determineOverallStatus(workUnits: Record<string, WorkUnitProgress>): AgentStatus {
  const statuses = Object.values(workUnits).map(u => u.status);
  
  if (statuses.every(s => s === 'completed')) return 'completed';
  if (statuses.every(s => s === 'pending')) return 'pending';
  if (statuses.some(s => s === 'running')) return 'running';
  if (statuses.some(s => s === 'failed') && statuses.some(s => s === 'completed')) return 'partial';
  if (statuses.every(s => s === 'failed')) return 'failed';
  
  return 'running';
}
```

---

## 3. Agent Boundary Contracts

### 3.1 Planner → Documenter Boundary

**Contract File**: `progress/documentation-plan.json`

**Completion Signal**: File exists and passes validation

**Required Fields**:
- `schema_version`: Must equal `"1.0"`
- `generated_at`: Valid ISO timestamp
- `config_hash`: Non-empty 64-char string
- `work_units`: Non-empty array
- `summary.total_tables`: Number > 0

**Documenter Pre-conditions**:
1. Plan file exists
2. Plan passes schema validation
3. Plan is not stale (config_hash matches current config)
4. At least one work unit present

### 3.2 Documenter → Indexer Boundary

**Contract File**: `docs/documentation-manifest.json`

**Completion Signal**: File exists with `status` = `"complete"` or `"partial"`

**Required Fields**:
- `schema_version`: Must equal `"1.0"`
- `completed_at`: Valid ISO timestamp
- `status`: `"complete"` or `"partial"`
- `indexable_files`: Array (can index if non-empty)

**Indexer Pre-conditions**:
1. Manifest file exists
2. Manifest passes schema validation
3. Status is terminal (`complete` or `partial`)
4. At least one indexable file present
5. All listed files exist on disk
6. File hashes match (no modifications since manifest created)

### 3.3 Indexer → Retriever Boundary

**Contract**: SQLite database with required tables

**Readiness Check**:
```typescript
function isIndexReady(): boolean {
  const metadata = db.prepare(
    'SELECT * FROM index_metadata ORDER BY last_full_index DESC LIMIT 1'
  ).get();
  
  if (!metadata) return false;
  if (metadata.document_count === 0) return false;
  
  // Warn if stale but don't block
  const indexAge = Date.now() - new Date(metadata.last_full_index).getTime();
  if (indexAge > 24 * 60 * 60 * 1000) {
    console.warn('Index older than 24 hours');
  }
  
  return true;
}
```

---

## 4. Validation Rules

### 4.1 Plan Validation (Documenter receives)

```typescript
function validatePlan(plan: unknown): DocumentationPlan {
  // 1. Schema version
  if (plan.schema_version !== '1.0') {
    throw new ValidationError('PLAN_VERSION_MISMATCH', 
      `Expected 1.0, got ${plan.schema_version}`);
  }
  
  // 2. Required fields
  const required = ['generated_at', 'config_hash', 'work_units', 'summary'];
  for (const field of required) {
    if (!(field in plan)) {
      throw new ValidationError('PLAN_MISSING_FIELD', `Missing: ${field}`);
    }
  }
  
  // 3. Work units not empty
  if (!Array.isArray(plan.work_units) || plan.work_units.length === 0) {
    throw new ValidationError('PLAN_EMPTY', 'No work units');
  }
  
  // 4. Each work unit valid
  for (const unit of plan.work_units) {
    validateWorkUnit(unit);
  }
  
  // 5. No circular dependencies
  validateNoCycles(plan.work_units);
  
  return plan as DocumentationPlan;
}

function validateWorkUnit(unit: unknown): void {
  const required = ['id', 'database', 'domain', 'tables', 'output_directory'];
  for (const field of required) {
    if (!(field in unit)) {
      throw new ValidationError('WORK_UNIT_INVALID', `Missing ${field}`);
    }
  }
  
  if (!Array.isArray(unit.tables) || unit.tables.length === 0) {
    throw new ValidationError('WORK_UNIT_EMPTY', `${unit.id} has no tables`);
  }
}
```

### 4.2 Manifest Validation (Indexer receives)

```typescript
async function validateManifest(manifest: unknown, docsDir: string): Promise<void> {
  // 1. Schema version
  if (manifest.schema_version !== '1.0') {
    throw new ValidationError('MANIFEST_VERSION_MISMATCH');
  }
  
  // 2. Status is terminal
  if (!['complete', 'partial'].includes(manifest.status)) {
    throw new ValidationError('MANIFEST_INCOMPLETE', 'Documentation not yet complete');
  }
  
  // 3. Files exist and hashes match
  for (const file of manifest.indexable_files) {
    const fullPath = path.join(docsDir, file.path);
    
    if (!await fs.pathExists(fullPath)) {
      throw new ValidationError('MANIFEST_FILE_MISSING', `Missing: ${file.path}`);
    }
    
    const content = await fs.readFile(fullPath);
    const actualHash = computeHash(content);
    if (actualHash !== file.content_hash) {
      throw new ValidationError('MANIFEST_HASH_MISMATCH', 
        `${file.path} changed since manifest created`);
    }
  }
}
```

### 4.3 Staleness Detection

```typescript
async function isPlanStale(plan: DocumentationPlan): Promise<boolean> {
  const configContent = await fs.readFile('config/databases.yaml');
  const currentHash = computeHash(configContent);
  return currentHash !== plan.config_hash;
}

async function isManifestStale(manifest: DocumentationManifest): Promise<boolean> {
  // Check if any source file was modified after manifest creation
  for (const file of manifest.indexable_files) {
    const stat = await fs.stat(path.join('docs', file.path));
    if (stat.mtime > new Date(manifest.completed_at)) {
      return true;
    }
  }
  return false;
}
```

---

## 5. Error Propagation

### 5.1 Error Categories

| Category | Scope | Recovery Strategy |
|----------|-------|-------------------|
| **Configuration** | System-wide | Manual fix required |
| **Connection** | Database-level | Retry with backoff, skip if persistent |
| **Extraction** | Table-level | Skip table, continue with others |
| **LLM** | Operation-level | Retry, use fallback description |
| **File I/O** | Operation-level | Retry, fail work unit if persistent |
| **Validation** | Agent boundary | Block downstream agent |

### 5.2 Error Codes Reference

#### Planner Errors (PLAN_*)
| Code | Severity | Recoverable | Action |
|------|----------|-------------|--------|
| `PLAN_CONFIG_NOT_FOUND` | fatal | No | Fix config |
| `PLAN_CONFIG_INVALID` | fatal | No | Fix YAML syntax |
| `PLAN_DB_UNREACHABLE` | warning | Yes | Skip database |
| `PLAN_DOMAIN_INFERENCE_FAILED` | warning | Yes | Use fallback |
| `PLAN_WRITE_FAILED` | fatal | No | Check permissions |

#### Documenter Errors (DOC_*)
| Code | Severity | Recoverable | Action |
|------|----------|-------------|--------|
| `DOC_PLAN_NOT_FOUND` | fatal | No | Run planner |
| `DOC_PLAN_INVALID` | fatal | No | Regenerate plan |
| `DOC_PLAN_STALE` | warning | Yes | Regenerate plan |
| `DOC_DB_CONNECTION_LOST` | error | Yes | Retry |
| `DOC_TABLE_EXTRACTION_FAILED` | error | Yes | Skip table |
| `DOC_SAMPLING_TIMEOUT` | warning | Yes | Continue without samples |
| `DOC_LLM_FAILED` | warning | Yes | Use fallback |

#### Indexer Errors (IDX_*)
| Code | Severity | Recoverable | Action |
|------|----------|-------------|--------|
| `IDX_MANIFEST_NOT_FOUND` | fatal | No | Run documenter |
| `IDX_MANIFEST_INVALID` | fatal | No | Regenerate |
| `IDX_FILE_NOT_FOUND` | error | Yes | Skip file |
| `IDX_EMBEDDING_FAILED` | warning | Yes | FTS only |
| `IDX_DB_WRITE_FAILED` | error | Yes | Retry |

#### Retriever Errors (RET_*)
| Code | Severity | Recoverable | Action |
|------|----------|-------------|--------|
| `RET_INDEX_NOT_READY` | error | No | Run indexer |
| `RET_QUERY_INVALID` | error | No | Fix query |
| `RET_TABLE_NOT_FOUND` | warning | No | Return not found |
| `RET_BUDGET_EXCEEDED` | warning | Yes | Truncate |

### 5.3 Propagation Flow

```
PLANNER
├── DB1 unreachable
│   └── Mark "unreachable" in plan
│       └── No work units created → Documenter skips DB1
│
├── Domain inference fails
│   └── Use fallback grouping (by table prefix)
│       └── Plan generated with warning → Documenter proceeds
│
DOCUMENTER
├── Work Unit 1 fails completely
│   └── Mark status = "failed"
│       └── Other work units continue
│           └── Manifest status = "partial"
│               └── Indexer processes available files
│
├── Single table fails in Work Unit 2
│   └── Mark table failed in progress
│       └── Work Unit 2 continues
│           └── Work Unit 2 status = "partial"
│               └── Successfully documented tables in manifest
│
INDEXER
├── Single file fails to index
│   └── Mark file failed
│       └── Continue with other files
│           └── Index contains partial data
│               └── Retriever returns results (may be incomplete)
│
├── Embedding API fails repeatedly
│   └── Reduce batch size, retry
│       └── If still fails, index without vectors
│           └── Retriever uses FTS5 only (degraded)
```

### 5.4 Work Unit Failure Handling

```typescript
async function handleWorkUnitFailure(workUnitId: string, error: AgentError): Promise<void> {
  // Update work unit progress
  await updateWorkUnitProgress(workUnitId, {
    status: 'failed',
    completed_at: new Date().toISOString(),
    errors: [...existingErrors, error]
  });
  
  // Log but don't throw - let other work units continue
  logger.error(`Work unit ${workUnitId} failed`, { error });
  
  // Emit event for monitoring
  events.emit('work_unit_failed', { workUnitId, error });
}
```

---

## 6. Progress Tracking

### 6.1 Progress File Hierarchy

```
progress/
├── documentation-plan.json       # Planner output
├── documenter-progress.json      # Aggregated documenter status
├── indexer-progress.json         # Indexer status
├── orchestrator-state.json       # Orchestrator state
└── work_units/                   # Per-work-unit progress
    ├── production_customers/
    │   └── progress.json
    ├── production_orders/
    │   └── progress.json
    └── analytics_events/
        └── progress.json
```

### 6.2 Checkpoint Strategy

| Agent | Checkpoint Frequency | Recovery Point |
|-------|---------------------|----------------|
| Planner | On completion | Database level |
| Documenter (parent) | Every 10 tables | Work unit level |
| Documenter (sub-agent) | Every table | Table level |
| Indexer | Every 100 files | File level |

### 6.3 Resume Logic

```typescript
async function resumeDocumentation(): Promise<void> {
  const progress = await loadProgress('progress/documenter-progress.json');
  
  if (!progress) {
    // Fresh start
    return startDocumentation();
  }
  
  if (progress.status === 'completed') {
    console.log('Documentation already complete');
    return;
  }
  
  // Find incomplete work units
  const incomplete = Object.entries(progress.work_units)
    .filter(([_, p]) => p.status !== 'completed')
    .map(([id, _]) => id);
  
  console.log(`Resuming: ${incomplete.length} work units remaining`);
  
  // Resume only incomplete units
  await processWorkUnits(incomplete);
}
```

---

## 7. Selective Re-processing

### 7.1 CLI Flags

```bash
# Re-document specific work unit
npm run document -- --work-unit=production_customers

# Re-document all work units for a domain
npm run document -- --domain=customers

# Re-document failed work units only
npm run document -- --retry-failed

# Force re-processing even if unchanged
npm run document -- --force

# Re-index specific work unit's files
npm run index -- --work-unit=production_customers
```

### 7.2 Work Unit Selection

```typescript
interface DocumenterOptions {
  workUnits?: string[];      // Only these work unit IDs
  domains?: string[];        // Only these domains
  retryFailed?: boolean;     // Only failed work units
  force?: boolean;           // Ignore change detection
}

async function selectWorkUnits(
  plan: DocumentationPlan,
  options: DocumenterOptions
): Promise<WorkUnit[]> {
  let units = plan.work_units;
  
  // Filter by explicit IDs
  if (options.workUnits?.length) {
    units = units.filter(u => options.workUnits!.includes(u.id));
  }
  
  // Filter by domain
  if (options.domains?.length) {
    units = units.filter(u => options.domains!.includes(u.domain));
  }
  
  // Filter to failed only
  if (options.retryFailed) {
    const progress = await loadProgress();
    units = units.filter(u => progress.work_units[u.id]?.status === 'failed');
  }
  
  // Skip unchanged unless forced
  if (!options.force) {
    units = await filterToChanged(units);
  }
  
  return units;
}

async function filterToChanged(units: WorkUnit[]): Promise<WorkUnit[]> {
  const changed: WorkUnit[] = [];
  
  for (const unit of units) {
    const manifestPath = `docs/${unit.output_directory}/.manifest.json`;
    
    if (!await fs.pathExists(manifestPath)) {
      changed.push(unit);
      continue;
    }
    
    const existing = await readJson(manifestPath);
    if (existing.content_hash !== unit.content_hash) {
      changed.push(unit);
    }
  }
  
  return changed;
}
```

### 7.3 Incremental Indexing

```typescript
async function incrementalIndex(workUnitId?: string): Promise<void> {
  const manifest = await loadManifest();
  
  let filesToIndex = manifest.indexable_files;
  
  // Filter to specific work unit if provided
  if (workUnitId) {
    const workUnit = manifest.work_units.find(u => u.id === workUnitId);
    if (!workUnit) throw new Error(`Work unit not found: ${workUnitId}`);
    
    filesToIndex = filesToIndex.filter(f => 
      f.path.startsWith(workUnit.output_directory)
    );
  }
  
  // Skip already indexed files with matching hash
  const newOrChanged = await filterToNewOrChanged(filesToIndex);
  
  console.log(`Indexing ${newOrChanged.length} files (${filesToIndex.length - newOrChanged.length} unchanged)`);
  
  await indexFiles(newOrChanged);
}
```

---

## 8. Directory Structure

```
tribal-knowledge/
├── config/
│   ├── databases.yaml              # Database connections
│   └── agent-config.yaml           # Agent behavior
│
├── prompts/                        # LLM templates
│   ├── column-description.md
│   ├── table-description.md
│   ├── domain-inference.md
│   └── query-understanding.md
│
├── progress/                       # Runtime state
│   ├── documentation-plan.json     # Planner → Documenter
│   ├── documenter-progress.json    # Aggregated progress
│   ├── indexer-progress.json       # Indexer progress
│   ├── orchestrator-state.json     # Orchestrator state
│   └── work_units/                 # Per-unit progress
│       └── {work_unit_id}/
│           └── progress.json
│
├── docs/                           # Generated documentation
│   ├── documentation-manifest.json # Documenter → Indexer
│   ├── catalog-summary.md
│   └── databases/
│       └── {database}/
│           ├── README.md
│           ├── tables/
│           │   └── {schema}.{table}.md
│           ├── domains/
│           │   ├── {domain}.md
│           │   └── {domain}.mermaid
│           ├── schemas/
│           │   ├── {schema}.{table}.json
│           │   └── {schema}.{table}.yaml
│           └── er-diagrams/
│               └── full-schema.mermaid
│
├── data/
│   └── tribal-knowledge.db         # SQLite + FTS5 + vectors
│
└── src/
    ├── contracts/                  # This specification as code
    │   ├── types.ts               # All interfaces
    │   ├── schemas.ts             # JSON Schema definitions
    │   ├── validators.ts          # Validation functions
    │   └── errors.ts              # Error codes
    ├── planner/
    ├── agents/
    │   ├── documenter/
    │   │   ├── index.ts           # Parent documenter
    │   │   └── sub-agents/
    │   │       ├── domain-documenter.ts
    │   │       ├── table-documenter.ts
    │   │       └── column-inferencer.ts
    │   ├── indexer/
    │   └── retrieval/
    └── ...
```

---

## 9. Implementation Checklist

### Phase 1: Core Contracts
- [ ] Create `src/contracts/types.ts` with all interfaces
- [ ] Create `src/contracts/schemas.ts` with JSON Schema
- [ ] Create `src/contracts/validators.ts`
- [ ] Create `src/contracts/errors.ts` with error codes
- [ ] Unit tests for validators

### Phase 2: Planner Updates
- [ ] Update Planner to output work units
- [ ] Implement domain-based work unit generation
- [ ] Add dependency detection between work units
- [ ] Include content hashes for change detection
- [ ] Integration test: Planner → plan.json

### Phase 3: Parallel Documenter
- [ ] Create DomainDocumenter sub-agent
- [ ] Implement work unit parallel execution
- [ ] Add per-work-unit progress tracking
- [ ] Create manifest generator
- [ ] Implement selective re-documentation CLI
- [ ] Integration test: plan.json → manifest.json

### Phase 4: Indexer Updates
- [ ] Update Indexer to read manifest
- [ ] Add manifest validation
- [ ] Implement incremental indexing
- [ ] Handle partial documentation gracefully
- [ ] Integration test: manifest.json → SQLite

### Phase 5: Integration
- [ ] Update Orchestrator for new contracts
- [ ] Add CLI commands for selective processing
- [ ] End-to-end integration tests
- [ ] Update existing documentation

---

## 10. Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| **Work units by domain** | Natural business grouping, enables domain experts to review, supports selective re-documentation |
| **Manifest-based handoff** | Explicit completion signal, enables partial processing, supports incremental indexing |
| **Per-work-unit progress files** | Enables true parallelism without lock contention, simplifies crash recovery |
| **Content hashes everywhere** | Enables change detection without timestamps, supports idempotent re-runs |
| **Partial status allowed** | Better to have 90% documented than 0%, downstream can proceed with available data |
| **Flat error codes** | Easy to grep logs, simple to handle programmatically |

---

*End of Execution Model - See `agent-contracts-interfaces.md` for TypeScript interfaces*
