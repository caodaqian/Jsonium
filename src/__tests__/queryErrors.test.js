import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StatusBar from '../components/StatusBar.vue';
import DiffSidebar from '../components/DiffSidebar.vue';
import { useJsonStore } from '../store/index.js';

const { raw } = vi.hoisted(() => ({ raw: vi.fn() }));
vi.mock('jq-wasm', () => ({ raw }));

let status;
let sidebar;
let store;

beforeEach(() => {
	setActivePinia(createPinia());
	store = useJsonStore();
	raw.mockReset();
	status = mount(StatusBar, { props: { content: '{"items":[1,2]}' } });
	sidebar = mount(DiffSidebar);
});

afterEach(() => {
	status.unmount();
	sidebar.unmount();
});

const run = async (expression) => {
	await status.get('#status-query-expression').setValue(expression);
	await status.get('.query-btn.primary').trigger('click');
	await flushPromises();
};

describe('query error visibility', () => {
	it('shows malformed JSONPath as an error instead of successful data', async () => {
		await run('$.items[');
		expect(sidebar.get('.output-text.is-error').text()).toMatch(/JSONPath.*位置/);
	});

	it('keeps multiline jq diagnostics visible in the sidebar', async () => {
		raw.mockResolvedValue({ stdout: '', stderr: 'syntax error, line 1:\n.foo |\n     ^', exitCode: 3 });
		await run('.foo |');
		expect(sidebar.get('.output-text.is-error').text()).toContain('syntax error, line 1:\n.foo |\n     ^');
	});

	it('does not let an earlier jq success hide the latest JSONPath error', async () => {
		let finish;
		raw.mockReturnValue(new Promise(resolve => { finish = resolve; }));
		await run('.items');
		await run('$.items[?(@.x ===)]');
		const message = sidebar.get('.output-text.is-error').text();
		finish({ stdout: '[1,2]', stderr: '', exitCode: 0 });
		await flushPromises();
		expect(store.outputPanel.currentTab).toBe('jsonpath');
		expect(sidebar.get('.output-text.is-error').text()).toBe(message);
	});

	it('does not reopen results when a pending query is cleared', async () => {
		let finish;
		raw.mockReturnValue(new Promise(resolve => { finish = resolve; }));
		await run('.items');
		await status.get('.query-close-btn').trigger('click');
		finish({ stdout: '', stderr: 'late error', exitCode: 3 });
		await flushPromises();
		expect(store.outputPanel.visible).toBe(false);
		expect(status.find('.query-error').exists()).toBe(false);
	});

	it('shows empty-expression validation in the output panel too', async () => {
		await run('');
		expect(sidebar.get('.output-text.is-error').text()).toBe('请输入查询表达式');
	});
});
