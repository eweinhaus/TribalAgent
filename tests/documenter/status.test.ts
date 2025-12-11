/**
 * Unit tests for status computation
 */

import { describe, it, expect } from 'vitest';
import {
  computeTableStatus,
  computeWorkUnitStatus,
  computeOverallStatus,
} from '../status.js';
import type { WorkUnitProgress, TableResult } from '../types.js';

describe('Status Computation', () => {
  describe('computeTableStatus', () => {
    it('should return succeeded status for successful table', () => {
      const result = computeTableStatus('db.schema.table', true);
      expect(result.succeeded).toBe(true);
      expect(result.table).toBe('db.schema.table');
      expect(result.error).toBeUndefined();
    });

    it('should return failed status with error', () => {
      const error = {
        code: 'TEST_ERROR',
        message: 'Test error',
        severity: 'error' as const,
        timestamp: new Date().toISOString(),
        recoverable: true,
      };
      const result = computeTableStatus('db.schema.table', false, error);
      expect(result.succeeded).toBe(false);
      expect(result.error).toEqual(error);
    });
  });

  describe('computeWorkUnitStatus', () => {
    it('should return completed for empty work unit', () => {
      const status = computeWorkUnitStatus([]);
      expect(status).toBe('completed');
    });

    it('should return completed when all tables succeeded', () => {
      const tables: TableResult[] = [
        { table: 'db.schema.table1', succeeded: true },
        { table: 'db.schema.table2', succeeded: true },
      ];
      const status = computeWorkUnitStatus(tables);
      expect(status).toBe('completed');
    });

    it('should return failed when all tables failed', () => {
      const tables: TableResult[] = [
        { table: 'db.schema.table1', succeeded: false },
        { table: 'db.schema.table2', succeeded: false },
      ];
      const status = computeWorkUnitStatus(tables);
      expect(status).toBe('failed');
    });

    it('should return partial when some tables succeeded and some failed', () => {
      const tables: TableResult[] = [
        { table: 'db.schema.table1', succeeded: true },
        { table: 'db.schema.table2', succeeded: false },
      ];
      const status = computeWorkUnitStatus(tables);
      expect(status).toBe('partial');
    });

    it('should return partial when connection lost but some tables succeeded', () => {
      const tables: TableResult[] = [
        { table: 'db.schema.table1', succeeded: true },
      ];
      const status = computeWorkUnitStatus(tables, true);
      expect(status).toBe('partial');
    });

    it('should return failed when connection lost and no tables succeeded', () => {
      const tables: TableResult[] = [];
      const status = computeWorkUnitStatus(tables, true);
      expect(status).toBe('failed');
    });
  });

  describe('computeOverallStatus', () => {
    it('should return completed when all work units completed', () => {
      const workUnits: WorkUnitProgress[] = [
        { work_unit_id: 'wu1', status: 'completed', tables_total: 10, tables_completed: 10, tables_failed: 0, tables_skipped: 0, errors: [], output_files: [] },
        { work_unit_id: 'wu2', status: 'completed', tables_total: 5, tables_completed: 5, tables_failed: 0, tables_skipped: 0, errors: [], output_files: [] },
      ];
      const status = computeOverallStatus(workUnits);
      expect(status).toBe('completed');
    });

    it('should return failed when all work units failed', () => {
      const workUnits: WorkUnitProgress[] = [
        { work_unit_id: 'wu1', status: 'failed', tables_total: 10, tables_completed: 0, tables_failed: 10, tables_skipped: 0, errors: [], output_files: [] },
        { work_unit_id: 'wu2', status: 'failed', tables_total: 5, tables_completed: 0, tables_failed: 5, tables_skipped: 0, errors: [], output_files: [] },
      ];
      const status = computeOverallStatus(workUnits);
      expect(status).toBe('failed');
    });

    it('should return partial when any work unit is partial', () => {
      const workUnits: WorkUnitProgress[] = [
        { work_unit_id: 'wu1', status: 'completed', tables_total: 10, tables_completed: 10, tables_failed: 0, tables_skipped: 0, errors: [], output_files: [] },
        { work_unit_id: 'wu2', status: 'partial', tables_total: 5, tables_completed: 3, tables_failed: 2, tables_skipped: 0, errors: [], output_files: [] },
      ];
      const status = computeOverallStatus(workUnits);
      expect(status).toBe('partial');
    });

    it('should return failed when fatal error occurred', () => {
      const workUnits: WorkUnitProgress[] = [
        { work_unit_id: 'wu1', status: 'completed', tables_total: 10, tables_completed: 10, tables_failed: 0, tables_skipped: 0, errors: [], output_files: [] },
      ];
      const status = computeOverallStatus(workUnits, true);
      expect(status).toBe('failed');
    });

    it('should return partial when some work units are pending', () => {
      const workUnits: WorkUnitProgress[] = [
        { work_unit_id: 'wu1', status: 'completed', tables_total: 10, tables_completed: 10, tables_failed: 0, tables_skipped: 0, errors: [], output_files: [] },
        { work_unit_id: 'wu2', status: 'running', tables_total: 5, tables_completed: 2, tables_failed: 0, tables_skipped: 0, errors: [], output_files: [] },
      ];
      const status = computeOverallStatus(workUnits);
      expect(status).toBe('partial');
    });
  });
});
