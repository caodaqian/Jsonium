import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ControlPanel from '../components/ControlPanel.vue';
import { useJsonStore } from '../store/index.js';

describe('ControlPanel window settings', () => {
	beforeEach(() => {
		global.window = global.window || {};
		window.utools = {
			setExpendHeight: vi.fn(() => true),
			dbStorage: {
				getItem: vi.fn(() => null),
				setItem: vi.fn()
			}
		};
		Object.defineProperty(window, 'screen', {
			value: { availHeight: 1000 },
			configurable: true
		});
	});

	it('saves and applies the extra large preset without requiring px input', async () => {
		const pinia = createPinia();
		setActivePinia(pinia);
		const store = useJsonStore();
		const wrapper = mount(ControlPanel, {
			props: { activePanel: 'editor' },
			global: { plugins: [pinia] }
		});

		await wrapper.find('[aria-controls="window-settings"]').trigger('click');
		const options = wrapper.findAll('.window-size-option');
		await options[2].trigger('click');

		expect(store.utoolsWindowSettings).toEqual({ sizePreset: 'extraLarge', heightPercent: 92 });
		expect(window.utools.setExpendHeight).toHaveBeenCalledWith(expect.any(Number));
		const settingsWrite = window.utools.dbStorage.setItem.mock.calls.find(([key]) => key === 'json_settings_v2');
		expect(settingsWrite).toBeTruthy();
		expect(wrapper.find('#window-settings').text()).not.toContain('px');
	});
});
