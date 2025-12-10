/**
 * Status Reporting Utility
 *
 * Shows current system status and progress information.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { logger } from './logger.js';

export async function showStatus(): Promise<void> {
  try {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                TRIBAL KNOWLEDGE SYSTEM STATUS                ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');

    // Configuration status
    console.log('║ Configuration:                                               ║');
    await checkConfigStatus();

    // Planning status
    console.log('║                                                              ║');
    console.log('║ Planning:                                                    ║');
    await checkPlanningStatus();

    // Documentation status
    console.log('║                                                              ║');
    console.log('║ Documentation:                                               ║');
    await checkDocumentationStatus();

    // Indexing status
    console.log('║                                                              ║');
    console.log('║ Indexing:                                                    ║');
    await checkIndexingStatus();

    // MCP status
    console.log('║                                                              ║');
    console.log('║ MCP Server:                                                  ║');
    await checkMCPStatus();

    console.log('║                                                              ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');

  } catch (error) {
    logger.error('Status check failed', error);
    console.log('❌ Status check failed:', error instanceof Error ? error.message : String(error));
  }
}

async function checkConfigStatus(): Promise<void> {
  try {
    // Check databases.yaml
    const dbConfigPath = path.join(process.cwd(), 'config', 'databases.yaml');
    await fs.access(dbConfigPath);
    console.log('║   ✓ databases.yaml found                                    ║');

    // Check agent-config.yaml
    const agentConfigPath = path.join(process.cwd(), 'config', 'agent-config.yaml');
    try {
      await fs.access(agentConfigPath);
      console.log('║   ✓ agent-config.yaml found                                 ║');
    } catch {
      console.log('║   ⚠ agent-config.yaml not found (using defaults)           ║');
    }

    // Check prompt templates
    const promptsDir = path.join(process.cwd(), 'prompts');
    const entries = await fs.readdir(promptsDir);
    const templateCount = entries.filter(f => f.endsWith('.md')).length;
    console.log(`║   ✓ ${templateCount} prompt templates found                      ║`);

  } catch (error) {
    console.log('║   ❌ Configuration check failed                              ║');
  }
}

async function checkPlanningStatus(): Promise<void> {
  try {
    const planPath = path.join(process.cwd(), 'progress', 'documentation-plan.json');

    try {
      await fs.access(planPath);
      const planContent = await fs.readFile(planPath, 'utf-8');
      const plan = JSON.parse(planContent);

      const generatedAt = new Date(plan.generated_at).toLocaleString();
      console.log(`║   ✓ Plan exists (${generatedAt})                            ║`);
      console.log(`║     ${plan.total_tables} tables across ${plan.databases.length} databases ║`);
      console.log(`║     Complexity: ${plan.complexity}                                 ║`);

    } catch {
      console.log('║   ❌ Plan file corrupted                                      ║');
    }

  } catch {
    console.log('║   ❌ No documentation plan found                              ║');
  }
}

async function checkDocumentationStatus(): Promise<void> {
  try {
    const progressPath = path.join(process.cwd(), 'progress', 'documenter-progress.json');

    try {
      await fs.access(progressPath);
      const progressContent = await fs.readFile(progressPath, 'utf-8');
      const progress = JSON.parse(progressContent);

      if (progress.status === 'completed') {
        const completedAt = new Date(progress.completed_at).toLocaleString();
        console.log(`║   ✓ Documentation completed (${completedAt})                  ║`);
      } else if (progress.status === 'running') {
        console.log('║   ● Documentation in progress                                 ║');
        console.log(`║     Current: ${progress.current_database || 'N/A'}                     ║`);
      } else {
        console.log('║   ❌ Documentation failed                                     ║');
      }

    } catch {
      console.log('║   ❌ Documentation progress file corrupted                    ║');
    }

    // Check docs directory
    const docsDir = path.join(process.cwd(), 'docs');
    try {
      await fs.access(docsDir);
      console.log('║   ✓ Documentation directory exists                           ║');
    } catch {
      console.log('║   ❌ Documentation directory missing                         ║');
    }

  } catch (error) {
    console.log('║   ❌ Documentation status check failed                       ║');
  }
}

async function checkIndexingStatus(): Promise<void> {
  try {
    const progressPath = path.join(process.cwd(), 'progress', 'indexer-progress.json');
    const dbPath = path.join(process.cwd(), 'data', 'tribal-knowledge.db');

    // Check progress
    try {
      await fs.access(progressPath);
      const progressContent = await fs.readFile(progressPath, 'utf-8');
      const progress = JSON.parse(progressContent);

      if (progress.status === 'completed') {
        const completedAt = new Date(progress.completed_at).toLocaleString();
        console.log(`║   ✓ Indexing completed (${completedAt})                       ║`);
        console.log(`║     ${progress.documents_indexed || 0} documents indexed               ║`);
      } else if (progress.status === 'running') {
        console.log('║   ● Indexing in progress                                      ║');
      } else {
        console.log('║   ❌ Indexing failed                                          ║');
      }

    } catch {
      console.log('║   ❌ Indexing progress file corrupted                         ║');
    }

    // Check database
    try {
      await fs.access(dbPath);
      const stats = await fs.stat(dbPath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
      console.log(`║   ✓ Database exists (${sizeMB} MB)                              ║`);
    } catch {
      console.log('║   ❌ Database file missing                                     ║');
    }

  } catch (error) {
    console.log('║   ❌ Indexing status check failed                             ║');
  }
}

async function checkMCPStatus(): Promise<void> {
  // For now, just show that MCP is ready when index exists
  try {
    const dbPath = path.join(process.cwd(), 'data', 'tribal-knowledge.db');
    await fs.access(dbPath);
    console.log('║   ✓ Ready to serve (database available)                      ║');
  } catch {
    console.log('║   ❌ Not ready to serve (database missing)                   ║');
  }
}