#!/usr/bin/env node

/**
 * Tribal Knowledge Deep Agent
 *
 * Main entry point for the Tribal Knowledge Deep Agent system.
 * This is a deep agent system that automatically documents database schemas
 * and provides semantic search capabilities for tribal knowledge discovery.
 */

import { Command } from 'commander';
import { logger } from './utils/logger';

const program = new Command();

program
  .name('tribal-knowledge')
  .description('Deep agent system for automatic database schema documentation and semantic search')
  .version('0.1.0');

// Plan command - Schema Analyzer
program
  .command('plan')
  .description('Analyze database schemas and create documentation plan')
  .option('--force', 'Force re-planning even if config unchanged')
  .option('--dry-run', 'Show what would be planned without executing')
  .option('--json', 'Output plan as JSON instead of summary')
  .option('--config <path>', 'Path to databases.yaml config file')
  .action(async (options: { force?: boolean; dryRun?: boolean; json?: boolean; config?: string }) => {
    try {
      logger.info('Starting schema analysis...');
      const { runPlanner } = await import('./agents/planner/index');
      const { displayPlanSummary } = await import('./cli/plan-display');

      const plan = await runPlanner({
        force: options.force,
        dryRun: options.dryRun,
        configPath: options.config,
      });

      if (options.json) {
        console.log(JSON.stringify(plan, null, 2));
      } else {
        displayPlanSummary(plan);
      }

      logger.info('Schema analysis completed');
    } catch (error) {
      logger.error('Schema analysis failed', error);
      process.exit(1);
    }
  });

// Plan validate command
program
  .command('plan:validate')
  .description('Validate documentation-plan.json (catches errors in user edits)')
  .option('--plan <path>', 'Path to plan file', 'progress/documentation-plan.json')
  .option('--strict', 'Fail on warnings, not just errors')
  .action(async (options: { plan: string; strict?: boolean }) => {
    try {
      const { runPlanValidateCommand } = await import('./cli/plan-validate');
      const args: string[] = [];
      if (options.plan !== 'progress/documentation-plan.json') {
        args.push('--plan', options.plan);
      }
      if (options.strict) {
        args.push('--strict');
      }
      await runPlanValidateCommand(args);
    } catch (error) {
      logger.error('Plan validation failed', error);
      process.exit(1);
    }
  });

// Document command - Database Documenter
program
  .command('document')
  .description('Document database schemas using LLM inference')
  .action(async () => {
    try {
      logger.info('Starting database documentation...');
      const { runDocumenter } = await import('./agents/documenter/index');
      await runDocumenter();
      logger.info('Database documentation completed');
    } catch (error) {
      logger.error('Database documentation failed', error);
      process.exit(1);
    }
  });

// Index command - Document Indexer
program
  .command('index')
  .description('Index documentation for semantic search')
  .action(async () => {
    try {
      logger.info('Starting document indexing...');
      const { runIndexer } = await import('./agents/indexer/index');
      await runIndexer();
      logger.info('Document indexing completed');
    } catch (error) {
      logger.error('Document indexing failed', error);
      process.exit(1);
    }
  });

// Note: MCP integration is implemented in separate repository (Noah's Company MCP)
// This repository provides retrieval functions that external MCP calls

// Status command
program
  .command('status')
  .description('Show current system status and progress')
  .action(async () => {
    try {
      const { showStatus } = await import('./utils/status');
      await showStatus();
    } catch (error) {
      logger.error('Status check failed', error);
      process.exit(1);
    }
  });

// Validate prompts command
program
  .command('validate-prompts')
  .description('Validate prompt template syntax and structure')
  .action(async () => {
    try {
      const { validatePrompts } = await import('./utils/validate-prompts');
      await validatePrompts();
      logger.info('Prompt validation completed');
    } catch (error) {
      logger.error('Prompt validation failed', error);
      process.exit(1);
    }
  });

// Pipeline command - Run all phases
program
  .command('pipeline')
  .description('Run complete pipeline: plan → document → index')
  .option('--force', 'Force re-planning even if config unchanged')
  .action(async (options: { force?: boolean }) => {
    try {
      logger.info('Starting complete pipeline...');

      // Phase 1: Plan
      logger.info('Phase 1: Planning...');
      const { runPlanner } = await import('./agents/planner/index');
      await runPlanner({ force: options.force });

      // Phase 2: Document
      logger.info('Phase 2: Documenting...');
      const { runDocumenter } = await import('./agents/documenter/index');
      await runDocumenter();

      // Phase 3: Index
      logger.info('Phase 3: Indexing...');
      const { runIndexer } = await import('./agents/indexer/index');
      await runIndexer();

      logger.info('Complete pipeline finished successfully');
    } catch (error) {
      logger.error('Pipeline failed', error);
      process.exit(1);
    }
  });

// Error handling for unhandled commands
program.on('command:*', (unknownCommand) => {
  logger.error(`Unknown command: ${unknownCommand[0]}`);
  logger.error('Run "tribal-knowledge --help" for available commands');
  process.exit(1);
});

// Parse command line arguments
program.parse();