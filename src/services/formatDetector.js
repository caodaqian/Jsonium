import YAML from 'js-yaml';
import JSON5 from 'json5';
import { parseStringPromise } from 'xml2js';
import { getStringifyIndent, getTabSize } from '../utils/indent.js';

/**
 * 格式识别引擎 - 按优先级识别输入格式
 * 优先级: Base64 > 转义JSON > JSON5 > YAML > XML > 标准JSON
 */

export const FORMAT_TYPES = {
  BASE64: 'base64',
  ESCAPED_JSON: 'escaped_json',
  JSON5: 'json5',
  YAML: 'yaml',
  XML: 'xml',
  JSON: 'json'
};

/**
 * 检测是否为 Base64
 */
export function isBase64(str) {
  if (typeof str !== 'string') return false;
  if (str.length < 10) return false;

  try {
    const decoded = atob(str);
    // 尝试解析为 JSON
    const trimmed = decoded.trim();
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && (trimmed.endsWith('}') || trimmed.endsWith(']'))) {
      JSON.parse(trimmed);
      return true;
    }
  } catch (e) {
    return false;
  }
  return false;
}

/**
 * 检测是否为转义 JSON（支持 " ' ` 三种包裹）
 */
export function isEscapedJson(str) {
  if (typeof str !== 'string') return false;
  if (str.length < 2) return false;

  const first = str[0];
  const last = str[str.length - 1];
  if (first !== last) return false;
  if (!['"', "'", '`'].includes(first)) return false;

  try {
    // 先尝试标准 JSON.parse（适用于双引号包裹）
    let unescaped;
    try {
      unescaped = JSON.parse(str);
    } catch (_e) {
      // 回退到 JSON5（支持单引号和部分非标准字符串字面量）
      unescaped = JSON5.parse(str);
    }

    if (typeof unescaped === 'string') {
      const trimmed = unescaped.trim();
      if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && (trimmed.endsWith('}') || trimmed.endsWith(']'))) {
        // 验证内部内容能解析为 JSON（先用 JSON，再用 JSON5）
        try {
          JSON.parse(trimmed);
          return true;
        } catch (e2) {
          try {
            JSON5.parse(trimmed);
            return true;
          } catch (e3) {
            return false;
          }
        }
      }
    }
  } catch (e) {
    return false;
  }
  return false;
}

/**
 * 检测是否为 JSON5
 */
export function isJson5(str) {
  if (typeof str !== 'string') return false;
  try {
    const trimmed = str.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;

    JSON5.parse(trimmed);
    // 检查是否包含 JSON5 特性
    return trimmed.includes("'") || trimmed.includes('//') || trimmed.includes('/*') || !trimmed.includes('"');
  } catch (e) {
    return false;
  }
}

/**
 * 检测是否为 YAML
 */
export function isYaml(str) {
  if (typeof str !== 'string') return false;
  try {
    const trimmed = str.trim();
    // YAML 通常以冒号分隔或换行开始
    if (trimmed.includes(':') || trimmed.includes('-\n') || trimmed.startsWith('-')) {
      YAML.load(trimmed);
      return true;
    }
  } catch (e) {
    return false;
  }
  return false;
}

/**
 * 检测是否为 XML
 */
export function isXml(str) {
  if (typeof str !== 'string') return false;
  const trimmed = str.trim();
  return trimmed.startsWith('<') && trimmed.endsWith('>');
}

/**
 * 检测是否为标准 JSON
 */
export function isJson(str) {
  if (typeof str !== 'string') return false;
  try {
    const trimmed = str.trim();
    JSON.parse(trimmed);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 解码 Base64 JSON
 */
export function decodeBase64(str) {
  try {
    const decoded = atob(str);
    return {
      success: true,
      data: decoded,
      format: FORMAT_TYPES.BASE64
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 解码转义 JSON（兼容 " ' ` ，优先 JSON.parse，回退到 JSON5）
 */
export function decodeEscapedJson(str) {
  try {
    let unescaped;
    try {
      unescaped = JSON.parse(str);
    } catch (_e) {
      // 如果不是标准 JSON 外层字符串（如单引号或反引号），用 JSON5 解析外层字符串
      unescaped = JSON5.parse(str);
    }
    return {
      success: true,
      data: unescaped,
      format: FORMAT_TYPES.ESCAPED_JSON
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 解析 JSON5
 */
export function parseJson5(str) {
  try {
    const data = JSON5.parse(str);
    return {
      success: true,
      data: JSON.stringify(data, null, getStringifyIndent()),
      format: FORMAT_TYPES.JSON5
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 解析 YAML
 */
export function parseYaml(str) {
  try {
    const data = YAML.load(str);
    return {
      success: true,
      data: JSON.stringify(data, null, getStringifyIndent()),
      format: FORMAT_TYPES.YAML
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 解析 XML
 */
export async function parseXml(str) {
  try {
    const data = await parseStringPromise(str);
    return {
      success: true,
      data: JSON.stringify(data, null, getStringifyIndent()),
      format: FORMAT_TYPES.XML
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 格式化 JSON
 */
export function formatJson(str) {
  try {
    const data = JSON.parse(str);
    return {
      success: true,
      data: JSON.stringify(data, null, getStringifyIndent()),
      format: FORMAT_TYPES.JSON
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 自动检测和转换格式为 JSON
 * 返回格式化的 JSON 和检测到的原始格式
 *
 * options:
 *  - mode: 'strict' | 'lenient' (default 'lenient')
 *
 * Strict mode uses a more conservative detection order to avoid YAML/JSON5 misclassification.
 */
export async function detectAndConvert(input, options = { mode: 'lenient' }) {
  const mode = (options && options.mode) || 'lenient';
  const str = String(input).trim();

  // Helper to wrap success results with originalFormat
  const wrap = (result, originalFormat) => ({
    ...result,
    originalFormat
  });

  // Two detection orders:
  // strict:
  //   JSON -> ESCAPED_JSON -> BASE64 -> JSON5 -> XML -> YAML
  // lenient (legacy behavior similar to prior):
  //   BASE64 -> ESCAPED_JSON -> JSON -> JSON5 -> XML -> YAML

  if (mode === 'strict') {
    // 1. Try standard JSON first
    if (isJson(str)) {
      const result = formatJson(str);
      if (result.success) return wrap(result, FORMAT_TYPES.JSON);
    }

    // 2. Escaped JSON
    if (isEscapedJson(str)) {
      const result = decodeEscapedJson(str);
      if (result.success) {
        const trimmed = String(result.data).trim();
        return wrap({ ...result, data: trimmed }, FORMAT_TYPES.ESCAPED_JSON);
      }
    }

    // 3. Base64
    if (isBase64(str)) {
      const result = decodeBase64(str);
      if (result.success) {
        const trimmed = String(result.data).trim();
        return wrap({ ...result, data: trimmed }, FORMAT_TYPES.BASE64);
      }
    }

    // 4. JSON5
    if (isJson5(str)) {
      const result = parseJson5(str);
      if (result.success) return wrap(result, FORMAT_TYPES.JSON5);
    }

    // 5. XML
    if (isXml(str)) {
      const result = await parseXml(str);
      if (result.success) return wrap(result, FORMAT_TYPES.XML);
    }

    // 6. YAML last
    if (isYaml(str)) {
      const result = parseYaml(str);
      if (result.success) return wrap(result, FORMAT_TYPES.YAML);
    }

    return { success: false, error: '无法识别输入格式（strict 模式）' };
  }

  // lenient / legacy path
  // 1. Base64
  if (isBase64(str)) {
    const result = decodeBase64(str);
    if (result.success) {
      const trimmed = String(result.data).trim();
      return wrap({ ...result, data: trimmed }, FORMAT_TYPES.BASE64);
    }
  }

  // 2. Escaped JSON
  if (isEscapedJson(str)) {
    const result = decodeEscapedJson(str);
    if (result.success) {
      const trimmed = String(result.data).trim();
      return wrap({ ...result, data: trimmed }, FORMAT_TYPES.ESCAPED_JSON);
    }
  }

  // 3. Try standard JSON (prefer over YAML)
  if (isJson(str)) {
    const result = formatJson(str);
    if (result.success) return wrap(result, FORMAT_TYPES.JSON);
  }

  // 4. JSON5
  if (isJson5(str)) {
    const result = parseJson5(str);
    if (result.success) return wrap(result, FORMAT_TYPES.JSON5);
  }

  // 5. XML
  if (isXml(str)) {
    const result = await parseXml(str);
    if (result.success) return wrap(result, FORMAT_TYPES.XML);
  }

  // 6. YAML (after JSON)
  if (isYaml(str)) {
    const result = parseYaml(str);
    if (result.success) return wrap(result, FORMAT_TYPES.YAML);
  }

  return {
    success: false,
    error: '无法识别输入格式，请检查输入内容'
  };
}

/**
 * 将 JSON 对象转换为指定格式的字符串
 */
export async function toFormat(data, format) {
  try {
    let content;

    if (typeof data === 'string') {
      content = JSON.parse(data);
    } else {
      content = data;
    }

    switch (format) {
      case FORMAT_TYPES.JSON:
        return {
          success: true,
          data: JSON.stringify(content, null, getStringifyIndent())
        };

      case FORMAT_TYPES.JSON5:
        return {
          success: true,
          data: JSON5.stringify(content, null, getStringifyIndent())
        };

      case FORMAT_TYPES.YAML:
        return {
          success: true,
          data: YAML.dump(content, { indent: getTabSize() })
        };

      case 'xml':
        // 简单的 JSON 转 XML（需要自定义实现）
        const xml = jsonToXml(content);
        return {
          success: true,
          data: xml
        };

      case 'escaped':
        return {
          success: true,
          data: JSON.stringify(JSON.stringify(content))
        };

      case 'base64':
        const jsonStr = JSON.stringify(content);
        return {
          success: true,
          data: btoa(jsonStr)
        };

      default:
        return { success: false, error: `不支持的格式: ${format}` };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 简单的 JSON 转 XML
 */
function jsonToXml(obj, rootName = 'root') {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<${rootName}>`;

  function buildXml(obj) {
    if (obj === null || obj === undefined) {
      return '';
    }

    if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
      return String(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => {
        if (typeof item === 'object') {
          return `<item>${buildXml(item)}</item>`;
        }
        return `<item>${escapeXml(String(item))}</item>`;
      }).join('');
    }

    if (typeof obj === 'object') {
      return Object.entries(obj).map(([key, value]) => {
        const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
        if (value === null || value === undefined) {
          return `<${safeKey}/>`;
        }
        if (typeof value === 'object') {
          return `<${safeKey}>${buildXml(value)}</${safeKey}>`;
        }
        return `<${safeKey}>${escapeXml(String(value))}</${safeKey}>`;
      }).join('');
    }

    return '';
  }

  xml += buildXml(obj);
  xml += `</${rootName}>`;

  return xml;
}

/**
 * 转义 XML 特殊字符
 */
function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export default {
  detectAndConvert,
  toFormat,
  FORMAT_TYPES,
  isBase64,
  isEscapedJson,
  isJson5,
  isYaml,
  isXml,
  isJson
};