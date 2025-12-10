/**
 * Agent 1: Database Documenter
 *
 * Executes documentation plan using sub-agents for table and column documentation.
 * Uses the documentation-plan.json created by the Planner to spawn TableDocumenter
 * sub-agents for each table.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import { loadDocumentationPlan } from '../../utils/config.js';

// Progress tracking schema
const DocumenterProgressSchema = z.object({
  started_at: z.string(),
  completed_at: z.string().nullable(),
  status: z.enum(['running', 'completed', 'failed']),
  plan_file: z.string(),
  current_database: z.string().nullable(),
  current_table: z.string().nullable(),
  databases: z.array(z.object({
    name: z.string(),
    status: z.enum(['pending', 'in_progress', 'completed', 'failed']),
    tables_total: z.number(),
    tables_completed: z.number(),
    error: z.string().nullable(),
  })),
});

type DocumenterProgress = z.infer<typeof DocumenterProgressSchema>;

export async function runDocumenter(): Promise<void> {
  try {
    logger.info('Starting database documentation phase');

    // Load documentation plan
    const plan = await loadDocumentationPlan();
    logger.info(`Loaded plan with ${plan.total_tables} tables across ${plan.databases.length} databases`);

    // Initialize progress tracking
    const progress: DocumenterProgress = {
      started_at: new Date().toISOString(),
      completed_at: null,
      status: 'running',
      plan_file: 'progress/documentation-plan.json',
      current_database: null,
      current_table: null,
      databases: plan.databases.map(db => ({
        name: db.name,
        status: 'pending',
        tables_total: db.table_count,
        tables_completed: 0,
        error: null,
      })),
    };

    await saveProgress(progress);

    // Process each database
    for (const database of plan.databases) {
      logger.info(`Processing database: ${database.name}`);

      progress.current_database = database.name;
      const dbProgress = progress.databases.find(db => db.name === database.name)!;
      dbProgress.status = 'in_progress';

      await saveProgress(progress);

      try {
        // Process tables in priority order
        for (const table of database.tables) {
          logger.info(`Documenting table: ${table.name}`);

          progress.current_table = table.name;
          await saveProgress(progress);

          // Spawn TableDocumenter sub-agent
          const { TableDocumenter } = await import('./sub-agents/TableDocumenter.js');
          const documenter = new TableDocumenter(table.metadata);

          await documenter.document();

          dbProgress.tables_completed++;
          await saveProgress(progress);
        }

        dbProgress.status = 'completed';

      } catch (error) {
        logger.error(`Failed to document database ${database.name}`, error);
        dbProgress.status = 'failed';
        dbProgress.error = error instanceof Error ? error.message : String(error);
        await saveProgress(progress);
        throw error;
      }
    }

    // Mark overall progress as completed
    progress.status = 'completed';
    progress.completed_at = new Date().toISOString();
    progress.current_database = null;
    progress.current_table = null;

    await saveProgress(progress);

    logger.info('Database documentation phase completed');

  } catch (error) {
    logger.error('Documentation phase failed', error);
    throw error;
  }
}

/**
 * Save progress to file for checkpoint recovery
 */
async function saveProgress(progress: DocumenterProgress): Promise<void> {
  const progressPath = path.join(process.cwd(), 'progress', 'documenter-progress.json');
  await fs.mkdir(path.dirname(progressPath), { recursive: true });
  await fs.writeFile(progressPath, JSON.stringify(progress, null, 2));
}