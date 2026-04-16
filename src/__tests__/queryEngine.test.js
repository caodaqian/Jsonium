import { describe, expect, it } from 'vitest';
import {
  detectQueryType,
  queryJq,
  queryJsonPath,
  validateQuery
} from '../services/queryEngine.js';

describe('JSON 查询引擎', () => {
  const testData = {
    store: {
      name: 'My Store',
      book: [
        { title: 'Book 1', price: 10, author: 'Author A' },
        { title: 'Book 2', price: 15, author: 'Author B' },
        { title: 'Book 3', price: 8, author: 'Author C' }
      ],
      music: [
        { title: 'Song 1', price: 5 },
        { title: 'Song 2', price: 7 }
      ]
    }
  };

  const testJsonString = JSON.stringify(testData);

  describe('JSONPath 查询', () => {
    it('should query root element', () => {
      const result = queryJsonPath(testJsonString, '$');
      expect(result.success).toBe(true);
      expect(result.count).toBe(1);
    });

    it('should query nested property', () => {
      const result = queryJsonPath(testJsonString, '$.store.name');
      expect(result.success).toBe(true);
      expect(result.results[0]).toBe('My Store');
    });

    it('should query array element', () => {
      const result = queryJsonPath(testJsonString, '$.store.book[0].title');
      expect(result.success).toBe(true);
      expect(result.results[0]).toBe('Book 1');
    });

    it('should query all array elements', () => {
      const result = queryJsonPath(testJsonString, '$.store.book[*].price');
      expect(result.success).toBe(true);
      expect(result.results).toContain(10);
      expect(result.results).toContain(15);
      expect(result.results).toContain(8);
    });

    it('should handle invalid JSONPath', () => {
      const result = queryJsonPath(testJsonString, 'invalid');
      expect(result.success).toBe(true);
      // jsonpath-plus 不会报错，只返回空结果
      expect(result.count).toBe(0);
    });
  });

  describe('jq 查询', () => {
    it('should query simple property', async () => {
      const result = await queryJq(testJsonString, '.store.name');
      expect(result.success).toBe(true);
      expect(result.results[0]).toBe('My Store');
    });

    it('should support select filters in jq expressions', async () => {
      const result = await queryJq(testJsonString, '.store.book[] | select(.price > 10) | .title');
      expect(result.success).toBe(true);
      expect(result.count).toBe(1);
      expect(result.results[0]).toBe('Book 2');
    });

    it('should query array elements', async () => {
      const result = await queryJq(testJsonString, '.store.book[].title');
      expect(result.success).toBe(true);
      expect(result.count).toBe(3);
      expect(result.results).toContain('Book 1');
    });

    it('should query specific array index', async () => {
      const result = await queryJq(testJsonString, '.store.book[0]');
      expect(result.success).toBe(true);
      expect(result.results[0].title).toBe('Book 1');
    });

    it('should handle simple case', async () => {
      const result = await queryJq(testJsonString, '.');
      expect(result.success).toBe(true);
    });

    it('should handle invalid jq', async () => {
      const result = await queryJq(testJsonString, '.invalid.path.deep');
      expect(result.success).toBe(true);
      // 可能返回 null 或空结果
    });
  });

  describe('查询验证', () => {
    it('should detect bare jq function expressions', () => {
      expect(detectQueryType('select(.price > 10)')).toBe('jq');
    });

    it('should validate JSONPath format', () => {
      const result = validateQuery('$.store.book', 'jsonpath');
      expect(result.valid).toBe(true);
    });

    it('should reject invalid JSONPath', () => {
      const result = validateQuery('store.book', 'jsonpath');
      expect(result.valid).toBe(false);
    });

    it('should validate jq format', () => {
      const result = validateQuery('.store.book', 'jq');
      expect(result.valid).toBe(true);
    });

    it('should accept jq root reference', () => {
      const result = validateQuery('.', 'jq');
      expect(result.valid).toBe(true);
    });
  });

  describe('错误处理', () => {
    it('should handle invalid JSON input', () => {
      const result = queryJsonPath('invalid json', '$.foo');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle null input for jq', async () => {
      const result = await queryJq(null, '.foo');
      expect(result.success).toBe(false);
    });
  });
});