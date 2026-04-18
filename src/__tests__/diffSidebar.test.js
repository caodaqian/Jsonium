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
			setup() {
				return () => h('div', { 'data-testid': 'diff-view-stub' });
			}
		})
	};
});

const DiffSidebar = (await import('../components/DiffSidebar.vue')).default;

describe('DiffSidebar compare behavior', () => {
	beforeEach(() => {
		setActivePinia(createPinia());
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

	it('always shows AI tab in sidebar tabs', async () => {
		const store = useJsonStore();
		store.diffSidebar.visible = true;
		store.diffSidebar.mode = 'input';

		const wrapper = mount(DiffSidebar);
		await nextTick();

		expect(wrapper.text()).toContain('🤖 AI');
	});

	it('extracts fenced json before creating new tab', async () => {
		const store = useJsonStore();
		store.diffSidebar.visible = true;
		store.diffSidebar.mode = 'ai';
		store.aiComposer.messages = [
			{ id: 'a1', role: 'assistant', content: '结果如下:\n```json\n{"x":1,"y":2}\n```' }
		];

		const addTabSpy = vi.spyOn(store, 'addTab');
		const wrapper = mount(DiffSidebar);
		await nextTick();

		const createBtn = wrapper.findAll('button').find((btn) => btn.text().includes('新建标签'));
		expect(createBtn).toBeTruthy();
		await createBtn.trigger('click');
		await flushPromises();

		expect(addTabSpy).toHaveBeenCalled();
		const firstArg = addTabSpy.mock.calls[0][0];
		expect(() => JSON.parse(firstArg)).not.toThrow();
		expect(JSON.parse(firstArg)).toEqual({ x: 1, y: 2 });
	});
});
