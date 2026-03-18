import { describe, it, expect } from 'vitest';
import { jsonToXmlSafe, xmlToJsonSafe } from '../services/xmlUtils.js';

describe('xmlUtils', () => {
  it('jsonToXmlSafe builds xml string', () => {
    const obj = { root: { a: 1, b: 'x' } };
    const xml = jsonToXmlSafe(obj, { headless: true });
    expect(typeof xml).toBe('string');
    expect(xml.includes('<a>1</a>') || xml.includes('<a>1</a>')).toBe(true);
  });

  it('xmlToJsonSafe parses xml', async () => {
    const xml = '<?xml version="1.0"?><root><a>1</a><b>x</b></root>';
    const res = await xmlToJsonSafe(xml);
    expect(res.success).toBe(true);
    expect(res.data).toBeTruthy();
    // parsed structure should include root
    expect(res.data.root).toBeDefined();
  });
});