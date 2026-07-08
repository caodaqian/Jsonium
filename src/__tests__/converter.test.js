import { describe, expect, it } from 'vitest';
import {
  convert,
  jsonToCpp,
  jsonToGoStruct,
  jsonToJavaClass,
  jsonToJavaScript,
  jsonToPython,
  jsonToRust,
  jsonToTypeScript
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

    it('should generate nested interfaces and safe property names', () => {
      const json = JSON.stringify({
        id: 1,
        profile: { display_name: 'Alice', 'bad-key': true },
        tags: ['a', 2, null],
        items: [{ sku: 'A', qty: 1 }, { sku: 'B', qty: null }]
      });
      const result = jsonToTypeScript(json, 'IUser');

      expect(result.success).toBe(true);
      expect(result.data).toContain('interface IUserProfile');
      expect(result.data).toContain('profile: IUserProfile;');
      expect(result.data).toContain("'bad-key': boolean;");
      expect(result.data).toContain('tags: (string | number | null)[];');
      expect(result.data).toContain('items: IUserItem[];');
      expect(result.data).toContain('qty: number | null;');
    });
  });

  describe('Go struct 生成增强', () => {
    it('should generate nested structs and preserve json tags', () => {
      const json = JSON.stringify({
        user_id: 1,
        profile: { display_name: 'Alice' },
        items: [{ sku: 'A', qty: 1 }]
      });
      const result = jsonToGoStruct(json, 'User');

      expect(result.success).toBe(true);
      expect(result.data).toContain('type User struct');
      expect(result.data).toContain('UserId int64 `json:"user_id"`');
      expect(result.data).toContain('Profile UserProfile `json:"profile"`');
      expect(result.data).toContain('type UserProfile struct');
      expect(result.data).toContain('Items []UserItem `json:"items"`');
      expect(result.data).toContain('type UserItem struct');
    });
    it('generates nested Java classes for nested objects and arrays', () => {
      const json = JSON.stringify({ profile: { name: 'Ada' }, items: [{ sku: 'A1' }] });

      const result = convert(json, 'java', { className: 'User' });

      expect(result.success).toBe(true);
      expect(result.data).toContain('public class User');
      expect(result.data).toContain('private UserProfile profile;');
      expect(result.data).toContain('private List<UserItem> items;');
      expect(result.data).toContain('class UserProfile');
      expect(result.data).toContain('class UserItem');
    });

    it('generates nested Python dataclasses for nested objects and arrays', () => {
      const json = JSON.stringify({ profile: { name: 'Ada' }, items: [{ sku: 'A1' }] });

      const result = convert(json, 'python', { className: 'User' });

      expect(result.success).toBe(true);
      expect(result.data).toContain('class User:');
      expect(result.data).toContain('profile: UserProfile');
      expect(result.data).toContain('items: List[UserItem]');
      expect(result.data).toContain('class UserProfile:');
      expect(result.data).toContain('class UserItem:');
    });

    it('generates nested Rust structs for nested objects and arrays', () => {
      const json = JSON.stringify({ profile: { name: 'Ada' }, items: [{ sku: 'A1' }] });

      const result = convert(json, 'rust', { className: 'User' });

      expect(result.success).toBe(true);
      expect(result.data).toContain('pub struct User');
      expect(result.data).toContain('pub profile: UserProfile,');
      expect(result.data).toContain('pub items: Vec<UserItem>,');
      expect(result.data).toContain('pub struct UserProfile');
      expect(result.data).toContain('pub struct UserItem');
    });

    it('generates nested C++ structs for nested objects and arrays', () => {
      const json = JSON.stringify({ profile: { name: 'Ada' }, items: [{ sku: 'A1' }] });

      const result = convert(json, 'cpp', { className: 'User' });

      expect(result.success).toBe(true);
      expect(result.data).toContain('struct User');
      expect(result.data).toContain('UserProfile profile;');
      expect(result.data).toContain('std::vector<UserItem> items;');
      expect(result.data).toContain('struct UserProfile');
      expect(result.data).toContain('struct UserItem');
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