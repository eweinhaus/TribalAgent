/**
 * Hash Utilities
 *
 * Utilities for computing content hashes used for change detection and
 * staleness checks throughout the system.
 *
 * @module utils/hash
 */

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import type { ContentHash, TableMetadata } from '../contracts/types.js';

/**
 * Compute SHA-256 hash of content.
 * Returns a 64-character hex string.
 */
export function computeHash(content: string | Buffer): ContentHash {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Compute hash of a config file (e.g., databases.yaml).
 * Used for staleness detection of plans.
 */
export async function computeConfigHash(configPath: string): Promise<ContentHash> {
  const content = await fs.readFile(configPath, 'utf-8');
  return computeHash(content);
}

/**
 * Compute deterministic schema hash for change detection.
 * Hash includes: table names, column names, column types (sorted for stability).
 * Does NOT include: row counts, comments, or other volatile metadata.
 */
export function computeSchemaHash(tables: TableMetadata[]): ContentHash {
  // Sort tables by name for deterministic ordering
  const sortedTables = [...tables].sort((a, b) => {
    const nameA = a.name || `${a.table_schema}.${a.table_name}`;
    const nameB = b.name || `${b.table_schema}.${b.table_name}`;
    return nameA.localeCompare(nameB);
  });

  const hashInput = sortedTables.map((table) => ({
    name: table.name || `${table.table_schema}.${table.table_name}`,
    columns: (table.columns || [])
      .sort((a, b) => a.column_name.localeCompare(b.column_name))
      .map((col) => `${col.column_name}:${col.data_type}:${col.is_nullable}`),
  }));

  return computeHash(JSON.stringify(hashInput));
}

/**
 * Compute metadata hash for a single table (used in TableSpec.metadata_hash).
 * More granular than schema hash - detects column-level changes.
 */
export function computeTableMetadataHash(table: TableMetadata): ContentHash {
  const hashInput = {
    name: table.name || `${table.table_schema}.${table.table_name}`,
    columns: (table.columns || [])
      .sort((a, b) => a.column_name.localeCompare(b.column_name))
      .map((col) => ({
        name: col.column_name,
        type: col.data_type,
        nullable: col.is_nullable,
        default: col.column_default,
      })),
    primaryKey: table.primary_key?.sort(),
    foreignKeys: (table.foreign_keys || [])
      .sort((a, b) => a.constraint_name.localeCompare(b.constraint_name))
      .map((fk) => `${fk.column_name}->${fk.referenced_table}`),
  };

  return computeHash(JSON.stringify(hashInput));
}

/**
 * Compute content hash for a WorkUnit.
 * Used for incremental re-documentation detection.
 */
export function computeWorkUnitHash(tables: { metadata_hash: ContentHash }[]): ContentHash {
  // Sort by metadata_hash for deterministic ordering
  const sortedHashes = tables.map((t) => t.metadata_hash).sort();
  return computeHash(sortedHashes.join(':'));
}

/**
 * Compute hash for an arbitrary JSON object.
 * Useful for comparing structured data.
 */
export function computeJsonHash(obj: unknown): ContentHash {
  return computeHash(JSON.stringify(obj, Object.keys(obj as object).sort()));
}

/**
 * Verify a hash matches expected value.
 */
export function verifyHash(content: string | Buffer, expectedHash: ContentHash): boolean {
  const actualHash = computeHash(content);
  return actualHash === expectedHash;
}
