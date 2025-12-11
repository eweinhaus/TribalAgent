/**
 * Unit tests for error handling
 */

import { describe, it, expect } from 'vitest';
import { createAgentError, ErrorCodes } from '../errors.js';

describe('Error Handling', () => {
  describe('createAgentError', () => {
    it('should create error with all required fields', () => {
      const error = createAgentError(
        'TEST_ERROR',
        'Test error message',
        'error',
        true,
        { key: 'value' }
      );

      expect(error.code).toBe('TEST_ERROR');
      expect(error.message).toBe('Test error message');
      expect(error.severity).toBe('error');
      expect(error.recoverable).toBe(true);
      expect(error.context).toEqual({ key: 'value' });
      expect(error.timestamp).toBeDefined();
      expect(new Date(error.timestamp).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should create error without context', () => {
      const error = createAgentError(
        'TEST_ERROR',
        'Test error message',
        'warning',
        false
      );

      expect(error.code).toBe('TEST_ERROR');
      expect(error.context).toBeUndefined();
    });

    it('should use correct error codes', () => {
      expect(ErrorCodes.DOC_PLAN_NOT_FOUND).toBe('DOC_PLAN_NOT_FOUND');
      expect(ErrorCodes.DOC_PLAN_INVALID).toBe('DOC_PLAN_INVALID');
      expect(ErrorCodes.DOC_PLAN_STALE).toBe('DOC_PLAN_STALE');
      expect(ErrorCodes.DOC_DB_CONNECTION_LOST).toBe('DOC_DB_CONNECTION_LOST');
      expect(ErrorCodes.DOC_WORK_UNIT_FAILED).toBe('DOC_WORK_UNIT_FAILED');
    });
  });
});
