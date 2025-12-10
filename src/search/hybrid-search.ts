/**
 * Hybrid Search Implementation
 *
 * Combines full-text search (FTS5) and vector similarity search
 * with Reciprocal Rank Fusion (RRF) for optimal results.
 */

import { Database } from 'better-sqlite3';
import { logger } from '../utils/logger.js';

export interface SearchOptions {
  query: string;
  queryAnalysis?: any;
  database?: string;
  domain?: string;
  limit?: number;
}

export interface SearchResult {
  id: number;
  doc_type: string;
  database_name: string;
  schema_name: string;
  table_name: string;
  column_name: string;
  domain: string;
  content: string;
  summary: string;
  keywords: string[];
  relevance_score: number;
}

export class HybridSearch {
  private db: Database;
  private rrfK: number;

  constructor(db: Database, rrfK: number = 60) {
    this.db = db;
    this.rrfK = rrfK;
  }

  /**
   * Perform hybrid search combining FTS5 and vector search
   */
  async searchTables(options: SearchOptions): Promise<SearchResult[]> {
    const { query, queryAnalysis, database, domain, limit = 5 } = options;

    try {
      logger.debug(`Performing hybrid search for query: "${query}"`);

      // Prepare search terms
      const searchTerms = this.prepareSearchTerms(query, queryAnalysis);

      // Execute FTS5 search
      const ftsResults = this.performFTSSearch(searchTerms, database, domain);

      // Generate query embedding
      const queryEmbedding = await this.generateQueryEmbedding(searchTerms.expandedQuery);

      // Execute vector search
      const vectorResults = this.performVectorSearch(queryEmbedding, database, domain);

      // Combine results using Reciprocal Rank Fusion
      const combinedResults = this.combineResultsWithRRF(ftsResults, vectorResults);

      // Apply document type weight boosts
      const weightedResults = this.applyDocumentWeights(combinedResults);

      // Sort by final score and limit
      const finalResults = weightedResults
        .sort((a, b) => b.relevance_score - a.relevance_score)
        .slice(0, limit);

      logger.debug(`Hybrid search returned ${finalResults.length} results`);
      return finalResults;

    } catch (error) {
      logger.error('Hybrid search failed', error);
      throw error;
    }
  }

  /**
   * Prepare search terms from query and analysis
   */
  private prepareSearchTerms(query: string, queryAnalysis?: any): any {
    // Clean and tokenize query
    const cleanQuery = query.toLowerCase().trim();

    // Extract keywords from analysis or use raw query
    const keywords = queryAnalysis?.concepts || [cleanQuery];

    // Expand with synonyms and related terms
    const expandedTerms = queryAnalysis?.expanded_terms || keywords;

    // Create expanded query for embedding
    const expandedQuery = expandedTerms.join(' ');

    return {
      originalQuery: query,
      keywords,
      expandedTerms,
      expandedQuery,
    };
  }

  /**
   * Perform FTS5 full-text search
   */
  private performFTSSearch(searchTerms: any, database?: string, domain?: string): any[] {
    try {
      let query = `
        SELECT
          d.id,
          d.doc_type,
          d.database_name,
          d.schema_name,
          d.table_name,
          d.column_name,
          d.domain,
          d.content,
          d.summary,
          d.keywords,
          fts.rank as fts_score
        FROM documents_fts fts
        JOIN documents d ON fts.rowid = d.id
        WHERE d.doc_type = 'table'
          AND fts.content MATCH ?
      `;

      const params: any[] = [searchTerms.keywords.join(' OR ')];

      // Add filters
      if (database) {
        query += ' AND d.database_name = ?';
        params.push(database);
      }

      if (domain) {
        query += ' AND d.domain = ?';
        params.push(domain);
      }

      query += ' ORDER BY fts.rank LIMIT 50';

      const stmt = this.db.prepare(query);
      const results = stmt.all(...params);

      return results.map((row: any, index: number) => ({
        ...row,
        rank: index + 1,
        score: this.calculateFTSScore(row.fts_score),
      }));

    } catch (error) {
      logger.warn('FTS5 search failed', error);
      return [];
    }
  }

  /**
   * Generate embedding for query
   */
  private async generateQueryEmbedding(query: string): Promise<Buffer> {
    // TODO: Implement OpenAI embedding generation
    // For now, return zero vector
    return Buffer.alloc(1536 * 4); // 1536 dimensions * 4 bytes per float
  }

  /**
   * Perform vector similarity search
   */
  private performVectorSearch(embedding: Buffer, database?: string, domain?: string): any[] {
    try {
      let query = `
        SELECT
          d.id,
          d.doc_type,
          d.database_name,
          d.schema_name,
          d.table_name,
          d.column_name,
          d.domain,
          d.content,
          d.summary,
          d.keywords,
          vec.embedding
        FROM documents_vec vec
        JOIN documents d ON vec.id = d.id
        WHERE d.doc_type = 'table'
      `;

      const params: any[] = [];

      // Add filters
      if (database) {
        query += ' AND d.database_name = ?';
        params.push(database);
      }

      if (domain) {
        query += ' AND d.domain = ?';
        params.push(domain);
      }

      const stmt = this.db.prepare(query);
      const results = stmt.all(...params);

      // Calculate cosine similarity for each result
      const scoredResults = results.map((row: any) => ({
        ...row,
        similarity: this.cosineSimilarity(embedding, row.embedding),
      }));

      // Sort by similarity and take top 50
      return scoredResults
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 50)
        .map((row, index) => ({
          ...row,
          rank: index + 1,
          score: row.similarity,
        }));

    } catch (error) {
      logger.warn('Vector search failed', error);
      return [];
    }
  }

  /**
   * Combine FTS5 and vector results using Reciprocal Rank Fusion
   */
  private combineResultsWithRRF(ftsResults: any[], vectorResults: any[]): any[] {
    const combinedMap = new Map<number, any>();

    // Process FTS5 results
    for (const result of ftsResults) {
      combinedMap.set(result.id, {
        ...result,
        rrf_score: 1 / (this.rrfK + result.rank),
      });
    }

    // Process vector results
    for (const result of vectorResults) {
      const existing = combinedMap.get(result.id);
      if (existing) {
        existing.rrf_score += 1 / (this.rrfK + result.rank);
      } else {
        combinedMap.set(result.id, {
          ...result,
          rrf_score: 1 / (this.rrfK + result.rank),
        });
      }
    }

    // Convert back to array and sort by RRF score
    return Array.from(combinedMap.values())
      .sort((a, b) => b.rrf_score - a.rrf_score);
  }

  /**
   * Apply document type weight boosts
   */
  private applyDocumentWeights(results: any[]): SearchResult[] {
    return results.map(result => {
      let boost = 1.0;

      // Get document type weight
      const weightRow = this.db.prepare(`
        SELECT boost FROM index_weights WHERE doc_type = ?
      `).get(result.doc_type) as any;

      if (weightRow) {
        boost = weightRow.boost;
      }

      return {
        id: result.id,
        doc_type: result.doc_type,
        database_name: result.database_name,
        schema_name: result.schema_name,
        table_name: result.table_name,
        column_name: result.column_name,
        domain: result.domain,
        content: result.content,
        summary: result.summary,
        keywords: JSON.parse(result.keywords || '[]'),
        relevance_score: result.rrf_score * boost,
      };
    });
  }

  /**
   * Calculate normalized FTS5 score
   */
  private calculateFTSScore(ftsRank: number): number {
    // FTS5 rank is negative (more negative = better match)
    // Convert to positive score between 0 and 1
    return Math.max(0, Math.min(1, (-ftsRank + 100) / 100));
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(vec1: Buffer, vec2: Buffer): number {
    // Convert buffers to float arrays
    const float1 = this.bufferToFloatArray(vec1);
    const float2 = this.bufferToFloatArray(vec2);

    if (float1.length !== float2.length) {
      return 0;
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < float1.length; i++) {
      dotProduct += float1[i] * float2[i];
      norm1 += float1[i] * float1[i];
      norm2 += float2[i] * float2[i];
    }

    norm1 = Math.sqrt(norm1);
    norm2 = Math.sqrt(norm2);

    if (norm1 === 0 || norm2 === 0) {
      return 0;
    }

    return dotProduct / (norm1 * norm2);
  }

  /**
   * Convert buffer to float array
   */
  private bufferToFloatArray(buffer: Buffer): number[] {
    const floats: number[] = [];
    for (let i = 0; i < buffer.length; i += 4) {
      floats.push(buffer.readFloatLE(i));
    }
    return floats;
  }
}