import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { useJsonStore } from '../store/index.js';

vi.mock('../components/Editor.vue', async () => {
	const { defineComponent, h } = await import('vue');
	return {
		default: defineComponent({
			name: 'EditorStub',
			props: {
				content: {
					type: String,
					default: ''
				}
			},
			emits: ['change'],
			setup(props) {
				return () => h('div', { 'data-testid': 'editor-stub' }, props.content);
			}
		})
	};
});

vi.mock('../components/DiffView.vue', async () => {
	const { defineComponent, h } = await import('vue');
	return {
		default: defineComponent({
			name: 'DiffViewStub',
			props: {
				singleColumn: {
					type: Boolean,
					default: false
				}
			},
			setup(props) {
				return () => h('div', {
					'data-testid': 'diff-view-stub',
					'data-single-column': String(props.singleColumn)
				});
			}
		})
	};
});

const DiffSidebar = (await import('../components/DiffSidebar.vue')).default;

describe('DiffSidebar compare behavior', () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		globalThis.__monacoLastEditor = null;
	});

	it('routes compare action through showOutputPanel(diff)', async () => {
		const store = useJsonStore();
		store.addTab('{"b":2}', 'tab1', 'json');
		store.diffSidebar.visible = true;
		store.diffSidebar.mode = 'input';
		store.diffSidebar.leftInput = '{"a":1}';

		const showOutputPanelSpy = vi.spyOn(store, 'showOutputPanel');

		const wrapper = mount(DiffSidebar);
		await nextTick();

		await wrapper.get('.diff-btn--primary').trigger('click');
		await flushPromises();

		expect(showOutputPanelSpy).toHaveBeenCalledWith(
			'diff',
			expect.objectContaining({
				left: expect.any(String),
				right: expect.any(String)
			})
		);
	});

	it('does not render duplicate action label 在结果标签查看', async () => {
		const store = useJsonStore();
		store.addTab('{"b":2}', 'tab1', 'json');
		store.diffSidebar.visible = true;
		store.diffSidebar.mode = 'input';
		store.diffSidebar.leftInput = '{"a":1}';

		const wrapper = mount(DiffSidebar);
		await nextTick();

		expect(wrapper.text()).not.toContain('在结果标签查看');
	});

	it('renders line diff result without legacy tree diff stats', async () => {
		const store = useJsonStore();
		store.diffSidebar.visible = true;
		store.diffSidebar.mode = 'result';
		store.diffSidebar.leftContent = '{"a":1}';
		store.diffSidebar.rightContent = '{"a":2}';

		const wrapper = mount(DiffSidebar);
		await nextTick();

		expect(wrapper.find('[data-testid="diff-view-stub"]').exists()).toBe(true);
		expect(wrapper.text()).not.toContain('新增:');
		expect(wrapper.text()).not.toContain('变化:');
	});

	it('supports mouse drag to resize right sidebar width', async () => {
		const store = useJsonStore();
		store.diffSidebar.visible = true;
		store.diffSidebar.mode = 'input';

		const wrapper = mount(DiffSidebar);
		await nextTick();

		const sidebar = wrapper.get('.diff-sidebar');
		expect(sidebar.attributes('style') || '').not.toContain('width');

		const resizer = wrapper.get('.diff-sidebar-resizer');
		await resizer.trigger('mousedown', { clientX: 900, button: 0 });
		window.dispatchEvent(new MouseEvent('mousemove', { clientX: 860 }));
		window.dispatchEvent(new MouseEvent('mouseup'));
		await nextTick();

		expect(sidebar.attributes('style') || '').toContain('width:');
	});

	it('passes singleColumn=true to DiffView in result mode', async () => {
		const store = useJsonStore();
		store.addTab('{"b":2}', 'tab1', 'json');
		store.diffSidebar.visible = true;
		store.diffSidebar.mode = 'result';
		store.diffSidebar.leftContent = '{"a":1}';
		store.diffSidebar.rightContent = '{"a":2}';

		const wrapper = mount(DiffSidebar);
		await nextTick();

		expect(wrapper.get('[data-testid="diff-view-stub"]').attributes('data-single-column')).toBe('true');
	});

	it('shows 居中查看 action in result mode', async () => {
		const store = useJsonStore();
		store.addTab('{"b":2}', 'tab1', 'json');
		store.diffSidebar.visible = true;
		store.diffSidebar.mode = 'result';
		store.diffSidebar.leftContent = '{"a":1}';
		store.diffSidebar.rightContent = '{"a":2}';

		const wrapper = mount(DiffSidebar);
		await nextTick();

		expect(wrapper.text()).toContain('居中查看');
		expect(wrapper.text()).not.toContain('行级对比');
	});

	it('renders jsonpath output with a readonly Monaco viewer in output mode', async () => {
		const store = useJsonStore();
		store.addTab('{"b":2}', 'tab1', 'json');
		store.diffSidebar.visible = true;
		store.diffSidebar.mode = 'output';
		store.outputPanel.visible = true;
		store.outputPanel.currentTab = 'jsonpath';
		store.outputPanel.content.jsonpath = { value: { a: 1, nested: { ok: true } }, error: null };

		const wrapper = mount(DiffSidebar);
		await flushPromises();
		await nextTick();
		await flushPromises();

		expect(globalThis.__monacoLastEditor).toBeTruthy();
		expect(wrapper.find('.output-text').exists()).toBe(false);
	});
});
