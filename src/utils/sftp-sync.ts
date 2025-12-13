/**
 * SFTP Sync Module
 *
 * Handles synchronization of index database and documentation to remote SFTP server.
 * Includes backup functionality for existing remote files.
 *
 * File Mapping:
 * - data/tribal-knowledge.db → /data/index/index.db (RENAMED)
 * - docs/documentation-manifest.json → /data/map/documentation-manifest.json
 * - docs/databases/{db_name}/ → /data/map/{db_name}/
 */

import Client from 'ssh2-sftp-client';
import { logger } from './logger.js';
import * as path from 'path';
import * as fs from 'fs/promises';

// =============================================================================
// Types
// =============================================================================

export interface SFTPConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: Buffer | string;
  privateKeyPath?: string;
}

export interface SyncOptions {
  /** Create backup of existing remote files before upload (default: true) */
  backupBeforeUpload?: boolean;
  /** Custom backup suffix (default: timestamp-based) */
  backupSuffix?: string;
  /** Maximum number of backups to retain (default: 5) */
  maxBackups?: number;
  /** Skip index sync */
  skipIndex?: boolean;
  /** Skip docs sync */
  skipDocs?: boolean;
  /** Dry run - log what would be done without uploading */
  dryRun?: boolean;
}

export interface SyncResult {
  success: boolean;
  indexSynced: boolean;
  docsSynced: boolean;
  backupsCreated: string[];
  filesUploaded: string[];
  errors: string[];
  dryRun: boolean;
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Get SFTP configuration from environment variables
 */
export function getSFTPConfigFromEnv(): SFTPConfig {
  const host = process.env.SFTP_HOST;
  const port = parseInt(process.env.SFTP_PORT || '22', 10);
  const username = process.env.SFTP_USER;
  const password = process.env.SFTP_PASSWORD;
  const privateKeyPath = process.env.SFTP_PRIVATE_KEY_PATH;

  if (!host) {
    throw new Error('SFTP_HOST environment variable not set');
  }
  if (!username) {
    throw new Error('SFTP_USER environment variable not set');
  }
  if (!password && !privateKeyPath) {
    throw new Error('Either SFTP_PASSWORD or SFTP_PRIVATE_KEY_PATH must be set');
  }

  return {
    host,
    port,
    username,
    password,
    privateKeyPath,
  };
}

/**
 * Get remote paths from environment variables
 */
export function getRemotePaths(): { indexPath: string; mapPath: string } {
  return {
    indexPath: process.env.SFTP_REMOTE_INDEX_PATH || '/data/index',
    mapPath: process.env.SFTP_REMOTE_MAP_PATH || '/data/map',
  };
}

// =============================================================================
// SFTP Sync Service
// =============================================================================

export class SFTPSyncService {
  private config: SFTPConfig;
  private client: Client;
  private remotePaths: { indexPath: string; mapPath: string };

  constructor(config?: SFTPConfig) {
    this.config = config || getSFTPConfigFromEnv();
    this.client = new Client();
    this.remotePaths = getRemotePaths();
  }

  /**
   * Connect to SFTP server
   */
  private async connect(): Promise<void> {
    logger.info(`Connecting to SFTP server ${this.config.host}:${this.config.port}...`);

    const connectConfig: Client.ConnectOptions = {
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
    };

    // Use password or private key
    if (this.config.password) {
      connectConfig.password = this.config.password;
    } else if (this.config.privateKeyPath) {
      const keyContent = await fs.readFile(this.config.privateKeyPath);
      connectConfig.privateKey = keyContent;
    } else if (this.config.privateKey) {
      connectConfig.privateKey = this.config.privateKey;
    }

    await this.client.connect(connectConfig);
    logger.info('SFTP connection established');
  }

  /**
   * Disconnect from SFTP server
   */
  private async disconnect(): Promise<void> {
    await this.client.end();
    logger.info('SFTP connection closed');
  }

  /**
   * Generate backup suffix (timestamp-based)
   */
  private generateBackupSuffix(): string {
    const now = new Date();
    const date = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const time = now.toTimeString().split(' ')[0].replace(/:/g, ''); // HHMMSS
    return `.backup-${date}-${time}`;
  }

  /**
   * Check if remote path exists
   */
  private async remoteExists(remotePath: string): Promise<boolean> {
    try {
      await this.client.stat(remotePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create remote directory if it doesn't exist
   */
  private async ensureRemoteDir(remotePath: string): Promise<void> {
    try {
      await this.client.mkdir(remotePath, true);
    } catch (error) {
      // Directory might already exist, that's OK
      const exists = await this.remoteExists(remotePath);
      if (!exists) {
        throw error;
      }
    }
  }

  /**
   * Backup a remote file or directory
   */
  private async backupRemote(
    remotePath: string,
    suffix: string,
    backupsCreated: string[]
  ): Promise<void> {
    const exists = await this.remoteExists(remotePath);
    if (!exists) {
      logger.debug(`Remote path ${remotePath} doesn't exist, skipping backup`);
      return;
    }

    const backupPath = `${remotePath}${suffix}`;
    logger.info(`Backing up ${remotePath} → ${backupPath}`);

    try {
      await this.client.rename(remotePath, backupPath);
      backupsCreated.push(backupPath);
    } catch (error) {
      logger.warn(`Failed to backup ${remotePath}: ${error}`);
      // Don't fail the whole sync if backup fails
    }
  }

  /**
   * Cleanup old backups, keeping only the most recent N
   */
  private async cleanupOldBackups(
    baseDir: string,
    filePattern: string,
    maxBackups: number
  ): Promise<void> {
    try {
      const listing = await this.client.list(baseDir);
      const backups = listing
        .filter((item) => item.name.startsWith(filePattern) && item.name.includes('.backup-'))
        .sort((a, b) => (b.modifyTime || 0) - (a.modifyTime || 0));

      if (backups.length > maxBackups) {
        const toDelete = backups.slice(maxBackups);
        for (const backup of toDelete) {
          const fullPath = path.posix.join(baseDir, backup.name);
          logger.info(`Cleaning up old backup: ${fullPath}`);
          try {
            if (backup.type === 'd') {
              await this.client.rmdir(fullPath, true);
            } else {
              await this.client.delete(fullPath);
            }
          } catch (error) {
            logger.warn(`Failed to delete old backup ${fullPath}: ${error}`);
          }
        }
      }
    } catch (error) {
      logger.warn(`Failed to cleanup old backups in ${baseDir}: ${error}`);
    }
  }

  /**
   * Upload a single file
   */
  private async uploadFile(
    localPath: string,
    remotePath: string,
    dryRun: boolean,
    filesUploaded: string[]
  ): Promise<void> {
    if (dryRun) {
      logger.info(`[DRY RUN] Would upload: ${localPath} → ${remotePath}`);
      filesUploaded.push(remotePath);
      return;
    }

    logger.info(`Uploading: ${localPath} → ${remotePath}`);
    await this.client.put(localPath, remotePath);
    filesUploaded.push(remotePath);
  }

  /**
   * Upload a directory recursively
   */
  private async uploadDirectory(
    localDir: string,
    remoteDir: string,
    dryRun: boolean,
    filesUploaded: string[]
  ): Promise<void> {
    if (dryRun) {
      logger.info(`[DRY RUN] Would upload directory: ${localDir} → ${remoteDir}`);
      // List files for dry run reporting
      const files = await this.listLocalFilesRecursive(localDir);
      for (const file of files) {
        const relativePath = path.relative(localDir, file);
        const remotePath = path.posix.join(remoteDir, relativePath);
        filesUploaded.push(remotePath);
      }
      return;
    }

    logger.info(`Uploading directory: ${localDir} → ${remoteDir}`);
    await this.client.uploadDir(localDir, remoteDir);

    // Track uploaded files
    const files = await this.listLocalFilesRecursive(localDir);
    for (const file of files) {
      const relativePath = path.relative(localDir, file);
      const remotePath = path.posix.join(remoteDir, relativePath);
      filesUploaded.push(remotePath);
    }
  }

  /**
   * List all files in a local directory recursively
   */
  private async listLocalFilesRecursive(dir: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await this.listLocalFilesRecursive(fullPath);
        files.push(...subFiles);
      } else {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * Sync index database to SFTP
   * Local: data/tribal-knowledge.db → Remote: /data/index/index.db (RENAMED)
   */
  async syncIndex(
    localDbPath: string,
    options: SyncOptions = {}
  ): Promise<{ success: boolean; backupsCreated: string[]; filesUploaded: string[]; errors: string[] }> {
    const {
      backupBeforeUpload = true,
      backupSuffix = this.generateBackupSuffix(),
      maxBackups = 5,
      dryRun = false,
    } = options;

    const backupsCreated: string[] = [];
    const filesUploaded: string[] = [];
    const errors: string[] = [];

    // Check local file exists
    try {
      await fs.access(localDbPath);
    } catch {
      errors.push(`Local index database not found: ${localDbPath}`);
      return { success: false, backupsCreated, filesUploaded, errors };
    }

    const remoteIndexDir = this.remotePaths.indexPath;
    const remoteIndexFile = path.posix.join(remoteIndexDir, 'index.db');

    try {
      // Ensure remote directory exists
      if (!dryRun) {
        await this.ensureRemoteDir(remoteIndexDir);
      }

      // Backup existing remote file if needed
      if (backupBeforeUpload) {
        await this.backupRemote(remoteIndexFile, backupSuffix, backupsCreated);

        // Cleanup old backups
        if (!dryRun) {
          await this.cleanupOldBackups(remoteIndexDir, 'index.db', maxBackups);
        }
      }

      // Upload the database (renamed from tribal-knowledge.db to index.db)
      await this.uploadFile(localDbPath, remoteIndexFile, dryRun, filesUploaded);

      logger.info(`Index sync complete: ${localDbPath} → ${remoteIndexFile}`);
      return { success: true, backupsCreated, filesUploaded, errors };
    } catch (error) {
      const errorMsg = `Index sync failed: ${error}`;
      logger.error(errorMsg);
      errors.push(errorMsg);
      return { success: false, backupsCreated, filesUploaded, errors };
    }
  }

  /**
   * Sync documentation to SFTP
   * - docs/documentation-manifest.json → /data/map/documentation-manifest.json
   * - docs/databases/{db_name}/ → /data/map/{db_name}/
   */
  async syncDocs(
    localDocsPath: string,
    options: SyncOptions = {}
  ): Promise<{ success: boolean; backupsCreated: string[]; filesUploaded: string[]; errors: string[] }> {
    const {
      backupBeforeUpload = true,
      backupSuffix = this.generateBackupSuffix(),
      maxBackups = 5,
      dryRun = false,
    } = options;

    const backupsCreated: string[] = [];
    const filesUploaded: string[] = [];
    const errors: string[] = [];

    // Check local docs path exists
    try {
      await fs.access(localDocsPath);
    } catch {
      errors.push(`Local docs path not found: ${localDocsPath}`);
      return { success: false, backupsCreated, filesUploaded, errors };
    }

    const remoteMapDir = this.remotePaths.mapPath;

    try {
      // Ensure remote directory exists
      if (!dryRun) {
        await this.ensureRemoteDir(remoteMapDir);
      }

      // 1. Upload documentation-manifest.json
      const localManifest = path.join(localDocsPath, 'documentation-manifest.json');
      const remoteManifest = path.posix.join(remoteMapDir, 'documentation-manifest.json');

      try {
        await fs.access(localManifest);

        if (backupBeforeUpload) {
          await this.backupRemote(remoteManifest, backupSuffix, backupsCreated);
        }

        await this.uploadFile(localManifest, remoteManifest, dryRun, filesUploaded);
      } catch {
        logger.warn(`documentation-manifest.json not found at ${localManifest}, skipping`);
      }

      // 2. Upload database folders from docs/databases/
      const localDatabasesDir = path.join(localDocsPath, 'databases');
      try {
        await fs.access(localDatabasesDir);
        const dbFolders = await fs.readdir(localDatabasesDir, { withFileTypes: true });

        for (const folder of dbFolders) {
          if (!folder.isDirectory()) continue;

          const localDbDir = path.join(localDatabasesDir, folder.name);
          const remoteDbDir = path.posix.join(remoteMapDir, folder.name);

          // Backup existing remote folder if needed
          if (backupBeforeUpload) {
            await this.backupRemote(remoteDbDir, backupSuffix, backupsCreated);

            // Cleanup old backups for this database
            if (!dryRun) {
              await this.cleanupOldBackups(remoteMapDir, folder.name, maxBackups);
            }
          }

          // Upload the database documentation folder
          await this.uploadDirectory(localDbDir, remoteDbDir, dryRun, filesUploaded);
        }
      } catch {
        logger.warn(`databases/ directory not found at ${localDatabasesDir}, skipping`);
      }

      logger.info(`Docs sync complete: ${localDocsPath} → ${remoteMapDir}`);
      return { success: true, backupsCreated, filesUploaded, errors };
    } catch (error) {
      const errorMsg = `Docs sync failed: ${error}`;
      logger.error(errorMsg);
      errors.push(errorMsg);
      return { success: false, backupsCreated, filesUploaded, errors };
    }
  }

  /**
   * Full sync: index + docs
   */
  async syncAll(
    localDbPath: string,
    localDocsPath: string,
    options: SyncOptions = {}
  ): Promise<SyncResult> {
    const {
      skipIndex = false,
      skipDocs = false,
      dryRun = false,
    } = options;

    const result: SyncResult = {
      success: true,
      indexSynced: false,
      docsSynced: false,
      backupsCreated: [],
      filesUploaded: [],
      errors: [],
      dryRun,
    };

    try {
      // Connect to SFTP server
      if (!dryRun) {
        await this.connect();
      } else {
        logger.info('[DRY RUN] Would connect to SFTP server');
      }

      // Sync index database
      if (!skipIndex) {
        const indexResult = await this.syncIndex(localDbPath, options);
        result.indexSynced = indexResult.success;
        result.backupsCreated.push(...indexResult.backupsCreated);
        result.filesUploaded.push(...indexResult.filesUploaded);
        result.errors.push(...indexResult.errors);
        if (!indexResult.success) {
          result.success = false;
        }
      }

      // Sync documentation
      if (!skipDocs) {
        const docsResult = await this.syncDocs(localDocsPath, options);
        result.docsSynced = docsResult.success;
        result.backupsCreated.push(...docsResult.backupsCreated);
        result.filesUploaded.push(...docsResult.filesUploaded);
        result.errors.push(...docsResult.errors);
        if (!docsResult.success) {
          result.success = false;
        }
      }

      // Disconnect
      if (!dryRun) {
        await this.disconnect();
      }

      // Log summary
      logger.info('=== SFTP Sync Summary ===');
      logger.info(`Status: ${result.success ? 'SUCCESS' : 'FAILED'}`);
      logger.info(`Index synced: ${result.indexSynced}`);
      logger.info(`Docs synced: ${result.docsSynced}`);
      logger.info(`Backups created: ${result.backupsCreated.length}`);
      logger.info(`Files uploaded: ${result.filesUploaded.length}`);
      if (result.errors.length > 0) {
        logger.error(`Errors: ${result.errors.join(', ')}`);
      }
      if (dryRun) {
        logger.info('[DRY RUN] No actual changes were made');
      }

      return result;
    } catch (error) {
      result.success = false;
      result.errors.push(`Sync failed: ${error}`);
      logger.error(`SFTP sync failed: ${error}`);

      // Try to disconnect gracefully
      try {
        if (!dryRun) {
          await this.disconnect();
        }
      } catch {
        // Ignore disconnect errors
      }

      return result;
    }
  }
}

/**
 * Quick sync function for CLI usage
 */
export async function syncToSFTP(options: SyncOptions = {}): Promise<SyncResult> {
  const cwd = process.cwd();
  const localDbPath = process.env.TRIBAL_DB_PATH || path.join(cwd, 'data', 'tribal-knowledge.db');
  const localDocsPath = process.env.TRIBAL_DOCS_PATH || path.join(cwd, 'docs');

  const service = new SFTPSyncService();
  return service.syncAll(localDbPath, localDocsPath, options);
}

