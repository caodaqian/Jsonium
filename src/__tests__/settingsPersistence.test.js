import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useJsonStore } from '../store/index.js';

describe('settings persistence', () => {
	beforeEach(() => {
		setActivePinia(createPinia());

		const storage = new Map();
		global.localStorage = {
			getItem: vi.fn((key) => storage.get(key) ?? null),
			setItem: vi.fn((key, value) => storage.set(key, String(value))),
			removeItem: vi.fn((key) => storage.delete(key)),
			clear: vi.fn(() => storage.clear())
		};

		global.window = {
			utools: {
				dbStorage: {
					getItem: vi.fn(() => null),
					setItem: vi.fn()
				}
			}
		};
	});

	it('saves unified settings payload (including theme and aiConfig) to utools dbStorage', () => {
		const store = useJsonStore();
		store.setThemePreference('vue', 'dark');
		store.setAIConfig({
			provider: 'openai_compatible',
			baseUrl: 'https://api.example.com/v1',
			apiKey: 'test-key',
			model: 'gpt-4o-mini',
			parseRetryMax: 2
		});
		store.updateEditorSettings({ fontSize: 18, wordWrap: 'on' });
		store.diffSidebar.collapsed = true;

		store.saveSettingsState();

		const calls = window.utools.dbStorage.setItem.mock.calls;
		const writes = calls.filter(([key]) => key === 'json_settings_v2');
		const write = writes[writes.length - 1];

		expect(write).toBeTruthy();
		const payload = JSON.parse(write[1]);
		expect(payload.themePreference).toEqual({ theme: 'vue', mode: 'dark' });
		expect(payload.aiConfig.provider).toBe('openai_compatible');
		expect(payload.aiConfig.baseUrl).toBe('https://api.example.com/v1');
		expect(payload.editorSettings.fontSize).toBe(18);
		expect(payload.diffSidebarCollapsed).toBe(true);
	});

	it('does not write legacy theme key when changing theme preference', () => {
		const store = useJsonStore();

		store.setThemePreference('vue', 'dark');

		const calls = window.utools.dbStorage.setItem.mock.calls;
		const legacyWrite = calls.find(([key]) => key === 'json_theme_pref_v1');
		const unifiedWrite = calls.find(([key]) => key === 'json_settings_v2');

		expect(legacyWrite).toBeFalsy();
		expect(unifiedWrite).toBeTruthy();
	});

	it('loads unified settings payload from json_settings_v2 and restores store state', () => {
		window.utools.dbStorage.getItem = vi.fn((key) => {
			if (key !== 'json_settings_v2') return null;
			return JSON.stringify({
				themePreference: { theme: 'vue', mode: 'light' },
				aiConfig: {
					provider: 'openai_compatible',
					model: 'gpt-4.1-mini',
					baseUrl: 'https://compat.example/v1',
					apiKey: 'k',
					headersJson: '{"X-Test":"1"}',
					parseRetry: false,
					parseRetryMax: 3
				},
				editorSettings: {
					autoFormat: false,
					fontSize: 16,
					wordWrap: 'on'
				},
				diffSidebarCollapsed: true,
				lastWindowSize: { width: 1280, height: 860 }
			});
		});

		const store = useJsonStore();
		const loaded = store.loadSettingsState();

		expect(loaded).toBe(true);
		expect(store.themePreference.theme).toBe('vue');
		expect(store.themePreference.mode).toBe('light');
		expect(store.aiConfig.provider).toBe('openai_compatible');
		expect(store.aiConfig.model).toBe('gpt-4.1-mini');
		expect(store.editorSettings.fontSize).toBe(16);
		expect(store.editorSettings.wordWrap).toBe('on');
		expect(store.diffSidebar.collapsed).toBe(true);
		expect(store.editorSettings.lastWindowSize).toEqual({ width: 1280, height: 860 });
	});

	it('falls back to legacy json_settings_v1 when v2 is missing', () => {
		window.utools.dbStorage.getItem = vi.fn((key) => {
			if (key === 'json_settings_v2') return null;
			if (key !== 'json_settings_v1') return null;
			return JSON.stringify({
				editorSettings: { fontSize: 15 },
				aiConfig: { provider: 'openai_compatible' },
				themePreference: { theme: 'vue', mode: 'dark' },
				diffSidebarCollapsed: false
			});
		});

		const store = useJsonStore();
		const loaded = store.loadSettingsState();

		expect(loaded).toBe(true);
		expect(store.editorSettings.fontSize).toBe(15);
		expect(store.aiConfig.provider).toBe('openai_compatible');
		expect(store.themePreference.theme).toBe('vue');
		expect(store.themePreference.mode).toBe('dark');
	});

	it('falls back to localStorage when utools dbStorage is unavailable', () => {
		delete window.utools;

		const store = useJsonStore();
		store.setAIConfig({ provider: 'openai_compatible', model: 'gpt-4o' });

		store.saveSettingsState();

		expect(localStorage.setItem).toHaveBeenCalled();
		const writes = localStorage.setItem.mock.calls;
		const write = writes.find(([key]) => key === 'json_settings_v2');
		expect(write).toBeTruthy();

		localStorage.getItem = vi.fn((key) => {
			if (key !== 'json_settings_v2') return null;
			return write[1];
		});

		const restored = useJsonStore();
		const loaded = restored.loadSettingsState();
		expect(loaded).toBe(true);
		expect(restored.aiConfig.model).toBe('gpt-4o');
	});

	it('migrates legacy json_theme_pref_v1 into unified json_settings_v2', () => {
		window.utools.dbStorage.getItem = vi.fn((key) => {
			if (key === 'json_settings_v2') return null;
			if (key === 'json_settings_v1') return null;
			if (key === 'json_theme_pref_v1') {
				return JSON.stringify({ theme: 'vue', mode: 'dark' });
			}
			return null;
		});

		const store = useJsonStore();
		const loaded = store.loadSettingsState();

		expect(loaded).toBe(true);
		expect(store.themePreference).toEqual({ theme: 'vue', mode: 'dark' });

		const writes = window.utools.dbStorage.setItem.mock.calls;
		const migrated = writes.find(([key]) => key === 'json_settings_v2');
		expect(migrated).toBeTruthy();
	});
});
