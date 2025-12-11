/**
 * Unit Tests for Keyword Extraction Module
 */

import { describe, it, expect } from 'vitest';
import {
  splitIdentifier,
  expandAbbreviations,
  extractKeywordsFromTable,
  extractKeywordsFromDomain,
  extractKeywordsFromRelationship,
  extractKeywordsFromOverview,
  extractNounsFromDescription,
  detectDataPatterns,
  ABBREVIATION_MAP,
} from '../../src/agents/indexer/keywords.js';
import type { ParsedTableDoc, ParsedDomainDoc, ParsedRelationshipDoc, ParsedOverviewDoc } from '../../src/agents/indexer/types.js';

describe('splitIdentifier', () => {
  it('splits snake_case identifiers', () => {
    expect(splitIdentifier('user_account')).toEqual(['user', 'account']);
    expect(splitIdentifier('order_line_items')).toEqual(['order', 'line', 'items']);
  });

  it('splits camelCase identifiers', () => {
    expect(splitIdentifier('userAccount')).toEqual(['user', 'account']);
    expect(splitIdentifier('orderLineItems')).toEqual(['order', 'line', 'items']);
  });

  it('splits mixed case identifiers', () => {
    expect(splitIdentifier('user_accountName')).toEqual(['user', 'account', 'name']);
  });

  it('handles single word identifiers', () => {
    expect(splitIdentifier('users')).toEqual(['users']);
    expect(splitIdentifier('ID')).toEqual(['id']);
  });

  it('handles empty string', () => {
    expect(splitIdentifier('')).toEqual([]);
  });
});

describe('expandAbbreviations', () => {
  it('expands common abbreviations', () => {
    expect(expandAbbreviations('cust')).toEqual(['customer', 'customers']);
    expect(expandAbbreviations('txn')).toEqual(['transaction', 'transactions']);
    expect(expandAbbreviations('amt')).toEqual(['amount']);
  });

  it('returns empty array for unknown abbreviations', () => {
    expect(expandAbbreviations('xyz')).toEqual([]);
    expect(expandAbbreviations('foobar')).toEqual([]);
  });

  it('is case insensitive', () => {
    expect(expandAbbreviations('CUST')).toEqual(['customer', 'customers']);
    expect(expandAbbreviations('Txn')).toEqual(['transaction', 'transactions']);
  });

  it('has reasonable coverage of database abbreviations', () => {
    const expectedAbbreviations = ['cust', 'usr', 'acct', 'txn', 'prd', 'ord', 'inv', 'emp'];
    for (const abbr of expectedAbbreviations) {
      expect(ABBREVIATION_MAP[abbr]).toBeDefined();
      expect(ABBREVIATION_MAP[abbr].length).toBeGreaterThan(0);
    }
  });
});

describe('detectDataPatterns', () => {
  it('detects email patterns', () => {
    const sample = [{ email: 'user@example.com' }];
    expect(detectDataPatterns(sample)).toContain('email');
  });

  it('detects URL patterns', () => {
    const sample = [{ website: 'https://example.com' }];
    expect(detectDataPatterns(sample)).toContain('url');
    expect(detectDataPatterns(sample)).toContain('link');
  });

  it('detects UUID patterns', () => {
    const sample = [{ id: '550e8400-e29b-41d4-a716-446655440000' }];
    expect(detectDataPatterns(sample)).toContain('uuid');
    expect(detectDataPatterns(sample)).toContain('unique identifier');
  });

  it('detects date patterns', () => {
    const sample = [{ created_at: '2024-01-15T10:30:00Z' }];
    expect(detectDataPatterns(sample)).toContain('date');
    expect(detectDataPatterns(sample)).toContain('temporal');
  });

  it('detects currency patterns', () => {
    const sample = [{ price: '$99.99' }];
    expect(detectDataPatterns(sample)).toContain('currency');
    expect(detectDataPatterns(sample)).toContain('money');
  });

  it('returns empty array for empty sample', () => {
    expect(detectDataPatterns([])).toEqual([]);
  });
});

describe('extractNounsFromDescription', () => {
  it('extracts database terms', () => {
    const desc = 'This table stores customer information with a foreign key to orders';
    const nouns = extractNounsFromDescription(desc);
    expect(nouns).toContain('table');
    expect(nouns).toContain('foreign');
    expect(nouns).toContain('key');
  });

  it('extracts capitalized words', () => {
    const desc = 'Customer data linked to Account records';
    const nouns = extractNounsFromDescription(desc);
    expect(nouns).toContain('customer');
    expect(nouns).toContain('account');
  });

  it('handles empty description', () => {
    expect(extractNounsFromDescription('')).toEqual([]);
    expect(extractNounsFromDescription(null as unknown as string)).toEqual([]);
  });

  it('filters short words', () => {
    const desc = 'A table for ID values';
    const nouns = extractNounsFromDescription(desc);
    expect(nouns).not.toContain('a');
    expect(nouns).not.toContain('id');
    expect(nouns).toContain('table');
  });
});

describe('extractKeywordsFromTable', () => {
  const mockTableDoc: ParsedTableDoc = {
    docType: 'table',
    database: 'test_db',
    schema: 'public',
    table: 'customer_orders',
    domain: 'sales',
    description: 'Stores customer order information',
    columns: [
      { name: 'order_id', dataType: 'integer', nullable: false, description: 'Primary key' },
      { name: 'customer_id', dataType: 'integer', nullable: false, description: 'Foreign key to customers' },
      { name: 'total_amount', dataType: 'decimal', nullable: true, description: 'Order total' },
    ],
    primaryKey: ['order_id'],
    foreignKeys: [
      { sourceColumn: 'customer_id', targetSchema: 'public', targetTable: 'customers', targetColumn: 'id' },
    ],
    indexes: [],
    rowCount: 1000,
    keywords: [],
    rawContent: '',
  };

  it('extracts table name parts', () => {
    const keywords = extractKeywordsFromTable(mockTableDoc);
    expect(keywords).toContain('customer');
    expect(keywords).toContain('orders');
  });

  it('expands abbreviations from table name', () => {
    const docWithAbbrev = { ...mockTableDoc, table: 'cust_txn' };
    const keywords = extractKeywordsFromTable(docWithAbbrev);
    expect(keywords).toContain('customer');
    expect(keywords).toContain('transaction');
  });

  it('includes domain', () => {
    const keywords = extractKeywordsFromTable(mockTableDoc);
    expect(keywords).toContain('sales');
  });

  it('includes column name parts', () => {
    const keywords = extractKeywordsFromTable(mockTableDoc);
    expect(keywords).toContain('order');
    expect(keywords).toContain('customer');
    expect(keywords).toContain('total');
    expect(keywords).toContain('amount');
  });

  it('includes foreign key target tables', () => {
    const keywords = extractKeywordsFromTable(mockTableDoc);
    expect(keywords).toContain('customers');
  });

  it('filters out short keywords', () => {
    const keywords = extractKeywordsFromTable(mockTableDoc);
    expect(keywords.every(k => k.length > 2)).toBe(true);
  });
});

describe('extractKeywordsFromDomain', () => {
  const mockDomainDoc: ParsedDomainDoc = {
    docType: 'domain',
    database: 'test_db',
    domain: 'user_management',
    description: 'Handles user accounts and authentication',
    tables: ['users', 'user_roles', 'permissions'],
    keywords: [],
    rawContent: '',
  };

  it('extracts domain name parts', () => {
    const keywords = extractKeywordsFromDomain(mockDomainDoc);
    expect(keywords).toContain('user');
    expect(keywords).toContain('management');
  });

  it('includes table names', () => {
    const keywords = extractKeywordsFromDomain(mockDomainDoc);
    expect(keywords).toContain('users');
    expect(keywords).toContain('roles');
    expect(keywords).toContain('permissions');
  });
});

describe('extractKeywordsFromRelationship', () => {
  const mockRelDoc: ParsedRelationshipDoc = {
    docType: 'relationship',
    database: 'test_db',
    sourceSchema: 'public',
    sourceTable: 'orders',
    sourceColumn: 'customer_id',
    targetSchema: 'public',
    targetTable: 'customers',
    targetColumn: 'id',
    relationshipType: 'foreign_key',
    description: 'Orders belong to customers',
    joinCondition: 'orders.customer_id = customers.id',
    keywords: [],
    rawContent: '',
  };

  it('extracts source and target table names', () => {
    const keywords = extractKeywordsFromRelationship(mockRelDoc);
    expect(keywords).toContain('orders');
    expect(keywords).toContain('customers');
  });

  it('includes relationship type', () => {
    const keywords = extractKeywordsFromRelationship(mockRelDoc);
    expect(keywords).toContain('foreign_key');
  });

  it('includes join-related keywords', () => {
    const keywords = extractKeywordsFromRelationship(mockRelDoc);
    expect(keywords).toContain('join');
    expect(keywords).toContain('relationship');
  });

  it('adds semantic keywords for relationship types', () => {
    const keywords = extractKeywordsFromRelationship(mockRelDoc);
    expect(keywords).toContain('reference');
  });
});

describe('extractKeywordsFromOverview', () => {
  const mockOverviewDoc: ParsedOverviewDoc = {
    docType: 'overview',
    database: 'test_db',
    title: 'E-Commerce Database Overview',
    description: 'This database manages products and orders for the online store',
    sections: [
      { heading: 'Products', content: 'Product catalog management' },
      { heading: 'Orders', content: 'Order processing workflow' },
    ],
    keywords: [],
    rawContent: '',
  };

  it('extracts title words', () => {
    const keywords = extractKeywordsFromOverview(mockOverviewDoc);
    expect(keywords).toContain('ecommerce');
    expect(keywords).toContain('database');
    expect(keywords).toContain('overview');
  });

  it('extracts section headings', () => {
    const keywords = extractKeywordsFromOverview(mockOverviewDoc);
    expect(keywords).toContain('products');
    expect(keywords).toContain('orders');
  });
});
