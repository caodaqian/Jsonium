import { describe, it, expect } from 'vitest';
import {
  getByDotPath,
  setByDotPath,
  collectAllPaths,
  detectColumnTypes,
  extractTableFromJson,
  applyEditsToJson,
  filterAndSortRows,
  buildCsvString,
  detectPathType,
  resolveArrayPath,
} from '../services/tableView.js';

// ─── getByDotPath ────────────────────────────────────────────────────────────
describe('getByDotPath', () => {
  it('returns undefined when path is empty', () => {
    expect(getByDotPath({ a: 1 }, '')).toBeUndefined();
  });

  it('returns top-level value', () => {
    expect(getByDotPath({ a: 42 }, 'a')).toBe(42);
  });

  it('returns nested value', () => {
    expect(getByDotPath({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42);
  });

  it('returns undefined for missing path', () => {
    expect(getByDotPath({ a: 1 }, 'a.b')).toBeUndefined();
  });

  it('returns undefined for null input', () => {
    expect(getByDotPath(null, 'a')).toBeUndefined();
  });
});

// ─── setByDotPath ────────────────────────────────────────────────────────────
describe('setByDotPath', () => {
  it('sets a top-level key (mutates in place)', () => {
    const obj = { a: 1 };
    setByDotPath(obj, 'a', 99);
    expect(obj.a).toBe(99);
  });

  it('sets a nested key (mutates in place)', () => {
    const obj = { a: { b: 1 } };
    setByDotPath(obj, 'a.b', 'hello');
    expect(obj.a.b).toBe('hello');
  });

  it('creates intermediate objects if missing', () => {
    const obj = {};
    setByDotPath(obj, 'x.y.z', 7);
    expect(obj.x.y.z).toBe(7);
  });
});

// ─── collectAllPaths ─────────────────────────────────────────────────────────
describe('collectAllPaths', () => {
  it('returns flat paths for rows with flat objects', () => {
    const rows = [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }];
    const paths = collectAllPaths(rows);
    expect(paths).toContain('name');
    expect(paths).toContain('age');
  });

  it('returns dot-separated paths for nested objects', () => {
    const rows = [{ a: { b: 1 } }];
    const paths = collectAllPaths(rows);
    expect(paths).toContain('a.b');
  });

  it('does not include _rowIndex', () => {
    const rows = [{ _rowIndex: 0, name: 'Alice' }];
    const paths = collectAllPaths(rows);
    expect(paths).not.toContain('_rowIndex');
  });

  it('treats arrays as leaf values (no recursion into arrays)', () => {
    const rows = [{ tags: ['x', 'y'] }];
    const paths = collectAllPaths(rows);
    expect(paths).toContain('tags');
    expect(paths.some(p => p.startsWith('tags.'))).toBe(false);
  });
});

// ─── detectColumnTypes ───────────────────────────────────────────────────────
describe('detectColumnTypes', () => {
  it('returns array of column objects', () => {
    const rows = [{ price: 1.5 }, { price: 2.0 }];
    const cols = detectColumnTypes(rows, ['price']);
    expect(Array.isArray(cols)).toBe(true);
    expect(cols.length).toBe(1);
  });

  it('detects number column', () => {
    const rows = [{ price: 1.5 }, { price: 2.0 }];
    const cols = detectColumnTypes(rows, ['price']);
    expect(cols[0].type).toBe('number');
  });

  it('detects string column', () => {
    const rows = [{ name: 'Alice' }, { name: 'Bob' }];
    const cols = detectColumnTypes(rows, ['name']);
    expect(cols[0].type).toBe('string');
  });

  it('detects boolean column', () => {
    const rows = [{ active: true }, { active: false }];
    const cols = detectColumnTypes(rows, ['active']);
    expect(cols[0].type).toBe('boolean');
  });

  it('column object has expected fields', () => {
    const rows = [{ id: 1 }];
    const cols = detectColumnTypes(rows, ['id']);
    const col = cols[0];
    expect(col).toHaveProperty('id', 'id');
    expect(col).toHaveProperty('path', 'id');
    expect(col).toHaveProperty('label', 'id');
    expect(col).toHaveProperty('visible', true);
  });
});

// ─── extractTableFromJson ────────────────────────────────────────────────────
describe('extractTableFromJson', () => {
  const json = JSON.stringify([
    { id: 1, name: 'Alice', score: 90 },
    { id: 2, name: 'Bob',   score: 85 },
    { id: 3, name: 'Carol', score: 92 },
  ]);

  it('succeeds with root array JSON', () => {
    const result = extractTableFromJson(json);
    expect(result.success).toBe(true);
    expect(result.totalRows).toBe(3);
    expect(result.rows.length).toBe(3);
  });

  it('rows contain _rowIndex', () => {
    const result = extractTableFromJson(json);
    expect(result.rows[0]._rowIndex).toBe(0);
    expect(result.rows[2]._rowIndex).toBe(2);
  });

  it('columns include each field', () => {
    const result = extractTableFromJson(json);
    const paths = result.columns.map(c => c.path);
    expect(paths).toContain('id');
    expect(paths).toContain('name');
    expect(paths).toContain('score');
  });

  it('returns error for non-array JSON (no arrayPath)', () => {
    const result = extractTableFromJson(JSON.stringify({ a: 1 }));
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('accepts nested arrayPath via options object', () => {
    const data = JSON.stringify({ items: [{ x: 1 }, { x: 2 }] });
    const result = extractTableFromJson(data, { arrayPath: 'items' });
    expect(result.success).toBe(true);
    expect(result.totalRows).toBe(2);
  });

  it('returns empty rows for empty array', () => {
    const result = extractTableFromJson(JSON.stringify([]));
    expect(result.success).toBe(true);
    expect(result.totalRows).toBe(0);
  });

  it('returns error for invalid JSON string', () => {
    const result = extractTableFromJson('not json');
    expect(result.success).toBe(false);
  });
});

// ─── applyEditsToJson ────────────────────────────────────────────────────────
describe('applyEditsToJson', () => {
  const original = JSON.stringify([
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
  ]);

  it('applies a single edit', () => {
    const result = applyEditsToJson(original, {
      arrayPath: null,
      edits: [{ rowIndex: 0, columnPath: 'name', newValue: 'Eve' }],
    });
    expect(result.success).toBe(true);
    const arr = JSON.parse(result.jsonString);
    expect(arr[0].name).toBe('Eve');
    expect(arr[1].name).toBe('Bob'); // unchanged
  });

  it('applies multiple edits', () => {
    const result = applyEditsToJson(original, {
      arrayPath: null,
      edits: [
        { rowIndex: 0, columnPath: 'name', newValue: 'X' },
        { rowIndex: 1, columnPath: 'id',   newValue: 99 },
      ],
    });
    expect(result.success).toBe(true);
    const arr = JSON.parse(result.jsonString);
    expect(arr[0].name).toBe('X');
    expect(arr[1].id).toBe(99);
  });

  it('returns success with no edits', () => {
    const result = applyEditsToJson(original, { arrayPath: null, edits: [] });
    expect(result.success).toBe(true);
  });

  it('returns error for invalid JSON', () => {
    const result = applyEditsToJson('not json', {
      arrayPath: null,
      edits: [{ rowIndex: 0, columnPath: 'name', newValue: 'X' }],
    });
    expect(result.success).toBe(false);
  });
});

// ─── filterAndSortRows ───────────────────────────────────────────────────────
describe('filterAndSortRows', () => {
  const rows = [
    { _rowIndex: 0, name: 'Alice', score: 90 },
    { _rowIndex: 1, name: 'Bob',   score: 70 },
    { _rowIndex: 2, name: 'Carol', score: 85 },
  ];

  it('returns all rows with no filters', () => {
    expect(filterAndSortRows(rows, {}).length).toBe(3);
  });

  it('filters by globalSearch (case-insensitive)', () => {
    const result = filterAndSortRows(rows, { globalSearch: 'alice' });
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('Alice');
  });

  it('filters by column filter', () => {
    const result = filterAndSortRows(rows, { columnFilters: { name: 'Bob' } });
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('Bob');
  });

  it('sorts ascending by number column', () => {
    const result = filterAndSortRows(rows, { sortColumn: 'score', sortDir: 'asc' });
    expect(result[0].score).toBe(70);
    expect(result[2].score).toBe(90);
  });

  it('sorts descending by number column', () => {
    const result = filterAndSortRows(rows, { sortColumn: 'score', sortDir: 'desc' });
    expect(result[0].score).toBe(90);
    expect(result[2].score).toBe(70);
  });

  it('sorts alphabetically by string column', () => {
    const result = filterAndSortRows(rows, { sortColumn: 'name', sortDir: 'asc' });
    expect(result[0].name).toBe('Alice');
    expect(result[2].name).toBe('Carol');
  });
});

// ─── detectPathType ──────────────────────────────────────────────────────────
describe('detectPathType', () => {
  it('returns "dot" for empty / null / undefined', () => {
    expect(detectPathType('')).toBe('dot');
    expect(detectPathType(null)).toBe('dot');
    expect(detectPathType(undefined)).toBe('dot');
  });

  it('returns "jsonpath" for $ prefix', () => {
    expect(detectPathType('$.items')).toBe('jsonpath');
    expect(detectPathType('$')).toBe('jsonpath');
    expect(detectPathType('$.store.books[0]')).toBe('jsonpath');
  });

  it('returns "jq" for . prefix', () => {
    expect(detectPathType('.items')).toBe('jq');
    expect(detectPathType('.store.books')).toBe('jq');
  });

  it('returns "dot" for plain path', () => {
    expect(detectPathType('items')).toBe('dot');
    expect(detectPathType('store.books')).toBe('dot');
  });

  it('trims leading whitespace before detecting', () => {
    expect(detectPathType('  $.items')).toBe('jsonpath');
    expect(detectPathType('  .items')).toBe('jq');
  });
});

// ─── resolveArrayPath ────────────────────────────────────────────────────────
describe('resolveArrayPath', () => {
  const data = {
    items: [{ id: 1 }, { id: 2 }],
    store: { books: [{ title: 'A' }, { title: 'B' }] },
  };

  it('resolves dot path to array', () => {
    const { array, error } = resolveArrayPath(data, 'items');
    expect(error).toBeUndefined();
    expect(Array.isArray(array)).toBe(true);
    expect(array.length).toBe(2);
  });

  it('resolves nested dot path', () => {
    const { array, error } = resolveArrayPath(data, 'store.books');
    expect(error).toBeUndefined();
    expect(array.length).toBe(2);
    expect(array[0].title).toBe('A');
  });

  it('resolves JSONPath to array node', () => {
    const { array, error } = resolveArrayPath(data, '$.items');
    expect(error).toBeUndefined();
    expect(Array.isArray(array)).toBe(true);
    expect(array.length).toBe(2);
  });

  it('resolves nested JSONPath', () => {
    const { array, error } = resolveArrayPath(data, '$.store.books');
    expect(error).toBeUndefined();
    expect(array.length).toBe(2);
  });

  it('returns error for JSONPath with no match', () => {
    const { array, error } = resolveArrayPath(data, '$.notExist');
    expect(array).toBeNull();
    expect(error).toBeTruthy();
  });

  it('resolves jq expression to array', () => {
    const { array, error } = resolveArrayPath(data, '.items');
    expect(error).toBeUndefined();
    expect(Array.isArray(array)).toBe(true);
    expect(array.length).toBe(2);
  });

  it('resolves nested jq expression', () => {
    const { array, error } = resolveArrayPath(data, '.store.books');
    expect(error).toBeUndefined();
    expect(array[0].title).toBe('A');
  });

  it('returns error for jq expression pointing to non-array', () => {
    const { array, error } = resolveArrayPath(data, '.store');
    expect(array).toBeNull();
    expect(error).toBeTruthy();
  });

  it('returns error for jq expression with no match', () => {
    const { array, error } = resolveArrayPath(data, '.notExist');
    expect(array).toBeNull();
    expect(error).toBeTruthy();
  });
});

// ─── extractTableFromJson (JSONPath / jq paths) ───────────────────────────────
describe('extractTableFromJson – advanced arrayPath', () => {
  const nested = JSON.stringify({
    store: {
      books: [
        { title: 'Clean Code', author: 'Martin' },
        { title: 'SICP',       author: 'Abelson' },
      ],
    },
  });

  it('supports JSONPath arrayPath ($.store.books)', () => {
    const result = extractTableFromJson(nested, { arrayPath: '$.store.books' });
    expect(result.success).toBe(true);
    expect(result.totalRows).toBe(2);
    const titles = result.rows.map(r => r.title);
    expect(titles).toContain('Clean Code');
  });

  it('supports jq arrayPath (.store.books)', () => {
    const result = extractTableFromJson(nested, { arrayPath: '.store.books' });
    expect(result.success).toBe(true);
    expect(result.totalRows).toBe(2);
  });

  it('supports plain dot arrayPath (store.books)', () => {
    const result = extractTableFromJson(nested, { arrayPath: 'store.books' });
    expect(result.success).toBe(true);
    expect(result.totalRows).toBe(2);
  });

  it('returns error for JSONPath pointing to non-array', () => {
    const result = extractTableFromJson(nested, { arrayPath: '$.store' });
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns error for jq pointing to non-array', () => {
    const result = extractTableFromJson(nested, { arrayPath: '.store' });
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns error for JSONPath with no match', () => {
    const result = extractTableFromJson(nested, { arrayPath: '$.notExist' });
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ─── applyEditsToJson (nested arrayPath) ─────────────────────────────────────
describe('applyEditsToJson – nested arrayPath', () => {
  const original = JSON.stringify({
    data: {
      users: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
    },
  });

  it('applies edit via dot path arrayPath', () => {
    const result = applyEditsToJson(original, {
      arrayPath: 'data.users',
      edits: [{ rowIndex: 0, columnPath: 'name', newValue: 'Eve' }],
    });
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.jsonString);
    expect(parsed.data.users[0].name).toBe('Eve');
    expect(parsed.data.users[1].name).toBe('Bob');
  });

  it('applies edit via JSONPath arrayPath', () => {
    const result = applyEditsToJson(original, {
      arrayPath: '$.data.users',
      edits: [{ rowIndex: 1, columnPath: 'id', newValue: 99 }],
    });
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.jsonString);
    expect(parsed.data.users[1].id).toBe(99);
  });

  it('applies edit via jq arrayPath', () => {
    const result = applyEditsToJson(original, {
      arrayPath: '.data.users',
      edits: [{ rowIndex: 0, columnPath: 'name', newValue: 'Zara' }],
    });
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.jsonString);
    expect(parsed.data.users[0].name).toBe('Zara');
  });

  it('returns error for JSONPath matching multiple nodes', () => {
    const multiJson = JSON.stringify({ a: [1], b: [2] });
    const result = applyEditsToJson(multiJson, {
      arrayPath: '$.*',
      edits: [{ rowIndex: 0, columnPath: '_value', newValue: 99 }],
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ─── buildCsvString ──────────────────────────────────────────────────────────
describe('buildCsvString', () => {
  // columns first, then rows (and columns need visible:true)
  const columns = [
    { path: 'id',   label: 'ID',   visible: true },
    { path: 'name', label: 'Name', visible: true },
  ];
  const rows = [
    { _rowIndex: 0, id: 1, name: 'Alice' },
    { _rowIndex: 1, id: 2, name: 'Bob'   },
  ];

  it('includes header row with labels', () => {
    const csv = buildCsvString(columns, rows);
    expect(csv.split('\n')[0]).toBe('ID,Name');
  });

  it('includes data rows', () => {
    const csv = buildCsvString(columns, rows);
    const lines = csv.split('\n');
    expect(lines[1]).toBe('1,Alice');
    expect(lines[2]).toBe('2,Bob');
  });

  it('quotes values containing commas', () => {
    const specialRows = [{ _rowIndex: 0, id: 1, name: 'Smith, John' }];
    const csv = buildCsvString(columns, specialRows);
    expect(csv).toContain('"Smith, John"');
  });

  it('quotes values containing newlines', () => {
    const specialRows = [{ _rowIndex: 0, id: 1, name: 'line1\nline2' }];
    const csv = buildCsvString(columns, specialRows);
    expect(csv).toContain('"line1\nline2"');
  });

  it('returns only header for empty rows', () => {
    const csv = buildCsvString(columns, []);
    const lines = csv.split('\n').filter(l => l.length > 0);
    expect(lines.length).toBe(1);
    expect(lines[0]).toBe('ID,Name');
  });

  it('excludes invisible columns', () => {
    const colsWithHidden = [
      { path: 'id',     label: 'ID',     visible: true },
      { path: 'name',   label: 'Name',   visible: false },
      { path: 'score',  label: 'Score',  visible: true },
    ];
    const testRows = [{ _rowIndex: 0, id: 1, name: 'Alice', score: 90 }];
    const csv = buildCsvString(colsWithHidden, testRows);
    expect(csv.split('\n')[0]).toBe('ID,Score');
    expect(csv).not.toContain('Name');
  });
});
