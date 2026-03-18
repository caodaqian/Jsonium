import { mount, flushPromises } from '@vue/test-utils';
import { nextTick, defineComponent, h } from 'vue';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import JsonProcessor from '../components/JsonProcessor.vue';
import { useJsonStore } from '../store/index.js';

let editorFormatSpy;

const EditorStub = defineComponent({
  name: 'EditorStub',
  props: {
    content: {
      type: String,
      default: ''
    }
  },
  emits: ['change'],
  setup(props, { expose }) {
    editorFormatSpy = vi.fn();
    expose({
      format: editorFormatSpy
    });
    return () => h('div', { 'data-testid': 'editor-stub' }, props.content);
  }
});

const StatusBarStub = defineComponent({
  name: 'StatusBarStub',
  emits: ['copy', 'format', 'escape', 'unescape', 'compare', 'aiProcess'],
  setup() {
    return () => h('div', { 'data-testid': 'status-bar-stub' });
  }
});

const TabBarStub = defineComponent({
  name: 'TabBarStub',
  setup() {
    return () => h('div', { 'data-testid': 'tab-bar-stub' });
  }
});

const OutputPanelStub = defineComponent({
  name: 'OutputPanelStub',
  setup() {
    return () => h('div', { 'data-testid': 'output-panel-stub' });
  }
});

const DiffSidebarStub = defineComponent({
  name: 'DiffSidebarStub',
  setup() {
    return () => h('div', { 'data-testid': 'diff-sidebar-stub' });
  }
});

describe('JsonProcessor', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    editorFormatSpy = vi.fn();
  });

  it('creates a new tab and formats content when enterAction text changes', async () => {
    const wrapper = mount(JsonProcessor, {
      props: {
        enterAction: {}
      },
      global: {
        stubs: {
          Editor: EditorStub,
          StatusBar: StatusBarStub,
          TabBar: TabBarStub,
          OutputPanel: OutputPanelStub,
          DiffSidebar: DiffSidebarStub
        }
      }
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
});