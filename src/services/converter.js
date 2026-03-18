/**
 * JSON 转换引擎 - 支持多种编程语言和格式
 */

/**
 * JSON 转 Go struct
 */
export function jsonToGoStruct(jsonStr, structName = 'Data') {
  try {
    const data = JSON.parse(jsonStr);
    let struct = `type ${structName} struct {\n`;
    
    const fields = generateGoFields(data);
    for (const field of fields) {
      struct += `  ${field}\n`;
    }
    
    struct += `}`;
    return { success: true, data: struct };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function generateGoFields(obj, depth = 0) {
  const fields = [];
  
  if (typeof obj !== 'object' || obj === null) {
    return fields;
  }
  
  for (const [key, value] of Object.entries(obj)) {
    const fieldName = toPascalCase(key);
    const fieldType = getGoType(value);
    const jsonTag = `json:"${key}"`;
    fields.push(`${fieldName} ${fieldType} \`${jsonTag}\``);
  }
  
  return fields;
}

function getGoType(value) {
  if (value === null) return 'interface{}'
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'int64' : 'float64';
  }
  if (typeof value === 'boolean') return 'bool';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]interface{}';
    return `[]${getGoType(value[0])}`;
  }
  if (typeof value === 'object') return 'map[string]interface{}';
  return 'interface{}';
}

/**
 * JSON 转 Java class
 */
export function jsonToJavaClass(jsonStr, className = 'Data') {
  try {
    const data = JSON.parse(jsonStr);
    let javaClass = `public class ${className} {\n`;
    
    for (const [key, value] of Object.entries(data)) {
      const fieldType = getJavaType(value);
      const fieldName = key;
      javaClass += `  private ${fieldType} ${fieldName};\n`;
    }
    
    // 添加 getter 和 setter
    for (const [key, value] of Object.entries(data)) {
      const fieldType = getJavaType(value);
      const fieldName = key;
      const methodName = toPascalCase(fieldName);
      
      javaClass += `\n  public ${fieldType} get${methodName}() {\n`;
      javaClass += `    return ${fieldName};\n`;
      javaClass += `  }\n`;
      
      javaClass += `\n  public void set${methodName}(${fieldType} ${fieldName}) {\n`;
      javaClass += `    this.${fieldName} = ${fieldName};\n`;
      javaClass += `  }\n`;
    }
    
    javaClass += `}`;
    return { success: true, data: javaClass };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getJavaType(value) {
  if (value === null) return 'Object';
  if (typeof value === 'string') return 'String';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'Long' : 'Double';
  }
  if (typeof value === 'boolean') return 'Boolean';
  if (Array.isArray(value)) return 'List<Object>';
  if (typeof value === 'object') return 'Map<String, Object>';
  return 'Object';
}

/**
 * JSON 转 Python dataclass
 */
export function jsonToPython(jsonStr, className = 'Data') {
  try {
    const data = JSON.parse(jsonStr);
    let python = `@dataclass\nclass ${className}:\n`;
    
    for (const [key, value] of Object.entries(data)) {
      const fieldType = getPythonType(value);
      python += `  ${key}: ${fieldType}\n`;
    }
    
    return { success: true, data: python };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getPythonType(value) {
  if (value === null) return 'Any';
  if (typeof value === 'string') return 'str';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'int' : 'float';
  }
  if (typeof value === 'boolean') return 'bool';
  if (Array.isArray(value)) return 'List[Any]';
  if (typeof value === 'object') return 'Dict[str, Any]';
  return 'Any';
}

/**
 * JSON 转 TypeScript interface
 */
export function jsonToTypeScript(jsonStr, interfaceName = 'IData') {
  try {
    const data = JSON.parse(jsonStr);
    let ts = `interface ${interfaceName} {\n`;
    
    for (const [key, value] of Object.entries(data)) {
      const fieldType = getTypeScriptType(value);
      ts += `  ${key}: ${fieldType};\n`;
    }
    
    ts += `}`;
    return { success: true, data: ts };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getTypeScriptType(value) {
  if (value === null) return 'any';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'any[]';
    return `${getTypeScriptType(value[0])}[]`;
  }
  if (typeof value === 'object') return 'Record<string, any>';
  return 'any';
}

/**
 * JSON 转 JavaScript object
 */
export function jsonToJavaScript(jsonStr, varName = 'data') {
  try {
    const data = JSON.parse(jsonStr);
    const js = `const ${varName} = ${JSON.stringify(data, null, 2)};`;
    return { success: true, data: js };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * JSON 转 Rust struct
 */
export function jsonToRust(jsonStr, structName = 'Data') {
  try {
    const data = JSON.parse(jsonStr);
    let rust = `#[derive(Debug, Serialize, Deserialize)]\npub struct ${structName} {\n`;
    
    for (const [key, value] of Object.entries(data)) {
      const fieldType = getRustType(value);
      rust += `  pub ${key}: ${fieldType},\n`;
    }
    
    rust += `}`;
    return { success: true, data: rust };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getRustType(value) {
  if (value === null) return 'Option<serde_json::Value>';
  if (typeof value === 'string') return 'String';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'i64' : 'f64';
  }
  if (typeof value === 'boolean') return 'bool';
  if (Array.isArray(value)) return 'Vec<serde_json::Value>';
  if (typeof value === 'object') return 'serde_json::Value';
  return 'serde_json::Value';
}

/**
 * JSON 转 C++ struct
 */
export function jsonToCpp(jsonStr, structName = 'Data') {
  try {
    const data = JSON.parse(jsonStr);
    let cpp = `struct ${structName} {\n`;
    
    for (const [key, value] of Object.entries(data)) {
      const fieldType = getCppType(value);
      cpp += `  ${fieldType} ${key};\n`;
    }
    
    cpp += `};\n`;
    return { success: true, data: cpp };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getCppType(value) {
  if (value === null) return 'void*';
  if (typeof value === 'string') return 'std::string';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'long' : 'double';
  }
  if (typeof value === 'boolean') return 'bool';
  if (Array.isArray(value)) return 'std::vector<std::any>';
  if (typeof value === 'object') return 'std::map<std::string, std::any>';
  return 'std::any';
}

/**
 * JSON 转 Excel（简单实现）
 */
export function jsonToExcel(jsonStr, options = {}) {
  try {
    const data = JSON.parse(jsonStr);
    const { mode = 'flat' } = options; // flat 或 nested
    
    if (!Array.isArray(data)) {
      return { success: false, error: 'Excel 导出要求输入为数组' };
    }
    
    if (mode === 'nested') {
      return generateNestedExcel(data);
    }
    
    return generateFlatExcel(data);
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function generateFlatExcel(data) {
  if (data.length === 0) {
    return { success: true, rows: [] };
  }
  
  const headers = new Set();
  data.forEach(item => {
    if (typeof item === 'object' && item !== null) {
      Object.keys(item).forEach(key => headers.add(key));
    }
  });
  
  const headerArray = Array.from(headers);
  const rows = [headerArray];
  
  data.forEach(item => {
    const row = headerArray.map(header => {
      const value = item[header];
      return value === null || value === undefined ? '' : String(value);
    });
    rows.push(row);
  });
  
  return { success: true, rows };
}

function generateNestedExcel(data) {
  // nested 模式下展开嵌套对象
  const flattened = [];
  
  function flatten(obj, prefix = '') {
    const row = {};
    for (const [key, value] of Object.entries(obj)) {
      const newKey = prefix ? `${prefix}.${key}` : key;
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        flatten(value, newKey);
      } else {
        row[newKey] = value;
      }
    }
    return row;
  }
  
  data.forEach(item => {
    if (typeof item === 'object' && item !== null) {
      flattened.push(flatten(item));
    }
  });
  
  const headers = new Set();
  flattened.forEach(item => {
    Object.keys(item).forEach(key => headers.add(key));
  });
  
  const headerArray = Array.from(headers);
  const rows = [headerArray];
  
  flattened.forEach(item => {
    const row = headerArray.map(header => {
      const value = item[header];
      return value === null || value === undefined ? '' : String(value);
    });
    rows.push(row);
  });
  
  return { success: true, rows };
}

/**
 * 辅助函数：转换为 PascalCase
 */
function toPascalCase(str) {
  return str
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

/**
 * JSON 转换枢纽
 */
export function convert(jsonStr, targetLanguage, options = {}) {
  const { className = 'Data', interfaceName = 'IData' } = options;
  
  switch (targetLanguage.toLowerCase()) {
    case 'go':
      return jsonToGoStruct(jsonStr, className);
    case 'java':
      return jsonToJavaClass(jsonStr, className);
    case 'python':
      return jsonToPython(jsonStr, className);
    case 'typescript':
    case 'ts':
      return jsonToTypeScript(jsonStr, interfaceName);
    case 'javascript':
    case 'js':
      return jsonToJavaScript(jsonStr, className);
    case 'rust':
      return jsonToRust(jsonStr, className);
    case 'cpp':
    case 'c++':
      return jsonToCpp(jsonStr, className);
    case 'excel':
      return jsonToExcel(jsonStr, options);
    default:
      return { success: false, error: `不支持的语言: ${targetLanguage}` };
  }
}

export default {
  convert,
  jsonToGoStruct,
  jsonToJavaClass,
  jsonToPython,
  jsonToTypeScript,
  jsonToJavaScript,
  jsonToRust,
  jsonToCpp,
  jsonToExcel
};