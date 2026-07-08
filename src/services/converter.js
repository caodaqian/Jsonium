/**
 * JSON 转换引擎 - 支持多种编程语言和格式
 */

/**
 * JSON 转 Go struct
 */
import { getStringifyIndent } from '../utils/indent.js';
const UNION_SAMPLE = Symbol('jsoniumUnionSample');

export function jsonToGoStruct(jsonStr, structName = 'Data') {
  try {
    const data = JSON.parse(jsonStr);
    const structs = [];
    buildGoStruct(safeGoTypeName(structName), data, structs);
    return { success: true, data: structs.join('\n\n') };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function buildGoStruct(typeName, value, structs) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    structs.push(`type ${typeName} struct {\n}`);
    return typeName;
  }

  if (structs.some((item) => item.startsWith(`type ${typeName} struct`))) {
    return typeName;
  }

  const fields = [];
  for (const [key, childValue] of Object.entries(value)) {
    const fieldName = toGoFieldName(key);
    const fieldType = getGoType(childValue, `${typeName}${toPascalCase(singularize(key))}`, structs);
    const jsonTag = `json:"${key}"`;
    fields.push(`${fieldName} ${fieldType} \`${jsonTag}\``);
  }

  structs.push(`type ${typeName} struct {\n${fields.map((field) => `  ${field}`).join('\n')}\n}`);
  return typeName;
}

function getGoType(value, typeName, structs) {
  if (isUnionSample(value)) {
    const concrete = value[UNION_SAMPLE].find((item) => item !== null && item !== undefined);
    return concrete === undefined ? 'interface{}' : getGoType(concrete, typeName, structs);
  }
  if (value === null) return 'interface{}';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'int64' : 'float64';
  }
  if (typeof value === 'boolean') return 'bool';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]interface{}';
    const objectItems = value.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
    if (objectItems.length > 0) {
      return `[]${buildGoStruct(typeName, mergeObjectSamples(objectItems), structs)}`;
    }
    return `[]${getGoType(value.find((item) => item !== null) ?? null, typeName, structs)}`;
  }
  if (typeof value === 'object') {
    return buildGoStruct(typeName, value, structs);
  }
  return 'interface{}';
}

/**
 * JSON 转 Java class
 */
export function jsonToJavaClass(jsonStr, className = 'Data') {
  try {
    const data = JSON.parse(jsonStr);
    const classes = [];
    buildJavaClass(safeGoTypeName(className), data, classes, true);
    return { success: true, data: `import java.util.List;\n\n${classes.join('\n\n')}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function buildJavaClass(className, value, classes, isPublic = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    classes.push(`${isPublic ? 'public ' : ''}class ${className} {\n}`);
    return className;
  }

  if (classes.some((item) => item.includes(`class ${className}`))) {
    return className;
  }

  const fields = Object.entries(value).map(([key, childValue]) => ({
    name: toJavaFieldName(key),
    type: getJavaType(childValue, `${className}${toPascalCase(singularize(key))}`, classes)
  }));

  let javaClass = `${isPublic ? 'public ' : ''}class ${className} {\n`;
  javaClass += fields.map((field) => `  private ${field.type} ${field.name};`).join('\n');

  for (const field of fields) {
    const methodName = toPascalCase(field.name);
    javaClass += `\n\n  public ${field.type} get${methodName}() {\n`;
    javaClass += `    return ${field.name};\n`;
    javaClass += `  }\n`;
    javaClass += `\n  public void set${methodName}(${field.type} ${field.name}) {\n`;
    javaClass += `    this.${field.name} = ${field.name};\n`;
    javaClass += `  }`;
  }

  javaClass += `\n}`;
  classes.push(javaClass);
  return className;
}

function getJavaType(value, typeName, classes) {
  if (isUnionSample(value)) {
    const concrete = value[UNION_SAMPLE].find((item) => item !== null && item !== undefined);
    return concrete === undefined ? 'Object' : getJavaType(concrete, typeName, classes);
  }
  if (value === null) return 'Object';
  if (typeof value === 'string') return 'String';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'Long' : 'Double';
  }
  if (typeof value === 'boolean') return 'Boolean';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'List<Object>';
    const objectItems = value.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
    if (objectItems.length > 0) return `List<${buildJavaClass(typeName, mergeObjectSamples(objectItems), classes)}>`;
    return `List<${getJavaType(value.find((item) => item !== null) ?? null, typeName, classes)}>`;
  }
  if (typeof value === 'object') return buildJavaClass(typeName, value, classes);
  return 'Object';
}

/**
 * JSON 转 Python dataclass
 */
export function jsonToPython(jsonStr, className = 'Data') {
  try {
    const data = JSON.parse(jsonStr);
    const classes = [];
    buildPythonDataclass(safeGoTypeName(className), data, classes);
    return { success: true, data: `from dataclasses import dataclass\nfrom typing import Any, List\n\n${classes.join('\n\n')}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function buildPythonDataclass(className, value, classes) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    classes.push(`@dataclass\nclass ${className}:\n  pass`);
    return className;
  }

  if (classes.some((item) => item.includes(`class ${className}:`))) {
    return className;
  }

  const fields = Object.entries(value).map(([key, childValue]) => {
    const fieldName = toSnakeIdentifier(key);
    const fieldType = getPythonType(childValue, `${className}${toPascalCase(singularize(key))}`, classes);
    return `  ${fieldName}: ${fieldType}`;
  });

  classes.push(`@dataclass\nclass ${className}:\n${fields.length ? fields.join('\n') : '  pass'}`);
  return className;
}

function getPythonType(value, typeName, classes) {
  if (isUnionSample(value)) {
    const concrete = value[UNION_SAMPLE].find((item) => item !== null && item !== undefined);
    return concrete === undefined ? 'Any' : getPythonType(concrete, typeName, classes);
  }
  if (value === null) return 'Any';
  if (typeof value === 'string') return 'str';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'int' : 'float';
  }
  if (typeof value === 'boolean') return 'bool';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'List[Any]';
    const objectItems = value.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
    if (objectItems.length > 0) return `List[${buildPythonDataclass(typeName, mergeObjectSamples(objectItems), classes)}]`;
    return `List[${getPythonType(value.find((item) => item !== null) ?? null, typeName, classes)}]`;
  }
  if (typeof value === 'object') return buildPythonDataclass(typeName, value, classes);
  return 'Any';
}

/**
 * JSON 转 TypeScript interface
 */
export function jsonToTypeScript(jsonStr, interfaceName = 'IData') {
  try {
    const data = JSON.parse(jsonStr);
    const definitions = [];
    buildTypeScriptInterface(interfaceName, data, definitions);
    return { success: true, data: definitions.join('\n\n') };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function buildTypeScriptInterface(interfaceName, value, definitions) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    definitions.push(`interface ${interfaceName} {\n}`);
    return interfaceName;
  }

  if (definitions.some((item) => item.startsWith(`interface ${interfaceName} `))) {
    return interfaceName;
  }

  const fields = Object.entries(value).map(([key, childValue]) => {
    const propertyName = formatTypeScriptPropertyName(key);
    const propertyType = getTypeScriptType(childValue, `${interfaceName}${toPascalCase(singularize(key))}`, definitions);
    return `  ${propertyName}: ${propertyType};`;
  });

  definitions.push(`interface ${interfaceName} {\n${fields.join('\n')}\n}`);
  return interfaceName;
}

function getTypeScriptType(value, typeName, definitions) {
  if (isUnionSample(value)) {
    return uniqueTypes(value[UNION_SAMPLE].map((item) => getTypeScriptType(item, typeName, definitions))).join(' | ');
  }
  if (value === null) return 'null';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'any[]';
    const objectItems = value.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
    if (objectItems.length > 0) {
      return `${buildTypeScriptInterface(typeName, mergeObjectSamples(objectItems), definitions)}[]`;
    }
    const unionTypes = uniqueTypes(value.map((item) => getTypeScriptType(item, typeName, definitions)));
    const itemType = unionTypes.length === 1 ? unionTypes[0] : `(${unionTypes.join(' | ')})`;
    return `${itemType}[]`;
  }
  if (typeof value === 'object') {
    return buildTypeScriptInterface(typeName, value, definitions);
  }
  return 'any';
}

function uniqueTypes(types) {
  return Array.from(new Set(types));
}

function mergeObjectSamples(items) {
  const merged = {};
  for (const item of items) {
    for (const [key, value] of Object.entries(item)) {
      if (!(key in merged)) {
        merged[key] = value;
        continue;
      }
      merged[key] = mergeSampleValue(merged[key], value);
    }
  }
  return merged;
}

function mergeSampleValue(left, right) {
  if (isUnionSample(left) || isUnionSample(right)) {
    return createUnionSample([...(isUnionSample(left) ? left[UNION_SAMPLE] : [left]), ...(isUnionSample(right) ? right[UNION_SAMPLE] : [right])]);
  }
  if (left === null) return right === null ? null : createUnionSample([right, null]);
  if (right === null) return createUnionSample([left, null]);
  if (Array.isArray(left) || Array.isArray(right)) {
    return [...(Array.isArray(left) ? left : [left]), ...(Array.isArray(right) ? right : [right])];
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    return mergeObjectSamples([left, right]);
  }
  if (typeof left !== typeof right) return createUnionSample([left, right]);
  return left;
}

function createUnionSample(values) {
  return { [UNION_SAMPLE]: values };
}

function isUnionSample(value) {
  return !!(value && typeof value === 'object' && value[UNION_SAMPLE]);
}

function formatTypeScriptPropertyName(key) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : `'${String(key).replace(/'/g, "\\'")}'`;
}

function safeGoTypeName(name) {
  const value = toPascalCase(name);
  return value || 'Data';
}

function toGoFieldName(key) {
  const value = toPascalCase(key).replace(/[^A-Za-z0-9]/g, '');
  if (!value) return 'Field';
  return /^[A-Za-z]/.test(value) ? value : `Field${value}`;
}

function toJavaFieldName(key) {
  const value = toCamelIdentifier(key);
  return value || 'field';
}

function toCppFieldName(key) {
  return toSnakeIdentifier(key);
}

function toCamelIdentifier(key) {
  const pascal = toPascalCase(key).replace(/[^A-Za-z0-9]/g, '');
  if (!pascal) return 'field';
  const value = pascal.charAt(0).toLowerCase() + pascal.slice(1);
  return /^[A-Za-z_]/.test(value) ? value : `field${value}`;
}

function toSnakeIdentifier(key) {
  const value = String(key)
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  if (!value) return 'field';
  return /^[A-Za-z_]/.test(value) ? value : `field_${value}`;
}

function singularize(key) {
  return String(key).endsWith('s') && String(key).length > 1 ? String(key).slice(0, -1) : String(key);
}

/**
 * JSON 转 JavaScript object
 */
export function jsonToJavaScript(jsonStr, varName = 'data') {
  try {
    const data = JSON.parse(jsonStr);
    const js = `const ${varName} = ${JSON.stringify(data, null, getStringifyIndent())};`;
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
    const structs = [];
    buildRustStruct(safeGoTypeName(structName), data, structs);
    return { success: true, data: structs.join('\n\n') };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function buildRustStruct(structName, value, structs) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    structs.push(`#[derive(Debug, Serialize, Deserialize)]\npub struct ${structName} {\n}`);
    return structName;
  }

  if (structs.some((item) => item.includes(`pub struct ${structName}`))) {
    return structName;
  }

  const fields = Object.entries(value).map(([key, childValue]) => {
    const fieldName = toSnakeIdentifier(key);
    const fieldType = getRustType(childValue, `${structName}${toPascalCase(singularize(key))}`, structs);
    return `  pub ${fieldName}: ${fieldType},`;
  });

  structs.push(`#[derive(Debug, Serialize, Deserialize)]\npub struct ${structName} {\n${fields.join('\n')}\n}`);
  return structName;
}

function getRustType(value, typeName, structs) {
  if (isUnionSample(value)) {
    const concrete = value[UNION_SAMPLE].find((item) => item !== null && item !== undefined);
    return concrete === undefined ? 'Option<serde_json::Value>' : `Option<${getRustType(concrete, typeName, structs)}>`;
  }
  if (value === null) return 'Option<serde_json::Value>';
  if (typeof value === 'string') return 'String';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'i64' : 'f64';
  }
  if (typeof value === 'boolean') return 'bool';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'Vec<serde_json::Value>';
    const objectItems = value.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
    if (objectItems.length > 0) return `Vec<${buildRustStruct(typeName, mergeObjectSamples(objectItems), structs)}>`;
    return `Vec<${getRustType(value.find((item) => item !== null) ?? null, typeName, structs)}>`;
  }
  if (typeof value === 'object') return buildRustStruct(typeName, value, structs);
  return 'serde_json::Value';
}

/**
 * JSON 转 C++ struct
 */
export function jsonToCpp(jsonStr, structName = 'Data') {
  try {
    const data = JSON.parse(jsonStr);
    const structs = [];
    buildCppStruct(safeGoTypeName(structName), data, structs);
    return { success: true, data: structs.join('\n\n') };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function buildCppStruct(structName, value, structs) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    structs.push(`struct ${structName} {\n};`);
    return structName;
  }

  if (structs.some((item) => item.startsWith(`struct ${structName} `))) {
    return structName;
  }

  const fields = Object.entries(value).map(([key, childValue]) => {
    const fieldName = toCppFieldName(key);
    const fieldType = getCppType(childValue, `${structName}${toPascalCase(singularize(key))}`, structs);
    return `  ${fieldType} ${fieldName};`;
  });

  structs.push(`struct ${structName} {\n${fields.join('\n')}\n};`);
  return structName;
}

function getCppType(value, typeName, structs) {
  if (isUnionSample(value)) {
    const concrete = value[UNION_SAMPLE].find((item) => item !== null && item !== undefined);
    return concrete === undefined ? 'std::any' : getCppType(concrete, typeName, structs);
  }
  if (value === null) return 'void*';
  if (typeof value === 'string') return 'std::string';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'long' : 'double';
  }
  if (typeof value === 'boolean') return 'bool';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'std::vector<std::any>';
    const objectItems = value.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
    if (objectItems.length > 0) return `std::vector<${buildCppStruct(typeName, mergeObjectSamples(objectItems), structs)}>`;
    return `std::vector<${getCppType(value.find((item) => item !== null) ?? null, typeName, structs)}>`;
  }
  if (typeof value === 'object') return buildCppStruct(typeName, value, structs);
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