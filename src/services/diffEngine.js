/**
 * JSON 对比引擎 - 用于检测两个 JSON 的结构差异
 */
import { getValueAtJsonPath, setValueAtJsonPath, toJsonPath } from '../utils/pathUtils.js';

/**
 * 获取两个对象之间的差异（行/项列表）
 */
export function getDifferences(json1, json2, options = {}) {
  try {
    let data1 = typeof json1 === 'string' ? JSON.parse(json1) : json1;
    let data2 = typeof json2 === 'string' ? JSON.parse(json2) : json2;
    
    const { ignoreFields = [], ignoreOrder = false, ignoreValue = false } = options;
    
    // 排序后对比（如需要）
    if (ignoreOrder) {
      data1 = sortObject(data1);
      data2 = sortObject(data2);
    }
    
    const differences = [];
    compareDiff(data1, data2, '', differences, ignoreFields, ignoreValue);
    
    return {
      success: true,
      differences: differences,
      hasDifferences: differences.length > 0
    };
  } catch (e) {
    return {
      success: false,
      error: e.message
    };
  }
}

export function stringifySortedJson(source) {
  const data = typeof source === 'string' ? JSON.parse(source) : source;
  const sorted = sortObject(data);
  return JSON.stringify(sorted, null, 2);
}

/**
 * 递归比对两个对象（用于构建扁平差异列表）
 */
function compareDiff(obj1, obj2, path, differences, ignoreFields, ignoreValue) {
  const type1 = getType(obj1);
  const type2 = getType(obj2);
  
  // 类型不同
  if (type1 !== type2) {
    differences.push({
      path: path || '/',
      type: 'type-mismatch',
      left: { type: type1, value: obj1 },
      right: { type: type2, value: obj2 }
    });
    return;
  }
  
  // 基本类型对比
  if (type1 !== 'object' && type1 !== 'array') {
    if (!ignoreValue && obj1 !== obj2) {
      differences.push({
        path: path || '/',
        type: 'value-change',
        left: obj1,
        right: obj2
      });
    }
    return;
  }
  
  // 对象对比
  if (type1 === 'object') {
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    const allKeys = new Set([...keys1, ...keys2]);
    
    for (const key of allKeys) {
      if (ignoreFields.includes(key)) continue;
      
      const newPath = path ? `${path}.${key}` : key;
      
      if (!(key in obj1)) {
        differences.push({
          path: newPath,
          type: 'key-added',
          value: obj2[key]
        });
      } else if (!(key in obj2)) {
        differences.push({
          path: newPath,
          type: 'key-removed',
          value: obj1[key]
        });
      } else {
        compareDiff(obj1[key], obj2[key], newPath, differences, ignoreFields, ignoreValue);
      }
    }
    return;
  }
  
  // 数组对比
  if (type1 === 'array') {
    const len1 = obj1.length;
    const len2 = obj2.length;
    
    if (len1 !== len2) {
      differences.push({
        path: path,
        type: 'array-length-change',
        left: len1,
        right: len2
      });
    }
    
    const maxLen = Math.max(len1, len2);
    for (let i = 0; i < maxLen; i++) {
      const newPath = `${path}[${i}]`;
      
      if (i >= len1) {
        differences.push({
          path: newPath,
          type: 'array-item-added',
          value: obj2[i]
        });
      } else if (i >= len2) {
        differences.push({
          path: newPath,
          type: 'array-item-removed',
          value: obj1[i]
        });
      } else {
        compareDiff(obj1[i], obj2[i], newPath, differences, ignoreFields, ignoreValue);
      }
    }
  }
}

/**
 * 获取值的类型
 */
function getType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * 对对象进行深度排序
 */
function sortObject(obj) {
  if (Array.isArray(obj)) {
    return obj.map(sortObject);
  } else if (obj !== null && typeof obj === 'object') {
    const sortedKeys = Object.keys(obj).sort();
    const result = {};
    for (const key of sortedKeys) {
      result[key] = sortObject(obj[key]);
    }
    return result;
  }
  return obj;
}

/**
 * 分类差异
 */
export function categorizeDifferences(differences) {
  const categories = {
    keyAdded: [],
    keyRemoved: [],
    typeChange: [],
    valueChange: [],
    arrayChange: [],
    other: []
  };
  
  for (const diff of differences) {
    if (diff.type === 'key-added') {
      categories.keyAdded.push(diff);
    } else if (diff.type === 'key-removed') {
      categories.keyRemoved.push(diff);
    } else if (diff.type === 'type-mismatch') {
      categories.typeChange.push(diff);
    } else if (diff.type === 'value-change') {
      categories.valueChange.push(diff);
    } else if (diff.type === 'array-length-change' || diff.type === 'array-item-added' || diff.type === 'array-item-removed') {
      categories.arrayChange.push(diff);
    } else {
      categories.other.push(diff);
    }
  }
  
  return categories;
}

/**
 * 生成差异摘要
 */
export function generateDiffSummary(differences) {
  const categories = categorizeDifferences(differences);
  
  return {
    total: differences.length,
    keyAdded: categories.keyAdded.length,
    keyRemoved: categories.keyRemoved.length,
    typeChanges: categories.typeChange.length,
    valueChanges: categories.valueChange.length,
    arrayChanges: categories.arrayChange.length,
    categories: categories
  };
}

/**
 * 仅保留差异部分
 */
export function extractOnlyDifferences(json1, json2, options = {}) {
  try {
    let data1 = typeof json1 === 'string' ? JSON.parse(json1) : json1;
    let data2 = typeof json2 === 'string' ? JSON.parse(json2) : json2;
    
    const differences = getDifferences(data1, data2, options);
    
    if (!differences.success) {
      return differences;
    }
    
    // 构建只包含差异的结构
    const left = {};
    const right = {};
    
    for (const diff of differences.differences) {
      // handle root-path diffs
      if (!diff.path || diff.path === '/' || diff.path === '$') {
        // include entire documents
        return {
          success: true,
          left: data1,
          right: data2,
          differences: differences.differences
        };
      }

      const jsonPath = toJsonPath(diff.path);
      const leftVal = getValueAtJsonPath(data1, jsonPath);
      const rightVal = getValueAtJsonPath(data2, jsonPath);

      // set into result objects using pathUtils (creates containers as needed)
      // ignore failures (e.g., setting array index on non-array) to keep best-effort behavior
      try { setValueAtJsonPath(left, jsonPath, leftVal); } catch (e) { /* ignore */ }
      try { setValueAtJsonPath(right, jsonPath, rightVal); } catch (e) { /* ignore */ }
    }

    return {
      success: true,
      left: left,
      right: right,
      differences: differences.differences
    };
  } catch (e) {
    return {
      success: false,
      error: e.message
    };
  }
}

/**
 * 设置嵌套值 (使用 pathUtils)
 */
function setNestedValue(obj, path, value) {
  if (!path || path === '/' || path === '$') {
    return false;
  }
  const jsonPath = toJsonPath(path);
  try {
    return setValueAtJsonPath(obj, jsonPath, value);
  } catch (e) {
    return false;
  }
}

/**
 * 获取嵌套值 (使用 pathUtils)
 */
function getValueByPath(obj, path) {
  if (!path || path === '/' || path === '$') return obj;
  const jsonPath = toJsonPath(path);
  try {
    return getValueAtJsonPath(obj, jsonPath);
  } catch (e) {
    return undefined;
  }
}

/**
 * 构建行级 Diff（LCS 算法）
 */
export function buildLineDiffs(leftLines, rightLines) {
  const leftLen = leftLines.length;
  const rightLen = rightLines.length;
  const dp = Array.from({ length: leftLen + 1 }, () => new Array(rightLen + 1).fill(0));

  for (let i = leftLen - 1; i >= 0; i--) {
    for (let j = rightLen - 1; j >= 0; j--) {
      if (leftLines[i] === rightLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const diffLines = [];
  let i = 0;
  let j = 0;
  while (i < leftLen && j < rightLen) {
    if (leftLines[i] === rightLines[j]) {
      diffLines.push({
        left: leftLines[i],
        right: rightLines[j],
        leftLine: i + 1,
        rightLine: j + 1,
        type: 'unchanged'
      });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      diffLines.push({
        left: leftLines[i],
        right: '',
        leftLine: i + 1,
        type: 'removed'
      });
      i++;
    } else {
      diffLines.push({
        left: '',
        right: rightLines[j],
        rightLine: j + 1,
        type: 'added'
      });
      j++;
    }
  }

  while (i < leftLen) {
    diffLines.push({
      left: leftLines[i],
      right: '',
      leftLine: i + 1,
      type: 'removed'
    });
    i++;
  }

  while (j < rightLen) {
    diffLines.push({
      left: '',
      right: rightLines[j],
      rightLine: j + 1,
      type: 'added'
    });
    j++;
  }

  return diffLines;
}

/**
 * 构建树形节点级 Diff
 * 返回节点结构：
 * {
 *   key,
 *   path,
 *   type: 'added'|'removed'|'changed'|'unchanged',
 *   leftValue,
 *   rightValue,
 *   children: []
 * }
 */
export function buildTreeDiff(leftSource, rightSource) {
  const left = typeof leftSource === 'string' ? JSON.parse(leftSource) : leftSource;
  const right = typeof rightSource === 'string' ? JSON.parse(rightSource) : rightSource;

  function buildNode(key, l, r, path) {
    const node = {
      key,
      path: path || (key === undefined ? '$' : key),
      type: 'unchanged',
      leftValue: l === undefined ? undefined : l,
      rightValue: r === undefined ? undefined : r,
      children: []
    };

    const tL = getType(l);
    const tR = getType(r);

    // key only in right
    if (l === undefined && r !== undefined) {
      node.type = 'added';
      // If object/array, still expand children for readability
      if (tR === 'object') {
        for (const childKey of Object.keys(r)) {
          node.children.push(buildNode(childKey, undefined, r[childKey], `${node.path}.${childKey}`));
        }
      } else if (tR === 'array') {
        for (let i = 0; i < r.length; i++) {
          node.children.push(buildNode(`[${i}]`, undefined, r[i], `${node.path}[${i}]`));
        }
      }
      return node;
    }

    // key only in left
    if (l !== undefined && r === undefined) {
      node.type = 'removed';
      if (tL === 'object') {
        for (const childKey of Object.keys(l)) {
          node.children.push(buildNode(childKey, l[childKey], undefined, `${node.path}.${childKey}`));
        }
      } else if (tL === 'array') {
        for (let i = 0; i < l.length; i++) {
          node.children.push(buildNode(`[${i}]`, l[i], undefined, `${node.path}[${i}]`));
        }
      }
      return node;
    }

    // both exist
    if (tL !== tR) {
      node.type = 'changed';
      return node;
    }

    if (tL !== 'object' && tL !== 'array') {
      // primitive
      if (l === r) {
        node.type = 'unchanged';
      } else {
        node.type = 'changed';
      }
      return node;
    }

    if (tL === 'object') {
      const keys = new Set([...Object.keys(l || {}), ...Object.keys(r || {})]);
      for (const k of keys) {
        const childL = (l && k in l) ? l[k] : undefined;
        const childR = (r && k in r) ? r[k] : undefined;
        node.children.push(buildNode(k, childL, childR, `${node.path}${node.path === '$' ? '' : '.'}${k}`));
      }
      // determine node type
      if (node.children.every(c => c.type === 'unchanged')) {
        node.type = 'unchanged';
      } else {
        node.type = 'changed';
      }
      return node;
    }

    if (tL === 'array') {
      const maxLen = Math.max((l || []).length, (r || []).length);
      for (let i = 0; i < maxLen; i++) {
        const childL = (l && i < l.length) ? l[i] : undefined;
        const childR = (r && i < r.length) ? r[i] : undefined;
        node.children.push(buildNode(i, childL, childR, `${node.path}[${i}]`));
      }
      if (node.children.every(c => c.type === 'unchanged')) {
        node.type = 'unchanged';
      } else {
        node.type = 'changed';
      }
      return node;
    }

    return node;
  }

  const root = buildNode(undefined, left, right, '$');
  const stats = computeDiffStats(root);
  return {
    tree: root,
    stats
  };
}

/**
 * 计算树形差异统计
 */
export function computeDiffStats(node) {
  const stats = { added: 0, removed: 0, changed: 0, unchanged: 0 };

  function walk(n) {
    if (!n) return;
    if (n.type === 'added') stats.added++;
    else if (n.type === 'removed') stats.removed++;
    else if (n.type === 'changed') stats.changed++;
    else if (n.type === 'unchanged') stats.unchanged++;

    if (n.children && n.children.length) {
      for (const c of n.children) walk(c);
    }
  }

  walk(node);
  return stats;
}

/**
 * Best-effort: find line number in pretty-printed JSON for a given path.
 * Returns 1-based line number or null.
 */
export function findLineForPath(source, path) {
  try {
    const pretty = typeof source === 'string' ? source : JSON.stringify(source, null, 2);
    if (!pretty || !path) return null;
    const parts = String(path).split('.').filter(Boolean);
    let idx = -1;
    let from = 0;
    for (const part of parts) {
      // handle array index like name[0] or [0]
      const m = part.match(/^(.+?)\[(\d+)\]$/);
      const needle = m ? `"${m[1]}"` : `"${part}"`;
      idx = pretty.indexOf(needle, from);
      if (idx === -1) return null;
      from = idx + needle.length;
    }
    const prefix = pretty.slice(0, idx);
    return prefix.split(/\r?\n/).length;
  } catch (e) {
    return null;
  }
}

/**
 * 获取对象中指定路径的值（支持 dot 和 [i]）
 */
export function getValueAtPath(obj, path) {
  try {
    if (!path) return obj;
    const parts = String(path).split('.');
    let current = obj;
    for (const part of parts) {
      if (part.includes('[')) {
        const [key, index] = part.split('[').map(p => p.replace(']', ''));
        current = current && current[key] && current[key][parseInt(index)];
      } else {
        current = current && current[part];
      }
      if (current === undefined) return undefined;
    }
    return current;
  } catch (e) {
    return undefined;
  }
}

export default {
  getDifferences,
  categorizeDifferences,
  generateDiffSummary,
  extractOnlyDifferences,
  buildLineDiffs,
  buildTreeDiff,
  computeDiffStats,
  findLineForPath,
  getValueAtPath
};