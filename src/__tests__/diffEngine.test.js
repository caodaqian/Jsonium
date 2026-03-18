import { describe, it, expect } from 'vitest';
import {
  getDifferences,
  categorizeDifferences,
  generateDiffSummary
} from '../services/diffEngine.js';

describe('JSON 对比引擎', () => {
  describe('基础对比', () => {
    it('should detect identical objects', () => {
      const json1 = '{"name": "John", "age": 30}';
      const json2 = '{"name": "John", "age": 30}';
      const result = getDifferences(json1, json2);
      expect(result.success).toBe(true);
      expect(result.hasDifferences).toBe(false);
      expect(result.differences.length).toBe(0);
    });

    it('should detect value changes', () => {
      const json1 = '{"name": "John", "age": 30}';
      const json2 = '{"name": "Jane", "age": 30}';
      const result = getDifferences(json1, json2);
      expect(result.success).toBe(true);
      expect(result.hasDifferences).toBe(true);
      expect(result.differences.some(d => d.type === 'value-change')).toBe(true);
    });

    it('should detect added keys', () => {
      const json1 = '{"name": "John"}';
      const json2 = '{"name": "John", "age": 30}';
      const result = getDifferences(json1, json2);
      expect(result.success).toBe(true);
      expect(result.differences.some(d => d.type === 'key-added')).toBe(true);
    });

    it('should detect removed keys', () => {
      const json1 = '{"name": "John", "age": 30}';
      const json2 = '{"name": "John"}';
      const result = getDifferences(json1, json2);
      expect(result.success).toBe(true);
      expect(result.differences.some(d => d.type === 'key-removed')).toBe(true);
    });

    it('should detect type mismatches', () => {
      const json1 = '{"age": 30}';
      const json2 = '{"age": "thirty"}';
      const result = getDifferences(json1, json2);
      expect(result.success).toBe(true);
      expect(result.differences.some(d => d.type === 'type-mismatch')).toBe(true);
    });
  });

  describe('数组对比', () => {
    it('should detect array length changes', () => {
      const json1 = '[1, 2, 3]';
      const json2 = '[1, 2, 3, 4]';
      const result = getDifferences(json1, json2);
      expect(result.success).toBe(true);
      expect(result.differences.some(d => d.type === 'array-length-change')).toBe(true);
    });

    it('should detect array element changes', () => {
      const json1 = '[{"name": "John"}, {"name": "Jane"}]';
      const json2 = '[{"name": "John"}, {"name": "Bob"}]';
      const result = getDifferences(json1, json2);
      expect(result.success).toBe(true);
      expect(result.hasDifferences).toBe(true);
    });
  });

  describe('差异分类', () => {
    it('should categorize differences correctly', () => {
      const json1 = '{"name": "John", "age": 30, "email": "john@test.com"}';
      const json2 = '{"name": "Jane", "phone": "123456"}';
      const result = getDifferences(json1, json2);
      
      const categories = categorizeDifferences(result.differences);
      expect(categories.keyAdded).toBeDefined();
      expect(categories.keyRemoved).toBeDefined();
      expect(categories.valueChange).toBeDefined();
    });
  });

  describe('差异摘要生成', () => {
    it('should generate diff summary', () => {
      const json1 = '{"name": "John", "age": 30}';
      const json2 = '{"name": "Jane", "age": 30, "email": "jane@test.com"}';
      const result = getDifferences(json1, json2);
      
      const summary = generateDiffSummary(result.differences);
      expect(summary.total).toBeGreaterThan(0);
      expect(summary.keyAdded).toBeGreaterThanOrEqual(0);
      expect(summary.keyRemoved).toBeGreaterThanOrEqual(0);
      expect(summary.valueChanges).toBeGreaterThanOrEqual(0);
    });
  });

  describe('忽略字段对比', () => {
    it('should ignore specified fields', () => {
      const json1 = '{"name": "John", "age": 30, "timestamp": 123456}';
      const json2 = '{"name": "John", "age": 31, "timestamp": 789012}';
      
      const result = getDifferences(json1, json2, { ignoreFields: ['timestamp'] });
      expect(result.success).toBe(true);
      // timestamp 的差异应该被忽略
      const hasTimestampDiff = result.differences.some(d => d.path.includes('timestamp'));
      expect(hasTimestampDiff).toBe(false);
    });
  });

  describe('错误处理', () => {
    it('should handle invalid JSON', () => {
      const result = getDifferences('invalid', '{"valid": true}');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle empty objects', () => {
      const result = getDifferences('{}', '{}');
      expect(result.success).toBe(true);
      expect(result.hasDifferences).toBe(false);
    });
  });
});