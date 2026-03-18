import { mount, flushPromises } from '@vue/test-utils';
import { nextTick, defineComponent, h } from 'vue';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useJsonStore } from '../store/index.js';

const { editorFormatSpy, statusBarEscapePayload, statusBarCopyPayload } = vi.hoisted(() => ({
  editorFormatSpy: vi.fn(),
  statusBarEscapePayload: { value: '' },
  statusBarCopyPayload: { value: '' }
}));

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
      setup(props, { expose }) {
        expose({
          format: editorFormatSpy
        });
        return () => h('div', { 'data-testid': 'editor-stub' }, props.content);
      }
    })
  };
});

vi.mock('../components/StatusBar.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      name: 'StatusBarStub',
      emits: ['copy', 'format', 'escape', 'unescape', 'compare', 'aiProcess'],
      setup(_, { emit }) {
        return () => h('div', [
          h('button', {
            'data-testid': 'status-bar-stub-escape',
            onClick: () => emit('escape', statusBarEscapePayload.value)
          }, 'emit-escape'),
          h('button', {
            'data-testid': 'status-bar-stub-copy',
            onClick: () => emit('copy')
          }, 'emit-copy')
        ]);
      }
    })
  };
});

vi.mock('../components/TabBar.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      name: 'TabBarStub',
      setup() {
        return () => h('div', { 'data-testid': 'tab-bar-stub' });
      }
    })
  };
});

vi.mock('../components/OutputPanel.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      name: 'OutputPanelStub',
      setup() {
        return () => h('div', { 'data-testid': 'output-panel-stub' });
      }
    })
  };
});

vi.mock('../components/DiffSidebar.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      name: 'DiffSidebarStub',
      setup() {
        return () => h('div', { 'data-testid': 'diff-sidebar-stub' });
      }
    })
  };
});

const JsonProcessor = (await import('../components/JsonProcessor.vue')).default;

describe('JsonProcessor', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    editorFormatSpy.mockReset();
    statusBarEscapePayload.value = '';
    statusBarCopyPayload.value = '';
    // mock alert to avoid test environment errors
    global.alert = vi.fn();
  });

  it('creates a new tab and formats content when enterAction text changes', async () => {
    const wrapper = mount(JsonProcessor, {
      props: {
        enterAction: {}
      },
      global: {}
    });

    const store = useJsonStore();

    expect(store.tabs).toHaveLength(1);
    expect(store.getActiveTab().content).toBe('{}');

    await wrapper.setProps({
      enterAction: {
        text: '{"name":"uTools","enabled":true}'
      }
    });
    await flushPromises();
    await nextTick();

    expect(store.tabs).toHaveLength(2);
    expect(store.getActiveTab().content).toContain('"name": "uTools"');
    expect(editorFormatSpy).toHaveBeenCalled();
  });

  it('copies escaped content to clipboard after escape event', async () => {
    window.utools = {
      copyText: vi.fn()
    };

    const wrapper = mount(JsonProcessor, {
      props: {
        enterAction: {}
      },
      global: {}
    });

    const store = useJsonStore();
    const escaped = '"{\\\"name\\\":\\\"uTools\\\"}"';
    statusBarEscapePayload.value = escaped;

    await nextTick();
    await wrapper.get('[data-testid="status-bar-stub-escape"]').trigger('click');
    await nextTick();

    expect(store.getActiveTab().content).toBe(escaped);
    expect(window.utools.copyText).toHaveBeenCalledWith(escaped);
  });

  it('copies empty and whitespace active tab content to clipboard', async () => {
    window.utools = {
      copyText: vi.fn()
    };

    const wrapper = mount(JsonProcessor, {
      props: {
        enterAction: {}
      },
      global: {}
    });

    const store = useJsonStore();

    // copy empty string
    store.updateTabContent(store.getActiveTab().id, '');
    await nextTick();
    await wrapper.get('[data-testid="status-bar-stub-copy"]').trigger('click');
    await nextTick();
    expect(window.utools.copyText).toHaveBeenCalledWith('');

    // copy whitespace-only string (whitespace is stripped before copying)
    store.updateTabContent(store.getActiveTab().id, '   ');
    await nextTick();
    await wrapper.get('[data-testid="status-bar-stub-copy"]').trigger('click');
    await nextTick();
    expect(window.utools.copyText).toHaveBeenCalledWith('');
  });
});
