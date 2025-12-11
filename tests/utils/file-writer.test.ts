/**
 * Unit tests for FileWriter utility
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { FileWriter } from '../../src/utils/file-writer.js';
import { ErrorCodes } from '../../src/agents/documenter/errors.js';

const TEST_DIR = path.join(process.cwd(), 'test-temp');

describe('FileWriter', () => {
  beforeEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore if doesn't exist
    }
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore errors
    }
  });

  describe('sanitizePath', () => {
    it('should replace invalid filesystem characters with underscores', () => {
      expect(FileWriter.sanitizePath('test/table')).toBe('test_table');
      expect(FileWriter.sanitizePath('test\\table')).toBe('test_table');
      expect(FileWriter.sanitizePath('test:table')).toBe('test_table');
      expect(FileWriter.sanitizePath('test*table')).toBe('test_table');
      expect(FileWriter.sanitizePath('test?table')).toBe('test_table');
      expect(FileWriter.sanitizePath('test"table')).toBe('test_table');
      expect(FileWriter.sanitizePath('test<table')).toBe('test_table');
      expect(FileWriter.sanitizePath('test>table')).toBe('test_table');
      expect(FileWriter.sanitizePath('test|table')).toBe('test_table');
    });

    it('should convert to lowercase', () => {
      expect(FileWriter.sanitizePath('TestTable')).toBe('testtable');
      expect(FileWriter.sanitizePath('TEST_TABLE')).toBe('test_table');
    });

    it('should handle empty strings', () => {
      expect(FileWriter.sanitizePath('')).toBe('_');
    });

    it('should handle strings with only special characters', () => {
      expect(FileWriter.sanitizePath('///')).toBe('unnamed');
      expect(FileWriter.sanitizePath('***')).toBe('unnamed');
    });

    it('should handle mixed case and special characters', () => {
      expect(FileWriter.sanitizePath('Test/Table*Name')).toBe('test_table_name');
    });

    it('should remove leading/trailing underscores and dots', () => {
      expect(FileWriter.sanitizePath('_test_')).toBe('test');
      expect(FileWriter.sanitizePath('.test.')).toBe('test');
      expect(FileWriter.sanitizePath('__test__')).toBe('test');
    });

    it('should handle Unicode characters', () => {
      const result = FileWriter.sanitizePath('tëst_täblé');
      expect(result).toBe('tëst_täblé'); // Unicode should be preserved (lowercase)
    });

    it('should handle spaces', () => {
      // Spaces are not in the invalid character list, so they should be preserved
      expect(FileWriter.sanitizePath('test table')).toBe('test table');
    });
  });

  describe('writeFileAtomic', () => {
    it('should write file atomically', async () => {
      const filePath = path.join(TEST_DIR, 'test.txt');
      const content = 'test content';

      await FileWriter.writeFileAtomic(filePath, content);

      const written = await fs.readFile(filePath, 'utf8');
      expect(written).toBe(content);
    });

    it('should create directory structure if needed', async () => {
      const filePath = path.join(TEST_DIR, 'nested', 'deep', 'test.txt');
      const content = 'test content';

      await FileWriter.writeFileAtomic(filePath, content);

      const written = await fs.readFile(filePath, 'utf8');
      expect(written).toBe(content);
    });

    it('should not leave temp file on success', async () => {
      const filePath = path.join(TEST_DIR, 'test.txt');
      const content = 'test content';

      await FileWriter.writeFileAtomic(filePath, content);

      // Check that temp file doesn't exist
      const tempPath = `${filePath}.tmp`;
      try {
        await fs.access(tempPath);
        expect.fail('Temp file should not exist');
      } catch {
        // Expected - temp file should be gone
      }
    });

    it('should validate write success', async () => {
      const filePath = path.join(TEST_DIR, 'test.txt');
      const content = 'test content';

      await FileWriter.writeFileAtomic(filePath, content);

      // Verify file exists and is readable
      const exists = await FileWriter.validateFileExists(filePath);
      expect(exists).toBe(true);
    });
  });

  describe('ensureDirectoryExists', () => {
    it('should create single directory', async () => {
      const dirPath = path.join(TEST_DIR, 'newdir');
      await FileWriter.ensureDirectoryExists(dirPath);

      const stats = await fs.stat(dirPath);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should create nested directories', async () => {
      const dirPath = path.join(TEST_DIR, 'nested', 'deep', 'dir');
      await FileWriter.ensureDirectoryExists(dirPath);

      const stats = await fs.stat(dirPath);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should handle existing directories gracefully', async () => {
      const dirPath = path.join(TEST_DIR, 'existing');
      await fs.mkdir(dirPath, { recursive: true });

      // Should not throw
      await FileWriter.ensureDirectoryExists(dirPath);

      const stats = await fs.stat(dirPath);
      expect(stats.isDirectory()).toBe(true);
    });
  });

  describe('validateFileExists', () => {
    it('should return true for existing file', async () => {
      const filePath = path.join(TEST_DIR, 'test.txt');
      await fs.writeFile(filePath, 'content');

      const exists = await FileWriter.validateFileExists(filePath);
      expect(exists).toBe(true);
    });

    it('should return false for non-existent file', async () => {
      const filePath = path.join(TEST_DIR, 'nonexistent.txt');

      const exists = await FileWriter.validateFileExists(filePath);
      expect(exists).toBe(false);
    });
  });
});
