import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	jsonConvertFormatTool,
	jsonQueryTool,
	jsonToCodeTool,
	registerJsoniumTools
} from '../services/mcpTools.js';

describe('MCP 工具', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('将 YAML 转换为格式化 JSON', async () => {
		const result = await jsonConvertFormatTool({
			input: 'name: Jsonium\ncount: 2',
			targetFormat: 'json'
		});

		expect(result).toEqual({
			format: 'json',
			data: '{\n  "name": "Jsonium",\n  "count": 2\n}'
		});
	});

	it('将 JSON 转换为 YAML', async () => {
		const result = await jsonConvertFormatTool({
			input: '{"name":"Jsonium","enabled":true}',
			targetFormat: 'yaml'
		});

		expect(result.format).toBe('yaml');
		expect(result.data).toContain('name: Jsonium');
		expect(result.data).toContain('enabled: true');
	});

	it('自动识别 JSONPath 并返回查询结果', async () => {
		const result = await jsonQueryTool({
			json: '{"users":[{"id":1},{"id":2}]}',
			expression: '$.users[*].id',
			queryType: 'auto'
		});

		expect(result).toEqual({
			queryType: 'jsonpath',
			count: 2,
			results: [1, 2]
		});
	});

	it('执行 jq 查询', async () => {
		const result = await jsonQueryTool({
			json: '{"users":[{"id":1},{"id":2}]}',
			expression: '.users[].id',
			queryType: 'jq'
		});

		expect(result).toEqual({
			queryType: 'jq',
			count: 2,
			results: [1, 2]
		});
	});

	it('生成 TypeScript 类型定义', async () => {
		const result = await jsonToCodeTool({
			json: '{"id":1,"name":"Jsonium"}',
			language: 'typescript',
			typeName: 'PluginInfo'
		});

		expect(result.language).toBe('typescript');
		expect(result.code).toContain('interface PluginInfo');
		expect(result.code).toContain('id: number');
		expect(result.code).toContain('name: string');
	});

	it('拒绝不支持的目标格式', async () => {
		await expect(jsonConvertFormatTool({
			input: '{"id":1}',
			targetFormat: 'toml'
		})).rejects.toThrow('不支持的目标格式');
	});

	it('在 uTools 可用时注册三个工具', () => {
		const registerTool = vi.fn();
		vi.stubGlobal('window', { utools: { registerTool } });

		registerJsoniumTools();

		expect(registerTool).toHaveBeenCalledTimes(3);
		expect(registerTool.mock.calls.map(([name]) => name)).toEqual([
			'json_convert_format',
			'json_query',
			'json_to_code'
		]);
	});

	it('在非 uTools 环境中跳过注册', () => {
		vi.stubGlobal('window', {});

		expect(() => registerJsoniumTools()).not.toThrow();
	});
});
