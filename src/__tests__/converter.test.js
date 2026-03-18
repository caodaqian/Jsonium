import { describe, it, expect } from 'vitest';
import {
  convert,
  jsonToGoStruct,
  jsonToJavaClass,
  jsonToPython,
  jsonToTypeScript,
  jsonToJavaScript,
  jsonToRust,
  jsonToCpp
} from '../services/converter.js';

describe('JSON 转换引擎', () => {
  const testJson = '{"name": "John", "age": 30, "email": "john@example.com"}';

  describe('Go struct 生成', () => {
    it('should generate Go struct', () => {
      const result = jsonToGoStruct(testJson, 'User');
      expect(result.success).toBe(true);
      expect(result.data).toContain('type User struct');
      expect(result.data).toContain('Name');
      expect(result.data).toContain('Age');
    });
  });

  describe('Java class 生成', () => {
    it('should generate Java class', () => {
      const result = jsonToJavaClass(testJson, 'User');
      expect(result.success).toBe(true);
      expect(result.data).toContain('public class User');
      expect(result.data).toContain('private');
      expect(result.data).toContain('getName');
    });
  });

  describe('Python dataclass 生成', () => {
    it('should generate Python dataclass', () => {
      const result = jsonToPython(testJson, 'User');
      expect(result.success).toBe(true);
      expect(result.data).toContain('@dataclass');
      expect(result.data).toContain('class User');
      expect(result.data).toContain('name: str');
      expect(result.data).toContain('age: int');
    });
  });

  describe('TypeScript interface 生成', () => {
    it('should generate TypeScript interface', () => {
      const result = jsonToTypeScript(testJson, 'IUser');
      expect(result.success).toBe(true);
      expect(result.data).toContain('interface IUser');
      expect(result.data).toContain('name: string');
      expect(result.data).toContain('age: number');
    });
  });

  describe('JavaScript 生成', () => {
    it('should generate JavaScript', () => {
      const result = jsonToJavaScript(testJson, 'user');
      expect(result.success).toBe(true);
      expect(result.data).toContain('const user =');
      expect(result.data).toContain('John');
    });
  });

  describe('Rust struct 生成', () => {
    it('should generate Rust struct', () => {
      const result = jsonToRust(testJson, 'User');
      expect(result.success).toBe(true);
      expect(result.data).toContain('#[derive');
      expect(result.data).toContain('pub struct User');
    });
  });

  describe('C++ struct 生成', () => {
    it('should generate C++ struct', () => {
      const result = jsonToCpp(testJson, 'User');
      expect(result.success).toBe(true);
      expect(result.data).toContain('struct User');
      expect(result.data).toContain('std::string');
    });
  });

  describe('通用转换接口', () => {
    it('should convert to Go', () => {
      const result = convert(testJson, 'go', { className: 'User' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('struct');
    });

    it('should convert to Python', () => {
      const result = convert(testJson, 'python', { className: 'User' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('@dataclass');
    });

    it('should convert to TypeScript', () => {
      const result = convert(testJson, 'typescript', { interfaceName: 'IUser' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('interface');
    });

    it('should handle unsupported language', () => {
      const result = convert(testJson, 'unknown');
      expect(result.success).toBe(false);
      expect(result.error).toContain('不支持');
    });
  });

  describe('错误处理', () => {
    it('should handle invalid JSON', () => {
      const result = jsonToGoStruct('invalid json', 'User');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle empty JSON', () => {
      const result = jsonToTypeScript('{}', 'Empty');
      expect(result.success).toBe(true);
    });
  });
});