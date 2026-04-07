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

  it('escape and unescape buttons have aria-labels and classes', async () => {
    const wrapper = mount(StatusBar, { props: { content: '{}' } });
    const esc = wrapper.get('button[title="转义"]');
    const unesc = wrapper.get('button[title="反转义"]');
    expect(esc.attributes('aria-label')).toMatch(/转义/);
    expect(unesc.attributes('aria-label')).toMatch(/反转义/);
    expect(esc.classes()).toContain('action-btn--escape');
    expect(unesc.classes()).toContain('action-btn--unescape');
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
