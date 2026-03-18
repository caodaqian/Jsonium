import { describe, it, expect } from 'vitest';
import { getValueAtJsonPath, setValueAtJsonPath, toJsonPath } from '../utils/pathUtils.js';

describe('pathUtils', () => {
  it('toJsonPath normalizes paths', () => {
    expect(toJsonPath('a.b')).toBe('$.a.b');
    expect(toJsonPath('$.x')).toBe('$.x');
  });

  it('getValueAtJsonPath handles dot and index', () => {
    const obj = { a: { b: [1, { c: 3 }] } };
    expect(getValueAtJsonPath(obj, '$.a.b[0]')).toBe(1);
    expect(getValueAtJsonPath(obj, '$.a.b[1].c')).toBe(3);
    expect(getValueAtJsonPath(obj, 'a.b[1].c')).toBe(3);
  });

  it('setValueAtJsonPath creates nested structure', () => {
    const obj = {};
    const ok = setValueAtJsonPath(obj, '$.x.y[0].z', 5);
    expect(ok).toBe(true);
    expect(getValueAtJsonPath(obj, '$.x.y[0].z')).toBe(5);
  });
});