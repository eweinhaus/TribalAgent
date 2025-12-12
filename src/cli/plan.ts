/**
 * Plan CLI Command
 *
 * Analyzes database schemas and creates a documentation plan.
 * Usage: npm run plan [options]
 *
 * @module cli/plan
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { runPlanner, type PlannerOptions } from '../agents/planner/index.js';
import { displayPlanSummary } from './plan-display.js';

/**
 * Create the plan command.
 */
export function createPlanCommand(): Command {
  return new Command('plan')
    .description('Analyze database schemas and create documentation plan')
    .option('--force', 'Force re-planning even if config unchanged')
    .option('--dry-run', 'Show what would be planned without executing')
    .option('--json', 'Output plan as JSON instead of summary')
    .option('--config <path>', 'Path to databases.yaml config file')
    .action(async (options: { force?: boolean; dryRun?: boolean; json?: boolean; config?: string }) => {
      try {
        console.log(chalk.cyan('\nTribal Knowledge - Schema Analyzer\n'));
        const startTime = Date.now();
        console.log(chalk.dim(`[Planner] Started at ${new Date().toLocaleTimeString()}`));

        const plannerOptions: PlannerOptions = {
          force: options.force,
          dryRun: options.dryRun,
          configPath: options.config,
        };

        const plan = await runPlanner(plannerOptions);
        const duration = Date.now() - startTime;
        const minutes = Math.floor(duration / 60000);
        const seconds = Math.floor((duration % 60000) / 1000);
        console.log(chalk.dim(`[Planner] Completed in ${minutes}m ${seconds}s`));

        if (options.json) {
          console.log(JSON.stringify(plan, null, 2));
        } else {
          displayPlanSummary(plan);
        }

        if (!options.dryRun) {
          console.log(chalk.green('\n✓ Plan saved to: progress/documentation-plan.json'));
          console.log(chalk.dim('  Review the plan, then run: npm run document'));
        } else {
          console.log(chalk.yellow('\n⚠ Dry run - plan not saved'));
        }

        process.exit(0);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`\n✗ Planning failed: ${message}`));
        process.exit(1);
      }
    });
}

/**
 * Run the plan command directly (for npm script).
 */
export async function runPlanCommand(args: string[] = []): Promise<void> {
  const program = createPlanCommand();
  await program.parseAsync(args, { from: 'user' });
}

// If running directly via tsx
if (process.argv[1]?.endsWith('plan.ts') || process.argv[1]?.endsWith('plan.js')) {
  runPlanCommand(process.argv.slice(2)).catch((error) => {
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(1);
  });
}
