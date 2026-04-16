import { JSONPath } from 'jsonpath-plus';
import { getValueAtJsonPath, toJsonPath } from '../utils/pathUtils.js';

let jqRuntimePromise = null;

/**
 * JSON 查询引擎 - 支持 JSONPath 和 jq 表达式
 */

/**
 * 自动检测查询表达式类型
 * @param {string} expression - 查询表达式
 * @returns {string} 'jsonpath' 或 'jq'
 */
export function detectQueryType(expression) {
  if (!expression || typeof expression !== 'string') {
    return 'jsonpath'; // 默认
  }

  const trimmed = expression.trim();

  // JSONPath 特征
  if (trimmed.startsWith('$')) return 'jsonpath';
  if (trimmed.includes('@.') || trimmed.includes('@[') || trimmed.includes('@(')) return 'jsonpath'; // 过滤器
  if (trimmed.includes('..')) return 'jsonpath'; // 递归下降

  // jq 特征
  if (trimmed.startsWith('.')) return 'jq';
  if (trimmed === '.' || trimmed === '.[]') return 'jq';
  if (trimmed.includes('|')) return 'jq'; // 管道符
  if (looksLikeJqFunctionExpression(trimmed)) return 'jq';

  // 如果都不符合，尝试检查括号形式
  if (trimmed.startsWith('[') && !trimmed.includes('..')) return 'jq'; // jq 风格的数组索引

  // 默认返回 jsonpath
  return 'jsonpath';
}

function looksLikeJqFunctionExpression(expression) {
  return /^(select|map|reduce|walk|paths|keys|has|length|type|flatten|unique|sort|sort_by|group_by|to_entries|from_entries|tostring|tonumber|toboolean|del|any|all|first|last|limit|indices|join|split|empty|range|match|test|capture|sub|gsub)\b/.test(expression);
}

/**
 * JSONPath 查询
 * 例: $.store.book[0].title
 */
export function queryJsonPath(data, expression) {
  try {
    if (typeof data === 'string') {
      data = JSON.parse(data);
    }

    const results = JSONPath({
      path: expression,
      json: data
    });

    const count = Array.isArray(results) ? results.length : results === null || results === undefined ? 0 : 1;
    const display = count === 0 ? null : normalizeForPanel(results);

    return {
      success: true,
      results,
      display,
      count,
      type: 'jsonpath'
    };
  } catch (e) {
    const message = (e?.message || '').trim() || 'JSONPath 表达式解析失败';
    return {
      success: false,
      error: message,
      display: null,
      type: 'jsonpath'
    };
  }
}

/**
 * 简化的 jq 查询实现（基于 JavaScript）
 * 支持常见的 jq 表达式
 * 例: .store.book[].price
 */
export async function queryJq(data, expression) {
  try {
    if (data === null || data === undefined) {
      throw new Error('输入数据为空');
    }
    if (typeof data === 'string') {
      data = JSON.parse(data);
    }

    const rawList = await evalJqExpression(data, expression);
    const display = rawList.length === 0 ? null : normalizeForPanel(rawList);

    return {
      success: true,
      results: rawList,
      display,
      count: rawList.length,
      type: 'jq'
    };
  } catch (e) {
    const message = (e?.message || '').trim() || 'jq 表达式解析失败';
    return {
      success: false,
      error: message,
      display: null,
      type: 'jq'
    };
  }
}

/**
 * 解析并执行 jq 表达式
 */
async function evalJqExpression(data, expr) {
  try {
    const runtime = await loadJqRuntime();
    const rawResult = await runtime.raw(data, expr, ['-c']);
    return parseJqRawResult(rawResult);
  } catch (e) {
    throw new Error(`jq 表达式解析失败: ${e.message}`);
  }
}

async function loadJqRuntime() {
  if (!jqRuntimePromise) {
    jqRuntimePromise = import('jq-wasm').then((module) => module?.raw ? module : (module?.default ?? module));
  }

  return jqRuntimePromise;
}

function parseJqRawResult(rawResult) {
  const stdout = typeof rawResult?.stdout === 'string' ? rawResult.stdout : '';
  const stderr = typeof rawResult?.stderr === 'string' ? rawResult.stderr : '';
  const exitCode = Number.isInteger(rawResult?.exitCode) ? rawResult.exitCode : 0;

  if (exitCode !== 0) {
    throw new Error(stderr || `jq 退出码 ${exitCode}`);
  }

  if (stderr.trim()) {
    throw new Error(stderr.trim());
  }

  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }

  const lines = trimmed.split('\n').filter(Boolean);
  try {
    return lines.map(line => JSON.parse(line));
  } catch (e) {
    throw new Error(`jq 输出解析失败: ${e.message}`);
  }
}

/**
 * 解析 jq 路径
 */
function parseJqPath(expr) {
  const parts = [];
  let current = '';
  let i = 0;

  while (i < expr.length) {
    const char = expr[i];

    if (char === '.') {
      if (current) {
        parts.push({ type: 'property', name: current });
        current = '';
      }
      i++;
    } else if (char === '[') {
      if (current) {
        parts.push({ type: 'property', name: current });
        current = '';
      }

      let j = i + 1;
      let bracket = '';
      while (j < expr.length && expr[j] !== ']') {
        bracket += expr[j];
        j++;
      }

      if (bracket === '') {
        parts.push({ type: 'iterator' });
      } else if (/^\d+$/.test(bracket)) {
        parts.push({ type: 'index', index: parseInt(bracket, 10) });
      } else if (bracket.includes(':')) {
        const [start, end] = bracket.split(':');
        parts.push({
          type: 'slice',
          start: start ? parseInt(start, 10) : 0,
          end: end ? parseInt(end, 10) : null
        });
      } else {
        parts.push({ type: 'filter', condition: bracket });
      }

      i = j + 1;
    } else {
      current += char;
      i++;
    }
  }

  if (current) {
    parts.push({ type: 'property', name: current });
  }

  return parts;
}

/**
 * 匹配过滤条件
 */
function matchesFilter(item, condition) {
  try {
    if (condition.includes('==')) {
      const [key, value] = condition.split('==').map(s => s.trim());
      const keyPath = key.startsWith('.') ? key.substring(1) : key;
      const actualValue = value.replace(/['"]/g, '');
      return String(getNestedValue(item, keyPath)) === actualValue;
    } else if (condition.includes('>')) {
      const [key, value] = condition.split('>').map(s => s.trim());
      const keyPath = key.startsWith('.') ? key.substring(1) : key;
      return Number(getNestedValue(item, keyPath)) > Number(value);
    } else if (condition.includes('<')) {
      const [key, value] = condition.split('<').map(s => s.trim());
      const keyPath = key.startsWith('.') ? key.substring(1) : key;
      return Number(getNestedValue(item, keyPath)) < Number(value);
    }
  } catch (e) {
    return false;
  }
  return true;
}

/**
 * 获取嵌套值
 */
function getNestedValue(obj, path) {
  try {
    if (!path) return undefined;
    // Convert dot/bracket path like "a.b[0].c" into JSONPath-like "$.a.b[0].c"
    const jsonPath = toJsonPath(path);
    return getValueAtJsonPath(obj, jsonPath);
  } catch (e) {
    return undefined;
  }
}

/**
 * 获取查询结果的路径信息（用于高亮）
 */
export function getQueryPaths(data, expression, type = 'jsonpath') {
  try {
    if (typeof data === 'string') {
      data = JSON.parse(data);
    }

    const paths = [];

    if (type === 'jsonpath') {
      const resultPaths = JSONPath({
        path: expression,
        json: data,
        resultType: 'path'
      });

      resultPaths.forEach(path => {
        paths.push({
          path: path.join('.'),
          fullPath: '$.' + path.join('.')
        });
      });
    } else if (type === 'jq') {
      const parts = parseJqPath(expression.startsWith('.') ? expression.substring(1) : expression);

      const partsToPath = parts.map(p => {
        if (p.type === 'property') return p.name;
        if (p.type === 'index') return `[${p.index}]`;
        if (p.type === 'iterator') return '[]';
        return '';
      }).join('.').replace(/\.?\[\]/g, '[]'); // keep iterator notation tidy

      paths.push({
        path: partsToPath,
        fullPath: toJsonPath(partsToPath)
      });
    }

    return {
      success: true,
      paths
    };
  } catch (e) {
    return {
      success: false,
      error: e.message
    };
  }
}

/**
 * 验证查询表达式
 */
export function validateQuery(expression, type = 'jsonpath') {
  try {
    if (type === 'jsonpath') {
      if (!expression.startsWith('$')) {
        return { valid: false, message: 'JSONPath 必须以 $ 开头' };
      }
    } else if (type === 'jq') {
      if (!expression || !expression.trim()) {
        return { valid: false, message: 'jq 表达式不能为空' };
      }
    }

    return { valid: true };
  } catch (e) {
    return { valid: false, message: e.message };
  }
}

export default {
  queryJsonPath,
  queryJq,
  getQueryPaths,
  validateQuery
};

/**
 * 将面板展示值归一化，单个值返回原始类型，多值保持数组
 */
function normalizeForPanel(content) {
  if (Array.isArray(content)) {
    if (content.length === 1) {
      return content[0];
    }
    return content;
  }
  return content;
}