# Tribal Knowledge Deep Agent
## Orchestrator Plan Document

**Version**: 1.0  
**Date**: December 9, 2025  
**Status**: Planning

---

## 1. Purpose

The Orchestrator is a coordination layer that chains the manual agent commands together intelligently. It is user-triggered but runs the full pipeline once started, with optional pause points for user review.

### Without Orchestrator
```
User runs: npm run plan
User reviews plan
User runs: npm run document
User reviews docs
User runs: npm run index
User reviews index
User runs: npm run serve
```

### With Orchestrator
```
User runs: npm run orchestrate
Orchestrator: Runs plan → pauses for review → user approves → 
              Runs document → pauses → user approves →
              Runs index → pauses → user approves →
              Starts serve
```

---

## 2. Design Principles

| Principle | Implementation |
|-----------|----------------|
| **User-triggered** | Orchestrator only runs when user executes command |
| **Smart detection** | Analyzes state to determine what needs to run |
| **Pause points** | User can review after each major phase |
| **Recommendations** | Orchestrator suggests next action, user confirms |
| **Graceful degradation** | Individual commands still work independently |
| **Transparent state** | All decisions logged and explainable |

---

## 3. Orchestrator Modes

### 3.1 Interactive Mode (Default)

```bash
npm run orchestrate
# or
npm run orchestrate --mode=interactive
```

Behavior:
- Runs each phase sequentially
- Pauses after each phase for user review
- Shows recommendation for next step
- User confirms to continue or can abort
- Displays summary of what was done and what's next

### 3.2 Auto Mode

```bash
npm run orchestrate --mode=auto
```

Behavior:
- Runs all phases without pausing
- Only stops on error
- Logs progress to console
- Useful for CI/CD or scheduled runs
- Still respects smart detection (skips unnecessary work)

### 3.3 Smart Mode

```bash
npm run orchestrate --mode=smart
```

Behavior:
- Analyzes current state before running anything
- Determines minimum work needed
- Only runs phases that are necessary
- Pauses to show user what it will do and why
- User confirms the smart plan

### 3.4 Single Phase Mode

```bash
npm run orchestrate --only=plan
npm run orchestrate --only=document
npm run orchestrate --only=index
npm run orchestrate --only=serve
```

Behavior:
- Runs only the specified phase
- Equivalent to existing manual commands
- But with orchestrator's state awareness

---

## 4. Smart Detection Logic

The orchestrator analyzes filesystem state to determine what work is needed.

### 4.1 State Indicators

| File/Directory | Indicates |
|----------------|-----------|
| databases.yaml | Configuration exists |
| databases.yaml mtime | Config has changed |
| documentation-plan.json | Planning was done |
| documentation-plan.json mtime | Plan freshness |
| /docs/**/*.md | Documentation exists |
| /docs files mtime | Docs freshness vs plan |
| tribal-knowledge.db | Index exists |
| tribal-knowledge.db mtime | Index freshness vs docs |
| documenter-progress.json | Documentation in progress or incomplete |
| indexer-progress.json | Indexing in progress or incomplete |

### 4.2 Decision Matrix

| State | Recommendation |
|-------|----------------|
| No plan exists | Run plan |
| Plan exists but config changed | Re-run plan |
| Plan exists, no docs | Run document |
| Plan exists, docs exist, docs older than plan | Re-run document |
| Docs exist, no index | Run index |
| Index older than docs | Re-run index |
| Index exists and fresh | Ready to serve |
| documenter-progress.json shows incomplete | Resume document |
| indexer-progress.json shows incomplete | Resume index |

### 4.3 Change Detection

**Config Change Detection**:
- Store hash of databases.yaml in plan file
- Compare current hash to stored hash
- If different, plan is stale

**Documentation Change Detection**:
- Each table doc has content_hash
- Compare to indexed content_hash
- Only re-index changed documents

**Incremental Updates**:
- Plan stores table list with hashes
- Document phase compares to database state
- Only document new/changed tables
- Index phase only processes new/changed docs

---

## 5. Interactive Flow

### 5.1 Startup Analysis

```
╔══════════════════════════════════════════════════════════════╗
║            TRIBAL KNOWLEDGE ORCHESTRATOR                     ║
╠══════════════════════════════════════════════════════════════╣
║ Analyzing current state...                                   ║
║                                                              ║
║ Configuration:  ✓ databases.yaml found (2 databases)         ║
║ Plan:           ✓ documentation-plan.json exists             ║
║                   Created: 2025-12-09 10:30:00               ║
║                   Tables: 156 across 2 databases             ║
║ Documentation:  ✓ /docs contains 156 table files             ║
║                   Last updated: 2025-12-09 11:45:00          ║
║ Index:          ⚠ tribal-knowledge.db is STALE               ║
║                   Index: 2025-12-09 10:35:00                 ║
║                   Docs:  2025-12-09 11:45:00                 ║
║                                                              ║
║ RECOMMENDATION: Run indexer to update search index           ║
╚══════════════════════════════════════════════════════════════╝

Proceed with indexing? [Y/n/plan/document/quit]: 
```

### 5.2 Phase Completion Pause

```
╔══════════════════════════════════════════════════════════════╗
║ PHASE COMPLETE: Documentation                                ║
╠══════════════════════════════════════════════════════════════╣
║ Duration:     4 minutes 32 seconds                           ║
║ Tables:       156 documented                                 ║
║ Errors:       2 tables skipped (see logs)                    ║
║ Output:       /docs/databases/                               ║
║                                                              ║
║ Review suggestions:                                          ║
║   • Open /docs/catalog-summary.md for overview               ║
║   • Check /docs/databases/production/domains/ for groupings  ║
║   • Review documenter-progress.json for skipped tables       ║
║                                                              ║
║ NEXT STEP: Run indexer to make docs searchable               ║
╚══════════════════════════════════════════════════════════════╝

Continue to indexing? [Y/n/review/quit]: 
```

### 5.3 User Options at Pause Points

| Input | Action |
|-------|--------|
| `Y` or Enter | Continue with recommended next step |
| `n` | Skip to next phase (with warning) |
| `review` | Open relevant files for review, then re-prompt |
| `quit` | Exit orchestrator, preserve state for resume |
| `plan` | Jump to planning phase |
| `document` | Jump to documentation phase |
| `index` | Jump to indexing phase |
| `status` | Show current state analysis again |

---

## 6. Error Handling

### 6.1 Phase Failure

If a phase fails:

```
╔══════════════════════════════════════════════════════════════╗
║ PHASE FAILED: Documentation                                  ║
╠══════════════════════════════════════════════════════════════╣
║ Error: Database connection failed for analytics_snowflake    ║
║                                                              ║
║ Progress saved:                                              ║
║   • 87/156 tables documented                                 ║
║   • Checkpoint: documenter-progress.json                     ║
║                                                              ║
║ Options:                                                     ║
║   [R] Retry - attempt to resume from checkpoint              ║
║   [S] Skip - continue to indexing with partial docs          ║
║   [Q] Quit - exit and fix issue manually                     ║
╚══════════════════════════════════════════════════════════════╝

Choice [R/s/q]: 
```

### 6.2 Retry Logic

- Retries use exponential backoff: 1s, 2s, 4s
- Maximum 3 retries per phase
- After 3 failures, pause for user decision
- Checkpoint enables resume without re-doing completed work

### 6.3 Partial Success

Some phases can partially succeed:
- Planning: All or nothing (must analyze all databases)
- Documentation: Can skip failed tables, continue with others
- Indexing: Can skip failed documents, continue with others

Orchestrator tracks partial success and reports it clearly.

---

## 7. State File: orchestrator-state.json

The orchestrator maintains its own state file for resumability.

**Structure**:
- session_id: Unique ID for this orchestration run
- started_at: ISO timestamp
- mode: interactive, auto, or smart
- current_phase: plan, document, index, serve, or complete
- phases: Object tracking each phase
  - plan:
    - status: pending, running, completed, failed, skipped
    - started_at, completed_at: Timestamps
    - config_hash: Hash of databases.yaml used
    - output_file: Path to plan JSON
  - document:
    - status: pending, running, completed, failed, skipped
    - started_at, completed_at: Timestamps
    - tables_total, tables_completed, tables_failed: Counts
    - plan_hash: Hash of plan used
  - index:
    - status: pending, running, completed, failed, skipped
    - started_at, completed_at: Timestamps
    - docs_total, docs_indexed, docs_failed: Counts
    - docs_hash: Hash of doc directory state
  - serve:
    - status: pending, running, stopped
    - started_at, stopped_at: Timestamps
    - port: MCP server port
- last_action: Description of last action taken
- next_recommendation: What orchestrator suggests next

---

## 8. CLI Interface

### 8.1 Commands

```bash
# Main orchestration command
npm run orchestrate [options]

# Options:
#   --mode=<mode>       interactive (default), auto, smart
#   --only=<phase>      Run only specified phase: plan, document, index, serve
#   --skip=<phases>     Skip phases (comma-separated): plan,document
#   --resume            Resume from last checkpoint
#   --force             Ignore smart detection, run all phases
#   --yes               Auto-confirm all prompts (same as --mode=auto)
#   --dry-run           Show what would be done without doing it

# Status command
npm run orchestrate:status

# Reset state (clear checkpoints, start fresh)
npm run orchestrate:reset
```

### 8.2 Examples

```bash
# Interactive full pipeline
npm run orchestrate

# Auto-run everything, no prompts
npm run orchestrate --mode=auto

# Smart detection, show plan, confirm once
npm run orchestrate --mode=smart

# Resume failed run
npm run orchestrate --resume

# Only run indexing
npm run orchestrate --only=index

# Skip planning (use existing plan)
npm run orchestrate --skip=plan

# See what would happen without doing it
npm run orchestrate --dry-run

# Check current state
npm run orchestrate:status
```

---

## 9. Integration with Existing Agents

### 9.1 Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            ORCHESTRATOR                                     │
│                                                                             │
│    ┌─────────────────────────────────────────────────────────────────┐     │
│    │                    State Manager                                 │     │
│    │   - Reads filesystem state                                       │     │
│    │   - Maintains orchestrator-state.json                            │     │
│    │   - Determines what to run                                       │     │
│    └─────────────────────────────────────────────────────────────────┘     │
│                                    │                                        │
│                                    ▼                                        │
│    ┌─────────────────────────────────────────────────────────────────┐     │
│    │                    Phase Runner                                  │     │
│    │   - Invokes agents via their existing entry points               │     │
│    │   - Monitors progress                                            │     │
│    │   - Handles errors and retries                                   │     │
│    └─────────────────────────────────────────────────────────────────┘     │
│                                    │                                        │
│         ┌──────────────┬───────────┼───────────┬──────────────┐            │
│         ▼              ▼           ▼           ▼              ▼            │
│    ┌─────────┐   ┌───────────┐ ┌─────────┐ ┌─────────┐  ┌─────────┐       │
│    │ Planner │   │Documenter │ │ Indexer │ │Retrieval│  │  Serve  │       │
│    │         │   │           │ │         │ │         │  │         │       │
│    │(existing│   │ (existing │ │(existing│ │(existing│  │(existing│       │
│    │ agent)  │   │  agent)   │ │ agent)  │ │ agent)  │  │ agent)  │       │
│    └─────────┘   └───────────┘ └─────────┘ └─────────┘  └─────────┘       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 9.2 Orchestrator Does NOT Replace Agents

The orchestrator:
- Calls existing agent code (doesn't duplicate it)
- Reads agent progress files (doesn't replace them)
- Adds coordination logic on top
- Is optional (individual commands still work)

### 9.3 Code Organization

```
src/
├── orchestrator/
│   ├── index.ts              # CLI entry point
│   ├── state-manager.ts      # State detection and management
│   ├── phase-runner.ts       # Executes phases, handles errors
│   ├── interactive-ui.ts     # Terminal UI for prompts
│   └── types.ts              # Orchestrator types
├── planner/                  # Existing Schema Analyzer
├── agents/
│   ├── documenter/           # Existing Agent 1
│   ├── indexer/              # Existing Agent 2
│   └── retrieval/            # Existing Agent 3
└── ...
```

---

## 10. Future Enhancements

### 10.1 Watch Mode (Future - Post MVP)

```bash
npm run orchestrate --watch
```

This would enable autonomous behavior:
- Watch databases.yaml for changes
- Watch source databases for schema changes
- Auto-run pipeline when changes detected
- Run on schedule (cron-like)

**Not in MVP** because:
- Introduces autonomous behavior
- Cost unpredictability
- Complexity of change detection
- Can be added later without breaking manual workflow

### 10.2 Parallel Execution (Future)

For large multi-database setups:
- Document multiple databases in parallel
- Index in parallel with documentation (streaming)
- Requires careful dependency management

### 10.3 Notification Integration (Future)

- Slack/email notification on completion
- Alert on failures
- Summary reports

---

## 11. Implementation Notes

### 11.1 Phase Invocation

The orchestrator calls agents via their TypeScript entry points, not by spawning separate processes. This allows:
- Shared logging context
- Better error handling
- Progress streaming
- Cleaner shutdown

```typescript
// Orchestrator calls agents directly
import { runPlanner } from '../planner';
import { runDocumenter } from '../agents/documenter';
import { runIndexer } from '../agents/indexer';

async function runPhase(phase: Phase): Promise<PhaseResult> {
  switch (phase) {
    case 'plan':
      return await runPlanner(config);
    case 'document':
      return await runDocumenter(config);
    case 'index':
      return await runIndexer(config);
    // ...
  }
}
```

### 11.2 Progress Streaming

During long phases, orchestrator streams progress:

```
Documenting tables... [=====>                    ] 23/156 (14%)
  Current: production.public.order_items
  Elapsed: 1m 12s | Remaining: ~4m 30s
```

### 11.3 Graceful Shutdown

On Ctrl+C or kill signal:
- Save current progress to checkpoint
- Write orchestrator-state.json
- Log resume instructions
- Exit cleanly

---

## 12. Success Criteria

| Criterion | Target |
|-----------|--------|
| Single command runs full pipeline | `npm run orchestrate` works end-to-end |
| Smart detection accuracy | Correctly identifies stale components 100% |
| Resume after failure | Can resume from any checkpoint |
| Interactive prompts clear | User understands options at each pause |
| No regressions | Individual commands still work |
| State transparency | User can always see why orchestrator made a decision |

---

## 13. Dependencies on Other Documents

| Document | Dependency |
|----------|------------|
| tribal-knowledge-plan.md | Orchestrator coordinates agents defined there |
| tribal-knowledge-prd2-technical.md | Uses progress file formats defined there |
| agent-config.yaml | Orchestrator respects agent configuration |

---

*End of Orchestrator Plan Document*
