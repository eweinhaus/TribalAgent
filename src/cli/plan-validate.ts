/**
 * Plan Validate CLI Command
 *
 * Validates documentation-plan.json (catches errors in user edits).
 * Usage: npm run plan:validate [options]
 *
 * Per FR-0.5, this provides guardrails for user-edited plans before
 * running the Documenter.
 *
 * @module cli/plan-validate
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { loadPlanRaw } from '../utils/plan-io.js';
import { validatePlan, validateNoCycles } from '../contracts/validators.js';
import type { DocumentationPlan } from '../contracts/types.js';

/**
 * Create the plan:validate command.
 */
export function createPlanValidateCommand(): Command {
  return new Command('plan:validate')
    .description('Validate documentation-plan.json (catches errors in user edits)')
    .option('--plan <path>', 'Path to plan file', 'progress/documentation-plan.json')
    .option('--strict', 'Fail on warnings, not just errors')
    .action(async (options: { plan: string; strict?: boolean }) => {
      console.log(chalk.cyan('\nValidating plan...\n'));

      const warnings: string[] = [];
      const errors: string[] = [];

      try {
        // Step 1: Load and parse JSON
        let plan: unknown;
        try {
          plan = await loadPlanRaw(options.plan);
          console.log(chalk.green('  ✓ JSON parsed successfully'));
        } catch (error) {
          console.log(chalk.red('  ✗ Failed to load plan file'));
          console.log(chalk.red(`    ${error instanceof Error ? error.message : String(error)}`));
          process.exit(1);
        }

        // Step 2: Schema validation (Zod)
        const schemaResult = validatePlan(plan);
        if (!schemaResult.success) {
          console.log(chalk.red('  ✗ Schema validation failed:'));
          for (const error of schemaResult.errors || []) {
            console.log(`    ${chalk.red('✗')} ${error.path}: ${error.message}`);
          }
          process.exit(1);
        }
        console.log(chalk.green('  ✓ Schema valid'));

        const validPlan = schemaResult.data as DocumentationPlan;

        // Step 3: Semantic validation (catches logical errors)

        // Check: All tables in work_units exist in database analysis
        const allDbTables = new Set(
          validPlan.databases.flatMap((db) => Object.values(db.domains).flat())
        );
        for (const wu of validPlan.work_units) {
          for (const table of wu.tables) {
            if (!allDbTables.has(table.table_name) && !allDbTables.has(`${table.schema_name}.${table.table_name}`)) {
              errors.push(
                `WorkUnit ${wu.id}: table "${table.table_name}" not found in any database`
              );
            }
          }
        }

        // Check: No duplicate table assignments
        const tableAssignments = new Map<string, string[]>();
        for (const wu of validPlan.work_units) {
          for (const table of wu.tables) {
            if (!tableAssignments.has(table.fully_qualified_name)) {
              tableAssignments.set(table.fully_qualified_name, []);
            }
            tableAssignments.get(table.fully_qualified_name)!.push(wu.id);
          }
        }
        for (const [table, wuIds] of tableAssignments) {
          if (wuIds.length > 1) {
            errors.push(`Table "${table}" appears in multiple work units: ${wuIds.join(', ')}`);
          }
        }

        // Check: Work unit IDs are unique
        const wuIds = new Set<string>();
        for (const wu of validPlan.work_units) {
          if (wuIds.has(wu.id)) {
            errors.push(`Duplicate work unit ID: ${wu.id}`);
          }
          wuIds.add(wu.id);
        }

        // Check: No cyclic dependencies
        const depsResult = validateNoCycles(validPlan.work_units);
        if (!depsResult.valid) {
          errors.push(`Cyclic dependency detected: ${depsResult.cycle?.join(' -> ')}`);
        }

        // Check: content_hash is present (warns if empty - user may have cleared it)
        for (const wu of validPlan.work_units) {
          if (!wu.content_hash) {
            warnings.push(`WorkUnit ${wu.id}: content_hash is empty (will be regenerated)`);
          }
        }

        // Check: Unreachable databases have no work units
        const unreachableDBs = validPlan.databases
          .filter((d) => d.status === 'unreachable')
          .map((d) => d.name);
        for (const wu of validPlan.work_units) {
          if (unreachableDBs.includes(wu.database)) {
            errors.push(`WorkUnit ${wu.id}: references unreachable database "${wu.database}"`);
          }
        }

        // Check: Summary matches actual data
        const actualTableCount = validPlan.work_units.reduce(
          (sum, wu) => sum + wu.tables.length,
          0
        );
        if (actualTableCount !== validPlan.summary.total_tables) {
          warnings.push(
            `Summary total_tables (${validPlan.summary.total_tables}) doesn't match actual (${actualTableCount})`
          );
        }

        if (validPlan.work_units.length !== validPlan.summary.total_work_units) {
          warnings.push(
            `Summary total_work_units (${validPlan.summary.total_work_units}) doesn't match actual (${validPlan.work_units.length})`
          );
        }

        // Report results
        if (warnings.length > 0) {
          console.log(chalk.yellow('\n  Warnings:'));
          for (const w of warnings) {
            console.log(`    ${chalk.yellow('⚠')} ${w}`);
          }
        }

        if (errors.length > 0) {
          console.log(chalk.red('\n  Errors:'));
          for (const e of errors) {
            console.log(`    ${chalk.red('✗')} ${e}`);
          }
          process.exit(1);
        }

        if (options.strict && warnings.length > 0) {
          console.log(chalk.red('\n✗ Validation failed (strict mode): warnings present'));
          process.exit(1);
        }

        // Success!
        console.log(chalk.green('\n✓ Plan is valid'));
        console.log(
          chalk.dim(
            `  ${validPlan.work_units.length} work units, ${validPlan.summary.total_tables} tables`
          )
        );

        process.exit(0);
      } catch (error) {
        console.log(
          chalk.red(`\n✗ Validation error: ${error instanceof Error ? error.message : String(error)}`)
        );
        process.exit(1);
      }
    });
}

/**
 * Run the plan:validate command directly (for npm script).
 */
export async function runPlanValidateCommand(args: string[] = []): Promise<void> {
  const program = createPlanValidateCommand();
  await program.parseAsync(args, { from: 'user' });
}

// If running directly via tsx
if (process.argv[1]?.endsWith('plan-validate.ts') || process.argv[1]?.endsWith('plan-validate.js')) {
  runPlanValidateCommand(process.argv.slice(2)).catch((error) => {
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(1);
  });
}
