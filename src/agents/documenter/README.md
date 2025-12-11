# Documenter Agent - Phase 1: Core Infrastructure

## Overview

The Documenter Agent is responsible for processing documentation plans and generating database documentation. Phase 1 establishes the core infrastructure for plan processing, work unit orchestration, progress tracking, and error handling.

## Phase 1 Capabilities

### ✅ Implemented

- **Plan Loading and Validation**: Reads and validates `documentation-plan.json` with schema version checking and staleness detection
- **Work Unit Processing**: Processes work units sequentially by priority order
- **Progress Tracking**: Multi-level status tracking (table → work unit → overall) with atomic file writes
- **Checkpoint Recovery**: Resume from last checkpoint on restart
- **Error Isolation**: Table failures don't stop work units, work unit failures don't stop documenter
- **Structured Error Handling**: Consistent error codes and logging throughout

### ❌ Not Yet Implemented (Future Phases)

- **LLM Integration**: Semantic description generation (Phase 2)
- **Sub-Agent Implementation**: TableDocumenter and ColumnInferencer (Phase 3)
- **Output Generation**: Markdown and JSON file generation (Phase 4)
- **Manifest Generation**: Documentation manifest for Indexer (Phase 5)

## Architecture

### Core Components

- **`index.ts`**: Main entry point orchestrating the documentation process
- **`plan-loader.ts`**: Plan loading and validation with staleness detection
- **`progress.ts`**: Atomic progress file operations
- **`status.ts`**: Multi-level status computation algorithms
- **`recovery.ts`**: Checkpoint recovery logic
- **`work-unit-processor.ts`**: Work unit processing loop
- **`table-processor.ts`**: Table processing placeholder (Phase 1: mock success)
- **`errors.ts`**: Structured error creation utilities
- **`types.ts`**: TypeScript type definitions matching contract interfaces

### Data Flow

1. **Plan Loading**: Read and validate `progress/documentation-plan.json`
2. **Checkpoint Recovery**: Check for existing progress, resume if applicable
3. **Work Unit Processing**: Process work units sequentially by `priority_order`
4. **Table Processing**: Process tables within each work unit (Phase 1: mock)
5. **Progress Tracking**: Update progress files after each table/work unit
6. **Status Computation**: Compute hierarchical status at each level
7. **Checkpoint Saving**: Save progress every 10 tables

## Progress File Structure

### `progress/documenter-progress.json`

Overall progress tracking with aggregated statistics:

```json
{
  "schema_version": "1.0",
  "started_at": "2025-12-10T14:30:00.000Z",
  "completed_at": null,
  "status": "running",
  "plan_file": "progress/documentation-plan.json",
  "plan_hash": "abc123...",
  "work_units": {
    "production_customers": { ... }
  },
  "stats": {
    "total_tables": 50,
    "completed_tables": 10,
    "failed_tables": 0,
    "skipped_tables": 0,
    "llm_tokens_used": 0,
    "llm_time_ms": 0,
    "db_query_time_ms": 0
  },
  "last_checkpoint": "2025-12-10T14:35:20.000Z",
  "errors": []
}
```

### `progress/work_units/{id}/progress.json`

Per-work-unit progress tracking:

```json
{
  "work_unit_id": "production_customers",
  "status": "running",
  "started_at": "2025-12-10T14:30:05.000Z",
  "tables_total": 10,
  "tables_completed": 7,
  "tables_failed": 0,
  "tables_skipped": 0,
  "current_table": "public.addresses",
  "errors": [],
  "output_files": []
}
```

## Status Algorithm

### Table Level (Binary)
- Each table either succeeds or fails (no partial state)

### Work Unit Level
- **All tables succeeded** → `'completed'`
- **Any table succeeded** → `'partial'`
- **All tables failed OR connection lost** → `'failed'`
- **Empty work unit** → `'completed'`
- **All tables skipped** → `'completed'`

### Overall Level
- **All work units `'completed'`** → `'completed'`
- **Any work unit `'partial'` OR `'failed'`** → `'partial'`
- **All work units `'failed'`** → `'failed'`
- **Fatal error occurred** → `'failed'`

## Checkpoint Recovery

The documenter supports resuming from checkpoints:

1. **On Start**: Checks for existing `documenter-progress.json`
2. **If `status='running'`**: Resumes from last completed work unit
3. **Skips**: Work units with `status='completed'`
4. **Does NOT auto-retry**: Work units with `status='partial'` or `'failed'` (manual intervention required)
5. **Validates**: Plan hash must match current plan (fails if different)

Checkpoints are saved:
- **Every 10 tables** (automatic)
- **After each work unit** (automatic)
- **On completion** (automatic)

## Error Codes

| Code | Severity | Recoverable | Description |
|------|----------|-------------|-------------|
| `DOC_PLAN_NOT_FOUND` | fatal | No | Documentation plan file doesn't exist |
| `DOC_PLAN_INVALID` | fatal | No | Plan file has invalid JSON or schema version mismatch |
| `DOC_PLAN_STALE` | warning | Yes | Plan `config_hash` doesn't match current `databases.yaml` |
| `DOC_DB_CONNECTION_LOST` | error | Yes | Database connection lost during work unit processing |
| `DOC_WORK_UNIT_FAILED` | error | No | Work unit failed completely |

## Usage

```typescript
import { runDocumenter } from './agents/documenter/index.js';

// Run documenter (reads plan from progress/documentation-plan.json)
await runDocumenter();
```

## Testing

Run unit tests:

```bash
npm test -- src/agents/documenter/__tests__/
```

## Future Phases

- **Phase 2**: LLM integration for semantic descriptions
- **Phase 3**: Sub-agent implementation (TableDocumenter, ColumnInferencer)
- **Phase 4**: Output generation (Markdown, JSON)
- **Phase 5**: Manifest generation and polish
