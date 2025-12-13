#!/usr/bin/env node
/**
 * CLI command: npm run sync
 *
 * Syncs the index database and documentation to the remote SFTP server.
 *
 * Usage:
 *   npm run sync              # Sync all (index + docs) with backup
 *   npm run sync:index        # Sync index only
 *   npm run sync:docs         # Sync docs only
 *   npm run sync:no-backup    # Sync without backup
 *   npm run sync:dry-run      # Show what would be done without uploading
 *
 * Environment Variables:
 *   SFTP_HOST                  - SFTP server hostname (required)
 *   SFTP_PORT                  - SFTP server port (default: 22)
 *   SFTP_USER                  - SFTP username (required)
 *   SFTP_PASSWORD              - SFTP password (or use SFTP_PRIVATE_KEY_PATH)
 *   SFTP_PRIVATE_KEY_PATH      - Path to SSH private key
 *   SFTP_REMOTE_INDEX_PATH     - Remote path for index (default: /data/index)
 *   SFTP_REMOTE_MAP_PATH       - Remote path for docs (default: /data/map)
 *   TRIBAL_DB_PATH             - Local database path (default: ./data/tribal-knowledge.db)
 *   TRIBAL_DOCS_PATH           - Local docs path (default: ./docs)
 */

import { Command } from 'commander';
import * as path from 'path';
import { SFTPSyncService, getSFTPConfigFromEnv, getRemotePaths } from '../utils/sftp-sync.js';
import { logger } from '../utils/logger.js';

// Load environment variables
import 'dotenv/config';

const program = new Command();

program
  .name('sync')
  .description('Sync Tribal Knowledge index and documentation to SFTP server')
  .version('1.0.0');

program
  .option('--index-only', 'Sync only the index database')
  .option('--docs-only', 'Sync only the documentation')
  .option('--no-backup', 'Skip backup of existing remote files')
  .option('--dry-run', 'Show what would be done without uploading')
  .option('--max-backups <number>', 'Maximum number of backups to retain', '5')
  .option('--db-path <path>', 'Local database path')
  .option('--docs-path <path>', 'Local docs path')
  .action(async (options) => {
    console.log('\n🚀 Tribal Knowledge SFTP Sync\n');

    // Validate environment
    try {
      const config = getSFTPConfigFromEnv();
      const remotePaths = getRemotePaths();

      console.log('📡 SFTP Configuration:');
      console.log(`   Host: ${config.host}:${config.port}`);
      console.log(`   User: ${config.username}`);
      console.log(`   Auth: ${config.password ? 'Password' : 'SSH Key'}`);
      console.log(`   Remote Index: ${remotePaths.indexPath}`);
      console.log(`   Remote Map: ${remotePaths.mapPath}`);
      console.log('');
    } catch (error) {
      console.error('❌ Configuration Error:', (error as Error).message);
      console.error('\nRequired environment variables:');
      console.error('  SFTP_HOST     - SFTP server hostname');
      console.error('  SFTP_USER     - SFTP username');
      console.error('  SFTP_PASSWORD or SFTP_PRIVATE_KEY_PATH - Authentication');
      process.exit(1);
    }

    // Determine local paths
    const cwd = process.cwd();
    const localDbPath = options.dbPath || process.env.TRIBAL_DB_PATH || path.join(cwd, 'data', 'tribal-knowledge.db');
    const localDocsPath = options.docsPath || process.env.TRIBAL_DOCS_PATH || path.join(cwd, 'docs');

    console.log('📁 Local Paths:');
    console.log(`   Database: ${localDbPath}`);
    console.log(`   Docs: ${localDocsPath}`);
    console.log('');

    // Build sync options
    const syncOptions = {
      backupBeforeUpload: options.backup !== false,
      maxBackups: parseInt(options.maxBackups, 10),
      skipIndex: options.docsOnly === true,
      skipDocs: options.indexOnly === true,
      dryRun: options.dryRun === true,
    };

    console.log('⚙️  Sync Options:');
    console.log(`   Backup: ${syncOptions.backupBeforeUpload ? 'Yes' : 'No'}`);
    console.log(`   Max Backups: ${syncOptions.maxBackups}`);
    console.log(`   Sync Index: ${!syncOptions.skipIndex ? 'Yes' : 'No'}`);
    console.log(`   Sync Docs: ${!syncOptions.skipDocs ? 'Yes' : 'No'}`);
    console.log(`   Dry Run: ${syncOptions.dryRun ? 'Yes' : 'No'}`);
    console.log('');

    if (syncOptions.dryRun) {
      console.log('🔍 DRY RUN MODE - No actual changes will be made\n');
    }

    // Perform sync
    console.log('📤 Starting sync...\n');

    try {
      const service = new SFTPSyncService();
      const result = await service.syncAll(localDbPath, localDocsPath, syncOptions);

      // Print results
      console.log('\n' + '='.repeat(50));
      console.log('📊 SYNC RESULTS');
      console.log('='.repeat(50));

      if (result.success) {
        console.log('✅ Status: SUCCESS');
      } else {
        console.log('❌ Status: FAILED');
      }

      console.log(`📦 Index Synced: ${result.indexSynced ? '✅' : '❌'}`);
      console.log(`📄 Docs Synced: ${result.docsSynced ? '✅' : '❌'}`);

      if (result.backupsCreated.length > 0) {
        console.log(`\n💾 Backups Created (${result.backupsCreated.length}):`);
        for (const backup of result.backupsCreated) {
          console.log(`   - ${backup}`);
        }
      }

      if (result.filesUploaded.length > 0) {
        console.log(`\n📤 Files Uploaded (${result.filesUploaded.length}):`);
        const maxToShow = 10;
        for (const file of result.filesUploaded.slice(0, maxToShow)) {
          console.log(`   - ${file}`);
        }
        if (result.filesUploaded.length > maxToShow) {
          console.log(`   ... and ${result.filesUploaded.length - maxToShow} more`);
        }
      }

      if (result.errors.length > 0) {
        console.log(`\n⚠️  Errors (${result.errors.length}):`);
        for (const error of result.errors) {
          console.log(`   - ${error}`);
        }
      }

      if (result.dryRun) {
        console.log('\n🔍 DRY RUN - No actual changes were made');
      }

      console.log('\n' + '='.repeat(50));

      process.exit(result.success ? 0 : 1);
    } catch (error) {
      console.error('\n❌ Sync failed:', (error as Error).message);
      logger.error('SFTP sync failed', error);
      process.exit(1);
    }
  });

// Parse arguments
program.parse(process.argv);

