import { convert } from './converter.js';
import { detectAndConvert, toFormat } from './formatDetector.js';
import { detectQueryType, queryJq, queryJsonPath } from './queryEngine.js';

const TOOL_NAMES = {
	convertFormat: 'json_convert_format',
	query: 'json_query',
	toCode: 'json_to_code'
};

const SUPPORTED_TARGET_FORMATS = new Set(['json', 'yaml', 'xml', 'json5', 'base64', 'escaped']);
const SUPPORTED_QUERY_TYPES = new Set(['jsonpath', 'jq']);

function ensureNonEmptyString(value, fieldName) {
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error(`${fieldName} 必须是非空字符串`);
	}

	return value.trim();
}

function parseJsonInput(json) {
	const normalized = ensureNonEmptyString(json, 'json');

	try {
		return JSON.parse(normalized);
	} catch (error) {
		throw new Error(`JSON 解析失败: ${error.message}`);
	}
}

export async function jsonConvertFormatTool({ input, targetFormat = 'json' } = {}) {
	const normalizedInput = ensureNonEmptyString(input, 'input');
	const normalizedTargetFormat = typeof targetFormat === 'string' && targetFormat.trim()
		? targetFormat.trim().toLowerCase()
		: 'json';

	if (!SUPPORTED_TARGET_FORMATS.has(normalizedTargetFormat)) {
		throw new Error(`不支持的目标格式: ${targetFormat}`);
	}

	const converted = await detectAndConvert(normalizedInput);
	if (!converted?.success) {
		throw new Error(converted?.error || '格式转换失败');
	}

	if (normalizedTargetFormat === 'json') {
		return {
			format: 'json',
			data: converted.data
		};
	}

	const formatted = await toFormat(converted.data, normalizedTargetFormat);
	if (!formatted?.success) {
		throw new Error(formatted?.error || '格式转换失败');
	}

	return {
		format: normalizedTargetFormat,
		data: formatted.data
	};
}

export async function jsonQueryTool({ json, expression, queryType = 'auto' } = {}) {
	const parsedJson = parseJsonInput(json);
	const normalizedExpression = ensureNonEmptyString(expression, 'expression');
	const normalizedQueryType = typeof queryType === 'string' && queryType.trim()
		? queryType.trim().toLowerCase()
		: 'auto';

	const actualQueryType = normalizedQueryType === 'auto'
		? detectQueryType(normalizedExpression)
		: normalizedQueryType;

	if (!SUPPORTED_QUERY_TYPES.has(actualQueryType)) {
		throw new Error(`不支持的查询类型: ${queryType}`);
	}

	const queryResult = actualQueryType === 'jq'
		? await queryJq(parsedJson, normalizedExpression)
		: queryJsonPath(parsedJson, normalizedExpression);

	if (!queryResult?.success) {
		throw new Error(queryResult?.error || '查询失败');
	}

	return {
		queryType: actualQueryType,
		count: queryResult.count,
		results: queryResult.results
	};
}

export async function jsonToCodeTool({ json, language, typeName } = {}) {
	const normalizedJson = ensureNonEmptyString(json, 'json');
	const normalizedLanguage = ensureNonEmptyString(language, 'language').toLowerCase();
	const normalizedTypeName = typeof typeName === 'string' && typeName.trim() ? typeName.trim() : 'Data';

	const options = normalizedLanguage === 'typescript'
		? { interfaceName: normalizedTypeName }
		: { className: normalizedTypeName };

	const result = convert(normalizedJson, normalizedLanguage, options);
	if (!result?.success) {
		throw new Error(result?.error || '代码生成失败');
	}

	return {
		language: normalizedLanguage,
		code: result.data
	};
}

export function registerJsoniumTools() {
	if (typeof window === 'undefined' || typeof window.utools?.registerTool !== 'function') {
		return;
	}

	window.utools.registerTool(TOOL_NAMES.convertFormat, jsonConvertFormatTool);
	window.utools.registerTool(TOOL_NAMES.query, jsonQueryTool);
	window.utools.registerTool(TOOL_NAMES.toCode, jsonToCodeTool);
}
