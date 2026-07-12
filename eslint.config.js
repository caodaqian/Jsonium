import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import vue from 'eslint-plugin-vue';
import globals from 'globals';

export default [
	{
		ignores: ['coverage/**', 'dist/**', 'node_modules/**', 'perf-output/**', 'public/preload/**'],
	},
	js.configs.recommended,
	...vue.configs['flat/essential'],
	{
		files: ['**/*.{js,vue}'],
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
		},
		plugins: {
			'@stylistic': stylistic,
		},
		rules: {
			'@stylistic/indent': ['error', 'tab', { SwitchCase: 1 }],
			'@stylistic/quotes': ['error', 'single', { allowTemplateLiterals: 'always', avoidEscape: true }],
			'@stylistic/semi': ['error', 'always'],
			'@stylistic/max-len': ['warn', {
				code: 120,
				ignoreComments: true,
				ignoreStrings: true,
				ignoreTemplateLiterals: true,
				ignoreUrls: true,
			}],
			'vue/html-indent': ['error', 'tab'],
			'vue/max-attributes-per-line': ['error', { singleline: 3, multiline: 1 }],
			'vue/multi-word-component-names': 'off',
			'no-unused-vars': 'warn',
			'no-empty': 'warn',
			'no-undef': 'warn',
			'no-dupe-keys': 'warn',
			'no-useless-assignment': 'warn',
			'no-useless-catch': 'warn',
			'no-useless-escape': 'warn',
			'no-case-declarations': 'warn',
			'preserve-caught-error': 'warn',
		},
	},
	{
		files: ['src/__tests__/**/*.{test,spec}.js'],
		languageOptions: {
			globals: globals.vitest,
		},
	},
];
