/**
 * tableView.js
 *
 * 表格视图核心服务：负责 JSON ↔ 表格数据转换、类型推断、过滤/排序、导出等纯函数。
 * 不依赖任何 UI 框架，可直接被 Vue 组件或测试文件引用。
 */

import { JSONPath } from 'jsonpath-plus';
import { getStringifyIndent } from '../utils/indent.js';

// =============================================
// 0. 表达式类型检测与统一求值
// =============================================

/**
 * 自动检测 arrayPath 的语法类型。
 * - 以 '$' 开头 → 'jsonpath'
 * - 以 '.' 开头 → 'jq'
 * - 其它 → 'dot'（点路径，原有行为）
 * @param {string} path
 * @returns {'jsonpath'|'jq'|'dot'}
 */
export function detectPathType(path) {
  if (!path) return 'dot';
  const p = path.trim();
  if (p.startsWith('$')) return 'jsonpath';
  if (p.startsWith('.')) return 'jq';
  return 'dot';
}

/**
 * 使用指定类型的表达式在解析好的 JSON 对象上查找目标数组。
 * 对于 JSONPath/jq 两种类型，若表达式指向某个数组节点（结果为单个数组），
 * 则返回该数组；若结果本身是多个元素组成的集合，则返回该集合数组。
 * @param {any} parsed 已解析的 JSON 对象
 * @param {string} path 路径表达式
 * @returns {{ array: any[]|null, refPath: string[]|null, error?: string }}
 *   - array：定位到的数组（用于读）
 *   - refPath：JSONPath 字符串路径（用于写回定位），仅 jsonpath/dot 有意义
 */
export function resolveArrayPath(parsed, path) {
  const type = detectPathType(path);

  if (type === 'dot') {
    const arr = getByDotPath(parsed, path);
    return { array: arr, refPath: path };
  }

  if (type === 'jsonpath') {
    try {
      const results = JSONPath({ path, json: parsed });
      if (!Array.isArray(results) || results.length === 0) {
        return { array: null, refPath: null, error: `JSONPath "${path}" 无匹配结果` };
      }
      // 若结果数组只有一项且该项本身是数组，将其展开（典型场景：$.items -> 数组节点）
      if (results.length === 1 && Array.isArray(results[0])) {
        // 同时获取精确路径用于写回
        const pathStrs = JSONPath({ path, json: parsed, resultType: 'path' });
        const refPath = pathStrs && pathStrs[0] ? pathStrs[0] : null;
        return { array: results[0], refPath };
      }
      // 若结果只有一项但该项不是数组，说明路径指向了一个非数组节点 → 报错
      if (results.length === 1 && !Array.isArray(results[0])) {
        return { array: null, refPath: null, error: `JSONPath "${path}" 指向的值不是数组` };
      }
      // 否则把匹配到的若干元素本身当作行集合
      return { array: results, refPath: null };
    } catch (e) {
      return { array: null, refPath: null, error: `JSONPath 解析失败: ${e.message}` };
    }
  }

  if (type === 'jq') {
    // 使用内部的简化 jq 实现
    try {
      const arr = evalSimpleJq(parsed, path);
      if (arr === null || arr === undefined) {
        return { array: null, refPath: null, error: `jq 表达式 "${path}" 无匹配结果` };
      }
      if (Array.isArray(arr)) {
        // 若结果是单个数组（即整个节点本身是数组），直接使用
        return { array: arr, refPath: null };
      }
      return { array: null, refPath: null, error: `jq 表达式 "${path}" 未返回数组` };
    } catch (e) {
      return { array: null, refPath: null, error: `jq 解析失败: ${e.message}` };
    }
  }

  return { array: null, refPath: null, error: `未知路径类型` };
}

/**
 * 简化的 jq 表达式求值（仅支持属性访问与数组索引）。
 * 例：'.store.books' / '.a.b[0]'
 * @param {any} data
 * @param {string} expr
 * @returns {any}
 */
function evalSimpleJq(data, expr) {
  let e = expr.trim();
  if (e.startsWith('.')) e = e.slice(1);
  if (e === '' || e === '.') return data;
  // 逐步解析 .key 与 [n] 访问
  const tokenRe = /([^.[[\]]+)|\[(\d+)\]/g;
  let cur = data;
  // 按分隔符 . 与 [ 切分，逐步访问
  let remaining = e;
  while (remaining.length > 0 && cur != null) {
    // 匹配 .key 或 [n] 或 key
    const dotMatch = remaining.match(/^\.?([^.[[\]]+)(.*)/);
    const bracketMatch = remaining.match(/^\[(\d+)\](.*)/);
    if (dotMatch) {
      const key = dotMatch[1];
      remaining = dotMatch[2] || '';
      cur = cur[key];
    } else if (bracketMatch) {
      const idx = parseInt(bracketMatch[1], 10);
      remaining = bracketMatch[2] || '';
      cur = Array.isArray(cur) ? cur[idx] : undefined;
    } else {
      break;
    }
  }
  return cur;
}

/**
 * 将 jsonpath-plus resultType:'path' 返回的路径字符串转换为 dot 路径。
 * 支持两种格式：
 *  - bracket 格式：$['data']['users']  → data.users
 *  - dot 格式：   $.data.users         → data.users
 * @param {string} pathStr
 * @returns {string}
 */
function jsonPathStrToDotPath(pathStr) {
  // 去掉开头的 $
  let s = pathStr.replace(/^\$/, '');
  // 替换 ['key'] 为 .key
  s = s.replace(/\['([^']+)'\]/g, '.$1');
  // 替换 ["key"] 为 .key
  s = s.replace(/\["([^"]+)"\]/g, '.$1');
  // 替换 [n] 数字索引为 .n（getByDotPath 不支持数组下标，但这里我们用点路径会失败）
  // 对于数字索引，实际上 getByDotPath 会把 '0' 作为属性名访问数组，刚好有效
  s = s.replace(/\[(\d+)\]/g, '.$1');
  // 去掉开头多余的 .
  s = s.replace(/^\./, '');
  return s;
}

// =============================================
// 1. 点路径工具函数
// =============================================

/**
 * 按 dot 路径读取对象中的值（例如 "user.name" → obj.user.name）。
 * 不支持数组下标语法，仅处理对象属性访问。
 * @param {object} obj
 * @param {string} path
 * @returns {any}
 */
export function getByDotPath(obj, path) {
  if (obj == null || !path) return undefined;
  const parts = path.split('.');
  let cur = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

/**
 * 按 dot 路径写入对象中的值，逐层创建不存在的对象节点。
 * @param {object} obj
 * @param {string} path
 * @param {any} value
 */
export function setByDotPath(obj, path, value) {
  if (obj == null || !path) return;
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (cur[part] == null || typeof cur[part] !== 'object') {
      cur[part] = {};
    }
    cur = cur[part];
  }
  cur[parts[parts.length - 1]] = value;
}

// =============================================
// 2. 路径收集与类型推断
// =============================================

/**
 * 从行对象数组中收集所有 dot 路径，递归展开嵌套对象，限制深度。
 * 排除内部字段 _rowIndex。
 * @param {object[]} rows
 * @param {number} maxDepth
 * @returns {string[]}
 */
export function collectAllPaths(rows, maxDepth = 3) {
  const pathSet = new Set();

  function traverse(obj, prefix, depth) {
    if (depth > maxDepth || obj == null || typeof obj !== 'object' || Array.isArray(obj)) return;
    for (const key of Object.keys(obj)) {
      if (key === '_rowIndex') continue;
      const fullPath = prefix ? `${prefix}.${key}` : key;
      pathSet.add(fullPath);
      if (depth < maxDepth && obj[key] != null && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
        traverse(obj[key], fullPath, depth + 1);
      }
    }
  }

  // 仅对前 100 行采样，避免超大数组卡顿
  const sample = rows.slice(0, 100);
  for (const row of sample) {
    traverse(row, '', 1);
  }

  return Array.from(pathSet);
}

/**
 * 对给定路径在所有行中推断主导类型（抽样 100 行）。
 * 返回 TableColumn[] 数组。
 * @param {object[]} rows
 * @param {string[]} paths
 * @returns {import('./tableView.js').TableColumn[]}
 */
export function detectColumnTypes(rows, paths) {
  const sample = rows.slice(0, 100);

  return paths.map(path => {
    const typeCounts = {};
    for (const row of sample) {
      const val = getByDotPath(row, path);
      let type = 'string';
      if (val === null || val === undefined) type = 'null';
      else if (typeof val === 'number') type = 'number';
      else if (typeof val === 'boolean') type = 'boolean';
      else if (Array.isArray(val)) type = 'array';
      else if (typeof val === 'object') type = 'object';
      else type = 'string';
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    }
    // 找出出现最多的类型（排除 null）
    let dominantType = 'string';
    let maxCount = 0;
    for (const [t, cnt] of Object.entries(typeCounts)) {
      if (t !== 'null' && cnt > maxCount) {
        dominantType = t;
        maxCount = cnt;
      }
    }
    if (maxCount === 0) dominantType = 'string'; // 全是 null

    return {
      id: path,
      path,
      label: path,
      type: dominantType,
      visible: true,
      editable: dominantType !== 'object' && dominantType !== 'array'
    };
  });
}

// =============================================
// 3. 核心：JSON → 表格数据提取
// =============================================

/**
 * 从 JSON 字符串中提取表格数据（行 + 列）。
 * arrayPath 支持三种格式（自动识别）：
 *  - 以 $ 开头：JSONPath 表达式，例如 $.items
 *  - 以 . 开头：jq 表达式，例如 .store.books
 *  - 其它：点分路径，例如 store.books（原有行为）
 * @param {string} jsonString
 * @param {{ arrayPath?: string|null, sampleLimit?: number }} options
 * @returns {{ success: boolean, rows: object[], columns: object[], totalRows: number, error?: string }}
 */
export function extractTableFromJson(jsonString, { arrayPath = null, sampleLimit = 200 } = {}) {
  try {
    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch (e) {
      return { success: false, rows: [], columns: [], totalRows: 0, error: `JSON 解析失败: ${e.message}` };
    }

    // 定位目标数组（支持 JSONPath / jq / 点路径）
    let targetArray;
    if (arrayPath) {
      const resolved = resolveArrayPath(parsed, arrayPath);
      if (resolved.error) {
        return { success: false, rows: [], columns: [], totalRows: 0, error: resolved.error };
      }
      targetArray = resolved.array;
    } else {
      targetArray = parsed;
    }

    if (!Array.isArray(targetArray)) {
      return {
        success: false,
        rows: [],
        columns: [],
        totalRows: 0,
        error: arrayPath
          ? `路径 "${arrayPath}" 对应的值不是数组`
          : 'JSON 根节点不是数组，请指定目标数组路径'
      };
    }

    if (targetArray.length === 0) {
      return { success: true, rows: [], columns: [], totalRows: 0 };
    }

    // 构建行：每行保留原始数组索引
    const rows = targetArray.map((item, index) => {
      if (item == null || typeof item !== 'object' || Array.isArray(item)) {
        // 原子值行：用 _value 字段包装
        return { _rowIndex: index, _value: item };
      }
      return { _rowIndex: index, ...item };
    });

    // 收集所有路径并推断类型（使用前 sampleLimit 行）
    const sampleRows = rows.slice(0, sampleLimit);
    const paths = collectAllPaths(sampleRows, 3);

    // 若为原子值数组，只有 _value 路径
    const finalPaths = paths.length > 0 ? paths : ['_value'];
    const columns = detectColumnTypes(rows, finalPaths);

    return {
      success: true,
      rows,
      columns,
      totalRows: rows.length
    };
  } catch (e) {
    return { success: false, rows: [], columns: [], totalRows: 0, error: `提取失败: ${e.message}` };
  }
}

// =============================================
// 4. 核心：将编辑应用回 JSON
// =============================================

/**
 * 将一组 TableEdit 应用回原始 JSON，返回格式化后的 JSON 字符串。
 * arrayPath 支持 JSONPath / jq / 点路径（自动识别）。
 * 注意：jq 路径与返回多个离散元素的 JSONPath 表达式不支持写回（无法精确定位原始位置），
 * 此时函数会返回错误。
 * @param {string} jsonString 原始 JSON 字符串
 * @param {{ arrayPath?: string|null, edits: Array<{rowIndex: number, columnPath: string, newValue: any}> }} options
 * @returns {{ success: boolean, jsonString: string, error?: string }}
 */
export function applyEditsToJson(jsonString, { arrayPath = null, edits = [] } = {}) {
  try {
    if (!edits || edits.length === 0) {
      return { success: true, jsonString };
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch (e) {
      return { success: false, jsonString, error: `JSON 解析失败: ${e.message}` };
    }

    let targetArray;
    if (arrayPath) {
      const type = detectPathType(arrayPath);

      if (type === 'jsonpath') {
        // 使用 JSONPath 的 path 模式获取精确路径，然后通过 pathUtils 原位写入
        let paths;
        try {
          paths = JSONPath({ path: arrayPath, json: parsed, resultType: 'path' });
        } catch (e) {
          return { success: false, jsonString, error: `JSONPath 解析失败: ${e.message}` };
        }
        if (!paths || paths.length === 0) {
          return { success: false, jsonString, error: `JSONPath "${arrayPath}" 无匹配结果` };
        }
        if (paths.length > 1) {
          return { success: false, jsonString, error: `JSONPath "${arrayPath}" 匹配到多个节点，不支持写回（请使用更精确的路径）` };
        }
        // JSONPath resultType:'path' 返回字符串，如 "$['data']['users']"
        // 需要解析为 dot 路径以便 getByDotPath 使用
        const pathRaw = paths[0]; // 字符串形式: $['data']['users'] 或 $.data.users
        const pathStr = jsonPathStrToDotPath(pathRaw);
        targetArray = getByDotPath(parsed, pathStr);
        if (!Array.isArray(targetArray)) {
          return { success: false, jsonString, error: '目标路径不是数组' };
        }
      } else if (type === 'jq') {
        // jq 表达式：获取数组引用（evalSimpleJq 返回对原始对象的引用，可直接修改）
        try {
          targetArray = evalSimpleJq(parsed, arrayPath);
        } catch (e) {
          return { success: false, jsonString, error: `jq 解析失败: ${e.message}` };
        }
        if (!Array.isArray(targetArray)) {
          return { success: false, jsonString, error: `jq 表达式 "${arrayPath}" 未返回数组，不支持写回` };
        }
      } else {
        // 点路径（原有行为）
        targetArray = getByDotPath(parsed, arrayPath);
      }
    } else {
      targetArray = parsed;
    }

    if (!Array.isArray(targetArray)) {
      return { success: false, jsonString, error: '目标路径不是数组' };
    }

    for (const edit of edits) {
      const { rowIndex, columnPath, newValue } = edit;
      if (rowIndex < 0 || rowIndex >= targetArray.length) continue;
      const item = targetArray[rowIndex];
      if (columnPath === '_value') {
        // 原子值行
        targetArray[rowIndex] = newValue;
      } else if (item != null && typeof item === 'object' && !Array.isArray(item)) {
        setByDotPath(item, columnPath, newValue);
      }
    }

    return { success: true, jsonString: JSON.stringify(parsed, null, getStringifyIndent()) };
  } catch (e) {
    return { success: false, jsonString, error: `应用修改失败: ${e.message}` };
  }
}

// =============================================
// 5. 过滤与排序
// =============================================

/**
 * 对行数组执行全局搜索、列过滤与列排序。
 * @param {object[]} rows
 * @param {{ globalSearch?: string, columnFilters?: Record<string, string>, sortColumn?: string|null, sortDir?: 'asc'|'desc' }} options
 * @returns {object[]}
 */
export function filterAndSortRows(rows, { globalSearch = '', columnFilters = {}, sortColumn = null, sortDir = 'asc' } = {}) {
  let result = rows;

  // 全局搜索（对每行所有字段做字符串匹配，忽略大小写）
  if (globalSearch && globalSearch.trim()) {
    const q = globalSearch.trim().toLowerCase();
    result = result.filter(row => {
      return Object.entries(row).some(([key, val]) => {
        if (key === '_rowIndex') return false;
        return String(val).toLowerCase().includes(q);
      });
    });
  }

  // 列过滤
  for (const [colPath, filterVal] of Object.entries(columnFilters)) {
    if (!filterVal || !filterVal.trim()) continue;
    const q = filterVal.trim().toLowerCase();
    result = result.filter(row => {
      const val = getByDotPath(row, colPath);
      return String(val == null ? '' : val).toLowerCase().includes(q);
    });
  }

  // 排序
  if (sortColumn) {
    result = [...result].sort((a, b) => {
      const av = getByDotPath(a, sortColumn);
      const bv = getByDotPath(b, sortColumn);
      // null/undefined 排在末尾
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const aStr = typeof av === 'string' ? av : String(av);
      const bStr = typeof bv === 'string' ? bv : String(bv);
      // 尝试数字比较
      const aNum = Number(av);
      const bNum = Number(bv);
      if (!isNaN(aNum) && !isNaN(bNum)) {
        return sortDir === 'asc' ? aNum - bNum : bNum - aNum;
      }
      return sortDir === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
    });
  }

  return result;
}

// =============================================
// 6. 导出
// =============================================

/**
 * 将表格数据导出为 CSV 并触发浏览器下载。
 * @param {object[]} columns 可见列（含 path 和 label）
 * @param {object[]} rows
 * @param {string} filename
 */
export function exportTableToCsv(columns, rows, filename = 'table-export.csv') {
  const visibleCols = columns.filter(c => c.visible);
  const header = visibleCols.map(c => csvEscape(c.label)).join(',');
  const lines = rows.map(row => {
    return visibleCols.map(col => {
      const val = getByDotPath(row, col.path);
      if (val === null || val === undefined) return '';
      if (typeof val === 'object') return csvEscape(JSON.stringify(val));
      return csvEscape(String(val));
    }).join(',');
  });
  const content = [header, ...lines].join('\n');
  downloadFile(content, filename, 'text/csv;charset=utf-8;');
}

function csvEscape(str) {
  const s = String(str);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * 将表格数据导出为 XLSX 并触发浏览器下载（依赖 xlsx 库）。
 * @param {object[]} columns 可见列
 * @param {object[]} rows
 * @param {string} filename
 */
export async function exportTableToXlsx(columns, rows, filename = 'table-export.xlsx') {
  try {
    const XLSX = await import('xlsx');
    const visibleCols = columns.filter(c => c.visible);
    const header = visibleCols.map(c => c.label);
    const data = rows.map(row => {
      return visibleCols.map(col => {
        const val = getByDotPath(row, col.path);
        if (val === null || val === undefined) return '';
        if (typeof val === 'object') return JSON.stringify(val);
        return val;
      });
    });
    const wsData = [header, ...data];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, filename);
  } catch (e) {
    // fallback to CSV
    exportTableToCsv(columns, rows, filename.replace('.xlsx', '.csv'));
  }
}

// =============================================
// 7. 工具：生成 CSV 字符串（供测试用，不含下载）
// =============================================

/**
 * 与 exportTableToCsv 相同但返回字符串而非下载，供测试使用。
 * @param {object[]} columns
 * @param {object[]} rows
 * @returns {string}
 */
export function buildCsvString(columns, rows) {
  const visibleCols = columns.filter(c => c.visible);
  const header = visibleCols.map(c => csvEscape(c.label)).join(',');
  const lines = rows.map(row => {
    return visibleCols.map(col => {
      const val = getByDotPath(row, col.path);
      if (val === null || val === undefined) return '';
      if (typeof val === 'object') return csvEscape(JSON.stringify(val));
      return csvEscape(String(val));
    }).join(',');
  });
  return [header, ...lines].join('\n');
}

function downloadFile(content, filename, mimeType) {
  try {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[tableView] downloadFile failed', e);
  }
}
