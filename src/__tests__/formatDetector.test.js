import { describe, it, expect } from 'vitest';
import {
  isBase64,
  isEscapedJson,
  isJson5,
  isYaml,
  isXml,
  isJson,
  decodeBase64,
  decodeEscapedJson,
  parseJson5,
  parseYaml,
  formatJson,
  detectAndConvert,
  toFormat
} from '../services/formatDetector.js';

describe('格式识别引擎', () => {
  describe('格式检测', () => {
    it('should detect standard JSON', () => {
      const json = '{"name": "John", "age": 30}';
      expect(isJson(json)).toBe(true);
    });

    it('should detect JSON5', () => {
      const json5 = "{ name: 'John', age: 30 }";
      expect(isJson5(json5)).toBe(true);
    });

    it('should detect escaped JSON', () => {
      const escaped = '"{\\\"name\\\":\\\"John\\\"}"';
      expect(isEscapedJson(escaped)).toBe(true);
    });

    it('should detect Base64 JSON', () => {
      const json = '{"test": "data"}';
      const base64 = btoa(json);
      expect(isBase64(base64)).toBe(true);
    });

    it('should detect YAML', () => {
      const yaml = 'name: John\nage: 30';
      expect(isYaml(yaml)).toBe(true);
    });

    it('should detect XML', () => {
      const xml = '<root><name>John</name></root>';
      expect(isXml(xml)).toBe(true);
    });
  });

  describe('格式转换', () => {
    it('should format JSON correctly', () => {
      const input = '{"name":"John","age":30}';
      const result = formatJson(input);
      expect(result.success).toBe(true);
      expect(result.format).toBe('json');
      expect(result.data).toContain('name');
    });

    it('should decode Base64', () => {
      const json = '{"test": "data"}';
      const base64 = btoa(json);
      const result = decodeBase64(base64);
      expect(result.success).toBe(true);
      expect(result.data).toContain('test');
    });

    it('should decode escaped JSON', () => {
      const escaped = '"{\\\"name\\\":\\\"John\\\"}"';
      const result = decodeEscapedJson(escaped);
      expect(result.success).toBe(true);
    });

    it('should parse JSON5', () => {
      const json5 = "{ name: 'John', age: 30 }";
      const result = parseJson5(json5);
      expect(result.success).toBe(true);
      expect(result.data).toContain('name');
    });
  });

  describe('自动检测和转换', async () => {
    it('should auto-detect and convert standard JSON', async () => {
      const json = '{"name": "John"}';
      const result = await detectAndConvert(json);
      expect(result.success).toBe(true);
      expect(result.originalFormat).toBe('json');
    });

    it('should auto-detect and convert Base64', async () => {
      const json = '{"test": "value"}';
      const base64 = btoa(json);
      const result = await detectAndConvert(base64);
      expect(result.success).toBe(true);
      expect(result.originalFormat).toBe('base64');
    });
  });

  describe('格式转换为指定格式', async () => {
    const testJson = '{"name": "John", "age": 30}';

    it('should convert to YAML', async () => {
      const result = await toFormat(testJson, 'yaml');
      expect(result.success).toBe(true);
      expect(result.data).toContain('name');
    });

    it('should convert to Base64', async () => {
      const result = await toFormat(testJson, 'base64');
      expect(result.success).toBe(true);
      const decoded = atob(result.data);
      expect(decoded).toContain('John');
    });

    it('should convert to escaped string', async () => {
      const result = await toFormat(testJson, 'escaped');
      expect(result.success).toBe(true);
      expect(result.data).toContain('\\');
    });
  });
});