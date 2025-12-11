# End-to-End Test Infrastructure

This directory contains comprehensive end-to-end tests for the Documenter Agent, covering the complete documentation pipeline from plan execution through manifest generation.

## Test Structure

### Test Files

- **`complete-pipeline.test.ts`**: Tests the complete pipeline (plan → document → manifest)
- **`checkpoint-recovery.test.ts`**: Tests checkpoint recovery and resume functionality
- **`manifest-validation.test.ts`**: Tests manifest generation and validation

### Test Utilities

- **`setup.ts`**: Test environment setup (database, directories, test plans)
- **`helpers.ts`**: Helper functions for assertions and validations
- **`teardown.ts`**: Cleanup utilities for test environment

## Running Tests

### Prerequisites

1. **Test Database**: Set `TEST_DATABASE_URL` environment variable with a PostgreSQL connection string
   ```bash
   export TEST_DATABASE_URL="postgresql://user:password@localhost:5432/test_db"
   ```

2. **Optional LLM API**: For tests that require real LLM calls, set `OPENROUTER_API_KEY`
   ```bash
   export OPENROUTER_API_KEY="your-api-key"
   ```

### Running All E2E Tests

```bash
npm run test -- src/agents/documenter/__tests__/e2e/
```

### Running Specific Test File

```bash
npm run test -- src/agents/documenter/__tests__/e2e/complete-pipeline.test.ts
```

### Running with Watch Mode

```bash
npm run test:watch -- src/agents/documenter/__tests__/e2e/
```

## Test Scenarios

### Complete Pipeline Test (`complete-pipeline.test.ts`)

**Test Cases:**
1. **Complete Pipeline**: Tests full execution from plan generation through manifest creation
2. **File Content Structure**: Verifies generated files have correct structure and content

**Coverage:**
- Plan generation and validation
- Documenter execution
- File generation (Markdown and JSON)
- Manifest generation
- File structure validation

### Checkpoint Recovery Test (`checkpoint-recovery.test.ts`)

**Test Cases:**
1. **Progress Checkpoint**: Verifies progress is saved during execution
2. **Resume from Checkpoint**: Tests resuming after simulated interruption
3. **Stale Plan Handling**: Tests handling of stale plan hash

**Coverage:**
- Progress file creation and structure
- Checkpoint recovery logic
- Resume functionality
- Stale plan detection

### Manifest Validation Test (`manifest-validation.test.ts`)

**Test Cases:**
1. **Manifest Structure**: Validates manifest JSON structure
2. **Content Hashes**: Verifies SHA-256 hashes for all files
3. **File Metadata**: Validates file size and modified time
4. **File Listing**: Ensures all generated files are listed
5. **Partial Status**: Tests manifest status for partial completion

**Coverage:**
- Manifest generation
- Content hash computation
- File metadata collection
- Manifest validation
- Status determination

## Test Environment

### Directory Structure

Tests create the following temporary structure:

```
test-output/
├── docs/                    # Generated documentation files
│   └── databases/
│       └── test_db/
│           └── domains/
│               └── test/
│                   └── tables/
└── test-progress/
    └── progress/            # Progress files
        ├── documentation-plan.json
        └── documenter-progress.json
```

### Test Database Setup

Tests automatically:
1. Create test tables (`e2e_test_users`, `e2e_test_orders`)
2. Insert sample data
3. Clean up tables after tests

### Cleanup

All test artifacts are automatically cleaned up after tests complete:
- Test directories are removed
- Test database tables are dropped
- Temporary files are deleted

## Test Behavior

### Skipping Tests

Tests automatically skip if:
- `TEST_DATABASE_URL` is not set
- Test database connection fails

This allows the test suite to run in environments without a test database.

### Timeouts

E2E tests have extended timeouts:
- Standard tests: 120 seconds (2 minutes)
- Complex tests: 180 seconds (3 minutes)

This accounts for:
- Database operations
- LLM API calls (if enabled)
- File I/O operations

## Integration with CI/CD

### Environment Variables

For CI/CD pipelines, set:

```bash
TEST_DATABASE_URL="postgresql://user:password@host:5432/test_db"
OPENROUTER_API_KEY="optional-for-llm-tests"
```

### Test Isolation

Each test:
- Creates its own test environment
- Uses isolated directories
- Cleans up after completion
- Does not interfere with other tests

## Troubleshooting

### Tests Skip Unexpectedly

- Verify `TEST_DATABASE_URL` is set correctly
- Check database connection string format
- Ensure database is accessible

### Tests Timeout

- Increase timeout in test file if needed
- Check database performance
- Verify network connectivity for LLM API calls

### File Not Found Errors

- Ensure test directories are created properly
- Check file path resolution (working directory)
- Verify progress subdirectory structure

## Future Enhancements

- [ ] Error injection tests (simulating API failures, DB connection loss)
- [ ] Performance benchmarks
- [ ] Multi-database tests (PostgreSQL + Snowflake)
- [ ] Parallel execution tests
- [ ] Large schema tests (100+ tables)
