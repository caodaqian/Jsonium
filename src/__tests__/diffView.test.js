import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

vi.mock('../components/DiffTextView.vue', () => ({
	default: defineComponent({
		name: 'DiffTextViewStub',
		props: {
			left: { type: String, default: '' },
			right: { type: String, default: '' },
			singleColumn: { type: Boolean, default: false }
		},
		setup(props) {
			return () => h('div', {
				class: 'diff-textview-stub',
				'data-single-column': String(props.singleColumn)
			}, `${props.left}\n---\n${props.right}`);
		}
	})
}));

const DiffView = (await import('../components/DiffView.vue')).default;

describe('DiffView simplification', () => {
	it('renders line comparison without tree tab and line list panel', async () => {
		const wrapper = mount(DiffView, {
			props: {
				leftContent: '{"a":1,"b":2}',
				rightContent: '{"a":1,"b":3}'
			}
		});

		await wrapper.vm.$nextTick();

		expect(wrapper.text()).not.toContain('diff 树状对比');
		expect(wrapper.text()).not.toContain('行级差异');
		expect(wrapper.find('.text-area').exists()).toBe(true);
		expect(wrapper.find('.list-area').exists()).toBe(false);
	});

	it('passes singleColumn to DiffTextView when enabled', async () => {
		const wrapper = mount(DiffView, {
			props: {
				leftContent: '{"a":1}',
				rightContent: '{"a":2}',
				singleColumn: true
			}
		});

		await wrapper.vm.$nextTick();

		expect(wrapper.find('.diff-textview-stub').attributes('data-single-column')).toBe('true');
	});
});
