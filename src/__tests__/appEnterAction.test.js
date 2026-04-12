import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';

let capturedJsonProcessorProps = null;
let pluginEnterCallback = null;

vi.mock('../components/JsonProcessor.vue', () => ({
	default: defineComponent({
		name: 'JsonProcessorStub',
		props: {
			enterAction: {
				type: Object,
				required: true
			},
			isDarkMode: {
				type: Boolean,
				default: false
			}
		},
		setup(props) {
			capturedJsonProcessorProps = props;
			return () => h('div', { 'data-testid': 'json-processor-stub' });
		}
	})
}));

vi.mock('../Hello/index.vue', () => ({
	default: defineComponent({
		name: 'HelloStub',
		props: {
			enterAction: {
				type: Object,
				required: true
			}
		},
		setup() {
			return () => h('div', { 'data-testid': 'hello-stub' });
		}
	})
}));

vi.mock('../components/Toast.vue', () => ({
	default: defineComponent({
		name: 'ToastStub',
		setup() {
			return () => h('div', { 'data-testid': 'toast-stub' });
		}
	})
}));

const App = (await import('../App.vue')).default;

describe('App plugin enter integration', () => {
	beforeEach(() => {
		capturedJsonProcessorProps = null;
		pluginEnterCallback = null;
		setActivePinia(createPinia());
		global.window = global.window || {};
		window.matchMedia = window.matchMedia || (() => ({
			matches: false,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn()
		}));
		window.services = {
			readClipboardText: vi.fn().mockReturnValue('{"fromClipboard":true}')
		};
		window.utools = {
			onPluginEnter: vi.fn((callback) => {
				pluginEnterCallback = callback;
			}),
			onPluginOut: vi.fn(),
			isDarkColors: vi.fn(() => false),
			dbStorage: {
				getItem: vi.fn(() => null),
				setItem: vi.fn()
			}
		};
	});

	it('reads clipboard text on regex entry and forwards it to JsonProcessor', async () => {
		mount(App, {
			global: {
				stubs: {
					Hello: true,
					Toast: true
				}
			}
		});

		expect(typeof pluginEnterCallback).toBe('function');

		await pluginEnterCallback({ code: 'process', type: 'regex', payload: 'ignored' });
		await flushPromises();
		await nextTick();

		expect(window.services.readClipboardText).toHaveBeenCalled();
		expect(capturedJsonProcessorProps.enterAction.text).toBe('{"fromClipboard":true}');
		expect(capturedJsonProcessorProps.enterAction.code).toBe('process');
		expect(capturedJsonProcessorProps.enterAction.type).toBe('regex');
	});
});
