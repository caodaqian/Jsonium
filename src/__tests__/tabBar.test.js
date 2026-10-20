import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import TabBar from '../components/TabBar.vue';
import { useJsonStore } from '../store/index.js';

let wrapper;
let store;
let tabId;

beforeEach(() => {
	setActivePinia(createPinia());
	store = useJsonStore();
	store.tabs = [];
	tabId = store.addTab('{}', 'Original title');
	wrapper = mount(TabBar, {
		attachTo: document.body,
		props: {
			tabs: store.tabs,
			activeTabId: tabId,
			onRenameTab: store.updateTabName
		}
	});
});

afterEach(() => {
	wrapper.unmount();
});

const editTitle = async () => {
	await wrapper.get('.tab-label').trigger('dblclick');
	return wrapper.get('input');
};

const dispatchKey = (input, key) => {
	const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
	input.element.dispatchEvent(event);
	return event;
};

describe('TabBar renaming', () => {
	it('focuses and selects the current title when editing starts', async () => {
		const input = await editTitle();
		expect(document.activeElement).toBe(input.element);
		expect(input.element.selectionStart).toBe(0);
		expect(input.element.selectionEnd).toBe('Original title'.length);
	});

	it('saves the title on Enter', async () => {
		const input = await editTitle();
		await input.setValue('Renamed title');
		await input.trigger('keydown', { key: 'Enter' });
		expect(store.getActiveTab().name).toBe('Renamed title');
		expect(wrapper.find('input').exists()).toBe(false);
	});

	it('saves the title on blur', async () => {
		const input = await editTitle();
		await input.setValue('Renamed title');
		await input.trigger('blur');
		expect(store.getActiveTab().name).toBe('Renamed title');
		expect(wrapper.emitted('renameTab')).toEqual([[tabId, 'Renamed title']]);
	});

	it('keeps the saved title when Enter is followed by blur', async () => {
		const input = await editTitle();
		await input.setValue('Renamed title');
		dispatchKey(input, 'Enter');
		input.element.dispatchEvent(new Event('blur'));
		await nextTick();
		expect(store.getActiveTab().name).toBe('Renamed title');
		expect(wrapper.emitted('renameTab')).toEqual([[tabId, 'Renamed title']]);
	});

	it('does not save cancelled edits when Escape is followed by blur', async () => {
		const input = await editTitle();
		await input.setValue('Cancelled title');
		dispatchKey(input, 'Escape');
		input.element.dispatchEvent(new Event('blur'));
		await nextTick();
		expect(store.getActiveTab().name).toBe('Original title');
		expect(wrapper.emitted('renameTab')).toBeUndefined();
		expect(wrapper.find('input').exists()).toBe(false);
	});

	it('does not select the tab when Enter saves an edit', async () => {
		const input = await editTitle();
		await input.trigger('keydown', { key: 'Enter' });
		expect(wrapper.emitted('selectTab')).toBeUndefined();
	});

	it('allows spaces in the input without selecting the tab', async () => {
		const input = await editTitle();
		const event = dispatchKey(input, ' ');
		expect(event.defaultPrevented).toBe(false);
		expect(wrapper.emitted('selectTab')).toBeUndefined();
	});

	it.each(['Enter', ' '])('still selects a non-editing tab with %j', async (key) => {
		await wrapper.get('[role="tab"]').trigger('keydown', { key });
		expect(wrapper.emitted('selectTab')).toEqual([[tabId]]);
	});
});
