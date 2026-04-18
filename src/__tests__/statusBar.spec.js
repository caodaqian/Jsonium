import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import StatusBar from '../components/StatusBar.vue';
import { useJsonStore } from '../store/index.js';

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('StatusBar events', () => {
  it('does not render format button (moved to editor context menu)', async () => {
    const wrapper = mount(StatusBar, { props: { content: '{}' } });
    expect(wrapper.find('button[title="格式化"]').exists()).toBe(false);
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

  it('opens AI sidebar mode when AI button clicked', async () => {
    const store = useJsonStore();
    const wrapper = mount(StatusBar, { props: { content: '{}' } });
    const btn = wrapper.get('button[title="AI"]');

    await btn.trigger('click');

    expect(store.diffSidebar.visible).toBe(true);
    expect(store.diffSidebar.mode).toBe('ai');
  });
});
