import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import OutputPanel from '../components/OutputPanel.vue';
import { useJsonStore } from '../store/index.js';

const waitForOutputPanelSetup = async () => {
	await flushPromises();
	await nextTick();
	await flushPromises();
	await nextTick();
};

describe('OutputPanel Monaco highlighting', () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		globalThis.__monacoLastEditor = null;
		globalThis.utools = { copyText: vi.fn() };
	});

	it('renders jsonpath output with a readonly Monaco viewer', async () => {
		const store = useJsonStore();
		store.showOutputPanel('jsonpath', { value: [{ id: 1, name: 'Alice' }], error: null });

		const wrapper = mount(OutputPanel, {
			global: {
				stubs: {
					DiffView: { template: '<div class="diff-view-stub" />' }
				}
			}
		});

		await waitForOutputPanelSetup();

		expect(globalThis.__monacoLastEditor).toBeTruthy();
		expect(wrapper.find('.output-text').exists()).toBe(false);
	});

	it('keeps error output in plain text mode', async () => {
		const store = useJsonStore();
		store.showOutputPanel('jq', { value: null, error: '表达式解析失败' });

		const wrapper = mount(OutputPanel, {
			global: {
				stubs: {
					DiffView: { template: '<div class="diff-view-stub" />' }
				}
			}
		});

		await waitForOutputPanelSetup();

		expect(wrapper.find('.output-text.is-error').exists()).toBe(true);
		expect(wrapper.text()).toContain('表达式解析失败');
	});
});