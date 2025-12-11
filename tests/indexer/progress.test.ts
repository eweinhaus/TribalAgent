/**
 * Unit Tests for Progress and Resume Support Module
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  initializeProgress,
  updateProgressForFile,
  shouldSaveCheckpoint,
  updatePhase,
  markCompleted,
  markFailed,
  getProgressSummary,
  updateDocTypeCounts,
  updateTimingStats,
  updateEmbeddingStats,
  getCheckpointInterval,
} from '../../src/agents/indexer/progress.js';
import type { DocumentationManifest, IndexerProgress } from '../../src/agents/indexer/types.js';

describe('Progress Module', () => {
  const mockManifest: DocumentationManifest = {
    schema_version: '1.0',
    completed_at: '2024-01-15T10:00:00Z',
    plan_hash: 'abc123',
    status: 'complete',
    databases: [{
      name: 'test_db',
      connection_name: 'test',
      table_count: 10,
      status: 'complete',
    }],
    work_units: [{
      id: 'test_db_sales',
      database: 'test_db',
      table_count: 5,
      status: 'complete',
    }],
    total_files: 5,
    indexable_files: [
      { path: 'file1.md', type: 'table', database: 'test_db', content_hash: 'hash1', size_bytes: 100, modified_at: '2024-01-15T10:00:00Z' },
      { path: 'file2.md', type: 'table', database: 'test_db', content_hash: 'hash2', size_bytes: 100, modified_at: '2024-01-15T10:00:00Z' },
      { path: 'file3.md', type: 'domain', database: 'test_db', content_hash: 'hash3', size_bytes: 100, modified_at: '2024-01-15T10:00:00Z' },
    ],
  };

  let progress: IndexerProgress;

  beforeEach(() => {
    progress = initializeProgress(mockManifest);
  });

  describe('initializeProgress', () => {
    it('creates progress with correct initial state', () => {
      expect(progress.schema_version).toBe('1.0');
      expect(progress.status).toBe('running');
      expect(progress.files_total).toBe(3);
      expect(progress.files_indexed).toBe(0);
      expect(progress.files_failed).toBe(0);
      expect(progress.current_phase).toBe('validating');
    });

    it('sets up pending files from manifest', () => {
      expect(progress.pending_files).toHaveLength(3);
      expect(progress.pending_files).toContain('file1.md');
      expect(progress.pending_files).toContain('file2.md');
      expect(progress.pending_files).toContain('file3.md');
    });

    it('initializes empty indexed and failed files', () => {
      expect(progress.indexed_files).toHaveLength(0);
      expect(progress.failed_files).toHaveLength(0);
    });

    it('initializes stats to zero', () => {
      expect(progress.stats.parse_time_ms).toBe(0);
      expect(progress.stats.embedding_time_ms).toBe(0);
      expect(progress.stats.index_time_ms).toBe(0);
      expect(progress.stats.table_docs).toBe(0);
    });
  });

  describe('updateProgressForFile', () => {
    it('updates progress on successful file', () => {
      updateProgressForFile(progress, 'file1.md', true);

      expect(progress.files_indexed).toBe(1);
      expect(progress.indexed_files).toContain('file1.md');
      expect(progress.pending_files).not.toContain('file1.md');
      expect(progress.current_file).toBe('file1.md');
    });

    it('updates progress on failed file', () => {
      const error = new Error('Parse error');
      updateProgressForFile(progress, 'file1.md', false, error);

      expect(progress.files_failed).toBe(1);
      expect(progress.failed_files).toContain('file1.md');
      expect(progress.pending_files).not.toContain('file1.md');
      expect(progress.errors).toHaveLength(1);
      expect(progress.errors[0].message).toBe('Parse error');
    });

    it('removes file from pending list', () => {
      expect(progress.pending_files).toContain('file1.md');
      updateProgressForFile(progress, 'file1.md', true);
      expect(progress.pending_files).not.toContain('file1.md');
    });
  });

  describe('shouldSaveCheckpoint', () => {
    it('returns true at checkpoint interval', () => {
      const interval = getCheckpointInterval();
      progress.files_indexed = interval;
      expect(shouldSaveCheckpoint(progress)).toBe(true);
    });

    it('returns true at multiples of interval', () => {
      const interval = getCheckpointInterval();
      progress.files_indexed = interval * 2;
      expect(shouldSaveCheckpoint(progress)).toBe(true);
    });

    it('returns false between intervals', () => {
      progress.files_indexed = 5;
      expect(shouldSaveCheckpoint(progress)).toBe(false);
    });
  });

  describe('updatePhase', () => {
    it('updates current phase', () => {
      updatePhase(progress, 'parsing');
      expect(progress.current_phase).toBe('parsing');

      updatePhase(progress, 'embedding');
      expect(progress.current_phase).toBe('embedding');

      updatePhase(progress, 'indexing');
      expect(progress.current_phase).toBe('indexing');
    });
  });

  describe('markCompleted', () => {
    it('sets status to completed when no failures', () => {
      progress.files_failed = 0;
      markCompleted(progress);

      expect(progress.status).toBe('completed');
      expect(progress.completed_at).toBeTruthy();
    });

    it('sets status to partial when there are failures', () => {
      progress.files_failed = 1;
      markCompleted(progress);

      expect(progress.status).toBe('partial');
    });

    it('calculates total time', () => {
      progress.started_at = new Date(Date.now() - 5000).toISOString();
      markCompleted(progress);

      expect(progress.stats.total_time_ms).toBeGreaterThan(0);
    });
  });

  describe('markFailed', () => {
    it('sets status to failed', () => {
      const error = new Error('Fatal error');
      markFailed(progress, error);

      expect(progress.status).toBe('failed');
      expect(progress.completed_at).toBeTruthy();
      expect(progress.errors).toHaveLength(1);
    });
  });

  describe('updateDocTypeCounts', () => {
    it('updates doc type counts', () => {
      updateDocTypeCounts(progress, {
        table: 10,
        column: 50,
        domain: 3,
        relationship: 5,
      });

      expect(progress.stats.table_docs).toBe(10);
      expect(progress.stats.column_docs).toBe(50);
      expect(progress.stats.domain_docs).toBe(3);
      expect(progress.stats.relationship_docs).toBe(5);
    });

    it('handles partial updates', () => {
      updateDocTypeCounts(progress, { table: 10 });
      expect(progress.stats.table_docs).toBe(10);
      expect(progress.stats.column_docs).toBe(0);
    });
  });

  describe('updateTimingStats', () => {
    it('accumulates timing stats', () => {
      updateTimingStats(progress, { parse_time_ms: 100 });
      updateTimingStats(progress, { parse_time_ms: 50 });

      expect(progress.stats.parse_time_ms).toBe(150);
    });

    it('handles multiple timing types', () => {
      updateTimingStats(progress, {
        parse_time_ms: 100,
        embedding_time_ms: 200,
        index_time_ms: 50,
      });

      expect(progress.stats.parse_time_ms).toBe(100);
      expect(progress.stats.embedding_time_ms).toBe(200);
      expect(progress.stats.index_time_ms).toBe(50);
    });
  });

  describe('updateEmbeddingStats', () => {
    it('accumulates embedding stats', () => {
      updateEmbeddingStats(progress, 10, 2);
      updateEmbeddingStats(progress, 5, 1);

      expect(progress.embeddings_generated).toBe(15);
      expect(progress.embeddings_failed).toBe(3);
    });
  });

  describe('getProgressSummary', () => {
    it('returns formatted summary string', () => {
      progress.status = 'running';
      progress.files_indexed = 5;
      progress.files_total = 10;
      progress.current_phase = 'indexing';

      const summary = getProgressSummary(progress);

      expect(summary).toContain('Status: running');
      expect(summary).toContain('5/10');
      expect(summary).toContain('indexing');
    });

    it('includes failure count when present', () => {
      progress.files_failed = 2;
      const summary = getProgressSummary(progress);

      expect(summary).toContain('Failed: 2');
    });

    it('includes embedding count when present', () => {
      progress.embeddings_generated = 100;
      const summary = getProgressSummary(progress);

      expect(summary).toContain('Embeddings: 100');
    });
  });
});
