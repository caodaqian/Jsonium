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

	it('saves unified settings payload to utools dbStorage', () => {
		const store = useJsonStore();
		store.setThemePreference('vue', 'dark');
		store.setUtoolsWindowSettings({ sizePreset: 'extraLarge', heightPercent: 92 });
		store.updateEditorSettings({ fontSize: 18, wordWrap: 'on' });
		store.diffSidebar.collapsed = true;

		store.saveSettingsState();

		const calls = window.utools.dbStorage.setItem.mock.calls;
		const writes = calls.filter(([key]) => key === 'json_settings_v2');
		const write = writes[writes.length - 1];

		expect(write).toBeTruthy();
		const payload = JSON.parse(write[1]);
		expect(payload.themePreference).toEqual({ theme: 'vue', mode: 'dark' });
		expect(payload).not.toHaveProperty('aiConfig');
		expect(payload.utoolsWindowSettings).toEqual({ sizePreset: 'extraLarge', heightPercent: 92 });
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
				editorSettings: {
					autoFormat: false,
					fontSize: 16,
					wordWrap: 'on'
				},
				utoolsWindowSettings: { sizePreset: 'medium', heightPercent: 64 },
				diffSidebarCollapsed: true,
				lastWindowSize: { width: 1280, height: 860 }
			});
		});

		const store = useJsonStore();
		const loaded = store.loadSettingsState();

		expect(loaded).toBe(true);
		expect(store.themePreference.theme).toBe('vue');
		expect(store.themePreference.mode).toBe('light');
		expect(store.editorSettings.fontSize).toBe(16);
		expect(store.editorSettings.wordWrap).toBe('on');
		expect(store.utoolsWindowSettings).toEqual({ sizePreset: 'medium', heightPercent: 64 });
		expect(store.diffSidebar.collapsed).toBe(true);
		expect(store.editorSettings.lastWindowSize).toEqual({ width: 1280, height: 860 });
	});

	it('falls back to legacy json_settings_v1 when v2 is missing', () => {
		window.utools.dbStorage.getItem = vi.fn((key) => {
			if (key === 'json_settings_v2') return null;
			if (key !== 'json_settings_v1') return null;
			return JSON.stringify({
				editorSettings: { fontSize: 15 },
				themePreference: { theme: 'vue', mode: 'dark' },
				diffSidebarCollapsed: false
			});
		});

		const store = useJsonStore();
		const loaded = store.loadSettingsState();

		expect(loaded).toBe(true);
		expect(store.editorSettings.fontSize).toBe(15);
		expect(store.themePreference.theme).toBe('vue');
		expect(store.themePreference.mode).toBe('dark');
	});

	it('falls back to localStorage when utools dbStorage is unavailable', () => {
		delete window.utools;

		const store = useJsonStore();
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
		expect(restored.themePreference).toEqual({ theme: 'catppuccin', mode: 'auto' });
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
