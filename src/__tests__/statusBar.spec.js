import { mount } from '@vue/test-utils';
import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import StatusBar from '../components/StatusBar.vue';

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('StatusBar events', () => {
  it('emits format when format button clicked', async () => {
    const wrapper = mount(StatusBar, { props: { content: '{}' } });
    const btn = wrapper.get('button[title="格式化"]');
    await btn.trigger('click');
    expect(wrapper.emitted()).toHaveProperty('format');
  });

  it('emits compare with content and empty right when compare clicked', async () => {
    const content = '{"a":1}';
    const wrapper = mount(StatusBar, { props: { content } });
    const btn = wrapper.get('button[title="对比"]');
    await btn.trigger('click');
    const calls = wrapper.emitted('compare');
    expect(calls).toBeTruthy();
    expect(calls[0]).toEqual([content, '']);
  });
});