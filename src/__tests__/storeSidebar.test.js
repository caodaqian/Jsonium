import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { useJsonStore } from '../store/index.js';

describe('store unified sidebar behavior', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('opens unified right sidebar when showing jsonpath output', () => {
    const store = useJsonStore();

    store.showOutputPanel('jsonpath', { value: [{ id: 1 }], error: null });

    expect(store.outputPanel.visible).toBe(true);
    expect(store.outputPanel.currentTab).toBe('jsonpath');
    expect(store.diffSidebar.visible).toBe(true);
    expect(store.diffSidebar.collapsed).toBe(false);
    expect(store.diffSidebar.mode).toBe('output');
  });

  it('hides unified right sidebar when output panel closes in output mode', () => {
    const store = useJsonStore();
    store.showOutputPanel('jq', { value: [{ id: 2 }], error: null });

    store.hideOutputPanel();

    expect(store.outputPanel.visible).toBe(false);
    expect(store.diffSidebar.visible).toBe(false);
  });
});
