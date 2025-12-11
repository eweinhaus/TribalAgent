/**
 * Unit Tests for Index Population Module
 */

import { describe, it, expect } from 'vitest';
import {
  sortDocumentsForIndexing,
  getDocumentIdentity,
} from '../../src/agents/indexer/populate.js';
import type {
  ParsedDocument,
  ParsedTableDoc,
  ParsedColumnDoc,
  ParsedDomainDoc,
  ParsedRelationshipDoc,
} from '../../src/agents/indexer/types.js';

describe('sortDocumentsForIndexing', () => {
  const mockTableDoc: ParsedTableDoc = {
    docType: 'table',
    database: 'test_db',
    schema: 'public',
    table: 'users',
    domain: 'auth',
    description: 'Users table',
    columns: [],
    primaryKey: [],
    foreignKeys: [],
    indexes: [],
    rowCount: 100,
    keywords: [],
    rawContent: '',
  };

  const mockColumnDoc: ParsedColumnDoc = {
    docType: 'column',
    database: 'test_db',
    schema: 'public',
    table: 'users',
    column: 'id',
    dataType: 'integer',
    nullable: false,
    isPrimaryKey: true,
    isForeignKey: false,
    description: 'Primary key',
    keywords: [],
    parentTablePath: 'databases/test_db/tables/public.users.md',
    rawContent: '',
  };

  const mockDomainDoc: ParsedDomainDoc = {
    docType: 'domain',
    database: 'test_db',
    domain: 'auth',
    description: 'Authentication domain',
    tables: ['users'],
    keywords: [],
    rawContent: '',
  };

  const mockRelationshipDoc: ParsedRelationshipDoc = {
    docType: 'relationship',
    database: 'test_db',
    sourceSchema: 'public',
    sourceTable: 'orders',
    sourceColumn: 'user_id',
    targetSchema: 'public',
    targetTable: 'users',
    targetColumn: 'id',
    relationshipType: 'foreign_key',
    description: 'Orders belong to users',
    joinCondition: 'orders.user_id = users.id',
    keywords: [],
    rawContent: '',
  };

  it('sorts tables before columns', () => {
    const docs: ParsedDocument[] = [mockColumnDoc, mockTableDoc];
    const sorted = sortDocumentsForIndexing(docs);

    expect(sorted[0].docType).toBe('table');
    expect(sorted[1].docType).toBe('column');
  });

  it('sorts in order: tables, domains, overviews, relationships, columns', () => {
    const docs: ParsedDocument[] = [
      mockColumnDoc,
      mockRelationshipDoc,
      mockTableDoc,
      mockDomainDoc,
    ];
    const sorted = sortDocumentsForIndexing(docs);

    expect(sorted[0].docType).toBe('table');
    expect(sorted[1].docType).toBe('domain');
    expect(sorted[2].docType).toBe('relationship');
    expect(sorted[3].docType).toBe('column');
  });

  it('preserves relative order within same type', () => {
    const table1 = { ...mockTableDoc, table: 'aaa' };
    const table2 = { ...mockTableDoc, table: 'zzz' };
    const docs: ParsedDocument[] = [table1, table2];
    const sorted = sortDocumentsForIndexing(docs);

    expect((sorted[0] as ParsedTableDoc).table).toBe('aaa');
    expect((sorted[1] as ParsedTableDoc).table).toBe('zzz');
  });

  it('handles empty array', () => {
    const sorted = sortDocumentsForIndexing([]);
    expect(sorted).toEqual([]);
  });

  it('does not mutate original array', () => {
    const docs: ParsedDocument[] = [mockColumnDoc, mockTableDoc];
    const original = [...docs];
    sortDocumentsForIndexing(docs);

    expect(docs[0]).toBe(original[0]);
    expect(docs[1]).toBe(original[1]);
  });
});

describe('getDocumentIdentity', () => {
  it('generates identity for table doc', () => {
    const doc: ParsedTableDoc = {
      docType: 'table',
      database: 'test_db',
      schema: 'public',
      table: 'users',
      domain: 'auth',
      description: '',
      columns: [],
      primaryKey: [],
      foreignKeys: [],
      indexes: [],
      rowCount: 0,
      keywords: [],
      rawContent: '',
    };

    const identity = getDocumentIdentity(doc);
    expect(identity).toBe('test_db.public.users');
  });

  it('generates identity for column doc', () => {
    const doc: ParsedColumnDoc = {
      docType: 'column',
      database: 'test_db',
      schema: 'public',
      table: 'users',
      column: 'email',
      dataType: 'varchar',
      nullable: false,
      isPrimaryKey: false,
      isForeignKey: false,
      description: '',
      keywords: [],
      parentTablePath: '',
      rawContent: '',
    };

    const identity = getDocumentIdentity(doc);
    expect(identity).toBe('test_db.public.users.email');
  });

  it('generates identity for domain doc', () => {
    const doc: ParsedDomainDoc = {
      docType: 'domain',
      database: 'test_db',
      domain: 'auth',
      description: '',
      tables: [],
      keywords: [],
      rawContent: '',
    };

    const identity = getDocumentIdentity(doc);
    expect(identity).toBe('test_db.auth');
  });

  it('generates identity for relationship doc', () => {
    const doc: ParsedRelationshipDoc = {
      docType: 'relationship',
      database: 'test_db',
      sourceSchema: 'public',
      sourceTable: 'orders',
      sourceColumn: 'user_id',
      targetSchema: 'public',
      targetTable: 'users',
      targetColumn: 'id',
      relationshipType: 'foreign_key',
      description: '',
      joinCondition: '',
      keywords: [],
      rawContent: '',
    };

    const identity = getDocumentIdentity(doc);
    expect(identity).toBe('test_db.orders_to_users');
  });
});
