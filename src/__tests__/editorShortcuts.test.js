import { flushPromises, mount } from '@vue/test-utils';
import { KeyCode, KeyMod } from 'monaco-editor';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import Editor from '../components/Editor.vue';
import StatusBar from '../components/StatusBar.vue';

const waitForEditorSetup = async () => {
  await flushPromises();
  await nextTick();
  await flushPromises();
  await nextTick();
};

describe('editor shortcut registrations', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    globalThis.__monacoLastEditor = null;
    window.utools = { copyText: vi.fn() };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers the format fallback and current JSON copy action', async () => {
    mount(Editor, {
      props: {
        content: '{"a":1}'
      }
    });

    await waitForEditorSetup();

    const editor = globalThis.__monacoLastEditor;
    expect(editor).toBeTruthy();

    const formatAction = editor.actions.find((action) => action.id === 'json-format');
    expect(formatAction).toBeTruthy();
    expect(formatAction.keybindings).toEqual(
      expect.arrayContaining([
        KeyMod.Shift | KeyMod.Alt | KeyCode.KeyF,
        KeyMod.Shift | KeyMod.CtrlCmd | KeyCode.KeyF
      ])
    );

    const copyCurrentAction = editor.actions.find((action) => action.id === 'json-copy-current');
    expect(copyCurrentAction).toBeTruthy();
    expect(copyCurrentAction.label).toBe('复制当前 JSON');
    expect(copyCurrentAction.keybindings).toEqual(
      expect.arrayContaining([
        KeyMod.Shift | KeyMod.Alt | KeyCode.KeyJ,
        KeyMod.Shift | KeyMod.CtrlCmd | KeyCode.KeyJ
      ])
    );

    expect(editor.commands.some((entry) => entry.keybinding === (KeyMod.Shift | KeyMod.CtrlCmd | KeyCode.KeyF))).toBe(true);
    expect(editor.commands.some((entry) => entry.keybinding === (KeyMod.Shift | KeyMod.Alt | KeyCode.KeyJ))).toBe(true);
    expect(editor.commands.some((entry) => entry.keybinding === (KeyMod.Shift | KeyMod.CtrlCmd | KeyCode.KeyJ))).toBe(true);
  });

  it('shows the updated help shortcuts in the status tooltip', async () => {
    const wrapper = mount(StatusBar, {
      props: {
        content: '{}'
      }
    });

    await wrapper.get('button[aria-label="帮助"]').trigger('click');
    await nextTick();

    expect(wrapper.text()).toContain('格式化：Shift + Alt + F（备用：Cmd/Ctrl + Shift + F）');
    expect(wrapper.text()).toContain('复制当前 JSON：Shift + Alt + J（备用：Cmd/Ctrl + Shift + J）');
  });
});
