import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { createTestDatabase } from './test-setup.js';
import { MemoryService } from '../src/services/memory-service';
import type { StoreMemoryInput } from '../src/schemas/validation';

describe('MemoryService', () => {
  let memoryService: MemoryService;
  let db: any;

  beforeAll(async () => {
    db = createTestDatabase();
    memoryService = new MemoryService(db);
    
    // Don't run migrations - assume database is already set up
    // await import('../src/database/migrate');
  });

  afterAll(async () => {
    // Clean up ONLY test data - NEVER delete all memories!
    // Only delete memories that were created during this test run
    await db.deleteFrom('memories')
      .where('user_context', 'in', ['test-user', 'cluster-test'])
      .execute();
    
    // Also clean up any test memories with specific test sources
    await db.deleteFrom('memories')
      .where('source', 'in', ['test-suite', 'test'])
      .execute();
      
    await db.destroy();
  });

  describe('store', () => {
    test('should store a new memory', async () => {
      const input: StoreMemoryInput = {
        content: 'Test memory content',
        type: 'fact',
        tags: ['test', 'unit-test'],
        source: 'test-suite',
        confidence: 0.9,
        user_context: 'test-user',
      };

      const memory = await memoryService.store(input, false);

      expect(memory).toBeDefined();
      expect(memory.content).toBe('Test memory content');
      expect(memory.type).toBe('fact');
      expect(memory.tags).toEqual(['test', 'unit-test']);
      expect(memory.confidence).toBe(0.9);
    });

    test('should detect duplicate content', async () => {
      const input: StoreMemoryInput = {
        content: 'Duplicate test content',
        type: 'fact',
        tags: ['duplicate'],
        source: 'test-suite',
        confidence: 0.8,
        user_context: 'test-user',
      };

      const memory1 = await memoryService.store(input, false);
      const memory2 = await memoryService.store(input, false);

      expect(memory1.id).toBe(memory2.id);
      expect(memory2.access_count).toBeGreaterThan(memory1.access_count);
    });

    test('should compress large content', async () => {
      const largeContent = 'x'.repeat(150000); // 150KB
      const input: StoreMemoryInput = {
        content: largeContent,
        type: 'context',
        tags: ['large'],
        source: 'test-suite',
        confidence: 0.7,
        user_context: 'test-user',
      };

      const memory = await memoryService.store(input, false);

      expect(memory).toBeDefined();
      expect(memory.is_compressed).toBe(true);
    }, 30000); // Increase timeout to 30 seconds for compression test
  });

  describe('search', () => {
    test('should find memories by query', async () => {
      // Store test memories with unique content and test-specific user context
      const testMemory1 = await memoryService.store({
        content: 'TypeScript is a programming language used for tests',
        type: 'fact',
        tags: ['typescript', 'programming', 'test-search'],
        source: 'test-suite',
        confidence: 0.9,
        user_context: 'test-user',
      }, false);

      const testMemory2 = await memoryService.store({
        content: 'JavaScript is also a programming language for tests',
        type: 'fact',
        tags: ['javascript', 'programming', 'test-search'],
        source: 'test-suite',
        confidence: 0.9,
        user_context: 'test-user',
      }, false);

      const results = await memoryService.search({
        query: 'TypeScript programming tests',
        limit: 10,
        threshold: 0.3,
        user_context: 'test-user',
      });

      expect(results.length).toBeGreaterThan(0);
      // Find our specific test memory
      const foundTestMemory = results.find(r => 
        typeof r.content === 'string' && 
        r.content.includes('TypeScript is a programming language used for tests')
      );
      expect(foundTestMemory).toBeDefined();
    });
  });

  describe('list', () => {
    test('should list memories with filters', async () => {
      const memories = await memoryService.list({
        type: 'fact',
        tags: ['programming'],
        limit: 10,
        offset: 0,
      });

      expect(Array.isArray(memories)).toBe(true);
      memories.forEach(memory => {
        expect(memory.type).toBe('fact');
        expect(memory.tags).toContain('programming');
      });
    });
  });

  describe('update', () => {
    test('should update memory metadata', async () => {
      const memory = await memoryService.store({
        content: 'Update test memory',
        type: 'fact',
        tags: ['original'],
        source: 'test',
        confidence: 0.5,
      }, false);

      const updated = await memoryService.update({
        id: memory.id,
        updates: {
          tags: ['updated', 'modified'],
          confidence: 0.9,
        },
      });

      expect(updated.tags).toEqual(['updated', 'modified']);
      expect(updated.confidence).toBe(0.9);
    });
  });

  describe('delete', () => {
    test('should soft delete memory', async () => {
      const memory = await memoryService.store({
        content: 'Delete test memory',
        type: 'fact',
        tags: ['delete'],
        source: 'test',
        confidence: 0.5,
      }, false);

      const result = await memoryService.delete({ id: memory.id });
      expect(result.success).toBe(true);

      // Should not appear in regular list
      const memories = await memoryService.list({
        tags: ['delete'],
        limit: 10,
        offset: 0,
      });
      expect(memories.find(m => m.id === memory.id)).toBeUndefined();
    });
  });

  describe.skip('consolidate', () => {
    test('should cluster similar memories', async () => {
      // Store similar memories with embeddings disabled for speed
      // Since we're testing clustering logic, not embedding generation
      for (let i = 0; i < 5; i++) {
        await memoryService.store({
          content: `Similar content about clustering ${i}`,
          type: 'fact',
          tags: ['clustering'],
          source: 'test',
          confidence: 0.8,
          user_context: 'cluster-test',
        }, true); // Enable async embedding to avoid dimension issues
      }
      
      // Wait a bit for async embeddings to process
      await new Promise(resolve => setTimeout(resolve, 2000));

      const result = await memoryService.consolidate({
        user_context: 'cluster-test',
        threshold: 0.7,
        min_cluster_size: 2,
      });

      expect(result.clustersCreated).toBeGreaterThan(0);
      expect(result.memoriesArchived).toBeGreaterThan(0);
    });
  });
});