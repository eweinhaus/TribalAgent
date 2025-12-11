/**
 * Plan Display Module
 *
 * Human-readable plan review output per FR-0.5.
 * Displays plan summary, domain breakdown, and work units overview.
 *
 * @module cli/plan-display
 */

import chalk from 'chalk';
import type { DocumentationPlan } from '../contracts/types.js';

/**
 * Display a human-readable summary of the documentation plan.
 */
export function displayPlanSummary(plan: DocumentationPlan): void {
  console.log('\n' + chalk.bold('=== Documentation Plan ===\n'));

  // Summary stats
  console.log(chalk.cyan('Summary:'));
  console.log(`  Databases:     ${plan.summary.reachable_databases}/${plan.summary.total_databases} reachable`);
  console.log(`  Tables:        ${plan.summary.total_tables}`);
  console.log(`  Work Units:    ${plan.summary.total_work_units}`);
  console.log(`  Domains:       ${plan.summary.domain_count}`);
  console.log(`  Est. Time:     ${plan.summary.total_estimated_minutes} minutes`);
  console.log(`  Parallelism:   ${plan.summary.recommended_parallelism} workers`);
  console.log(`  Complexity:    ${formatComplexity(plan.complexity)}`);

  // Domain breakdown by database
  console.log('\n' + chalk.cyan('Domains by Database:'));
  for (const db of plan.databases) {
    const statusIcon = db.status === 'reachable' ? chalk.green('●') : chalk.red('○');
    console.log(`\n  ${statusIcon} ${chalk.bold(db.name)} (${db.type}, ${db.table_count} tables)`);

    if (db.status === 'unreachable') {
      console.log(chalk.red(`    Connection failed: ${db.connection_error?.message || 'Unknown error'}`));
      continue;
    }

    const domainEntries = Object.entries(db.domains).sort(
      ([, a], [, b]) => b.length - a.length
    );

    for (const [domain, tables] of domainEntries) {
      const priority = getDomainPriority(domain);
      const priorityIcon = priority === 'core' ? '★' : priority === 'system' ? '○' : '●';
      console.log(`    ${priorityIcon} ${domain}: ${tables.length} tables`);
    }
  }

  // Work units overview
  console.log('\n' + chalk.cyan('Work Units (processing order):'));
  const workUnitsToShow = plan.work_units.slice(0, 10);

  for (const wu of workUnitsToShow) {
    const priorityBadge = wu.priority_order <= 3 ? chalk.green('HIGH') : '';
    console.log(
      `  ${wu.priority_order}. ${wu.id} - ${wu.tables.length} tables (~${wu.estimated_time_minutes}m) ${priorityBadge}`
    );
  }

  if (plan.work_units.length > 10) {
    console.log(chalk.dim(`  ... and ${plan.work_units.length - 10} more work units`));
  }

  // Errors if any
  if (plan.errors.length > 0) {
    console.log('\n' + chalk.yellow('Warnings/Errors:'));
    for (const err of plan.errors) {
      const icon = err.severity === 'fatal' ? chalk.red('✗') : chalk.yellow('⚠');
      console.log(`  ${icon} [${err.severity}] ${err.code}: ${err.message}`);
    }
  }

  // Schema version and timestamp
  console.log('\n' + chalk.dim(`Generated: ${plan.generated_at}`));
  console.log(chalk.dim(`Config Hash: ${plan.config_hash.substring(0, 16)}...`));
}

/**
 * Format complexity level with color.
 */
function formatComplexity(complexity: 'simple' | 'moderate' | 'complex'): string {
  switch (complexity) {
    case 'simple':
      return chalk.green('Simple (< 50 tables)');
    case 'moderate':
      return chalk.yellow('Moderate (50-200 tables)');
    case 'complex':
      return chalk.red('Complex (> 200 tables)');
  }
}

/**
 * Get domain priority category.
 */
function getDomainPriority(domain: string): 'core' | 'system' | 'standard' {
  const coreDomains = ['customers', 'users', 'orders', 'products'];
  const systemDomains = ['system', 'audit', 'logs', 'migrations', 'other', 'uncategorized'];

  if (coreDomains.includes(domain)) return 'core';
  if (systemDomains.includes(domain)) return 'system';
  return 'standard';
}

/**
 * Display plan details in table format.
 */
export function displayPlanDetails(plan: DocumentationPlan): void {
  displayPlanSummary(plan);

  console.log('\n' + chalk.cyan('Table Details:'));
  console.log(chalk.dim('  (Showing first 20 tables)'));

  let tableCount = 0;
  outer: for (const wu of plan.work_units) {
    for (const table of wu.tables) {
      if (tableCount >= 20) break outer;

      const priority = table.priority === 1 ? '★' : table.priority === 2 ? '●' : '○';
      console.log(
        `  ${priority} ${table.fully_qualified_name} - ${table.column_count} cols, ~${table.row_count_approx} rows`
      );
      tableCount++;
    }
  }
}

/**
 * Display compact plan summary for piping.
 */
export function displayPlanCompact(plan: DocumentationPlan): void {
  console.log(`Databases: ${plan.summary.reachable_databases}/${plan.summary.total_databases}`);
  console.log(`Tables: ${plan.summary.total_tables}`);
  console.log(`Work Units: ${plan.summary.total_work_units}`);
  console.log(`Domains: ${plan.summary.domain_count}`);
  console.log(`Complexity: ${plan.complexity}`);
  console.log(`Est. Time: ${plan.summary.total_estimated_minutes}m`);
}
