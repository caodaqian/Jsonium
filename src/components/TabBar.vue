<script setup>
import { ref, watch } from 'vue';

const props = defineProps({
  tabs: {
    type: Array,
    default: () => []
  },
  activeTabId: {
    type: Number,
    default: null
  }
});

const emit = defineEmits([
  'selectTab',
  'closeTab',
  'newTab',
  'renameTab',
  'toggleFavorite',
  'closeOtherTabs',
  'closeAllTabs',
  'closeLeftTabs'
]);

const editingTabId = ref(null);
const editingName = ref('');

function startEdit(tab) {
  editingTabId.value = tab.id;
  editingName.value = tab.name;
}

function saveEdit(tabId) {
  // 保存重命名并通知父组件
  emit('renameTab', tabId, editingName.value);
  editingTabId.value = null;
  editingName.value = '';
}

function handleKeyDown(e, tabId) {
  if (e.key === 'Enter') {
    saveEdit(tabId);
  } else if (e.key === 'Escape') {
    editingTabId.value = null;
  }
}

const showMenu = ref(false);
const menuX = ref(0);
const menuY = ref(0);
const menuTabId = ref(null);

function onContextmenu(tab, e) {
  try {
    menuTabId.value = tab.id;
    showMenu.value = true;
    menuX.value = e.clientX || 0;
    menuY.value = e.clientY || 0;
    e.preventDefault && e.preventDefault();
  } catch (err) {
    // ignore
  }
}

function closeMenu() {
  showMenu.value = false;
  menuTabId.value = null;
}

function onMenuAction(action) {
  const id = menuTabId.value;
  closeMenu();
  if (!id) return;
  if (action === 'close') emit('closeTab', id);
  else if (action === 'closeOthers') emit('closeOtherTabs', id);
  else if (action === 'closeLeft') emit('closeLeftTabs', id);
  else if (action === 'closeAll') emit('closeAllTabs');
  else if (action === 'toggleFav') emit('toggleFavorite', id);
}

// 自动在 showMenu 打开/关闭时注册 window 点击以便点空白区域关闭菜单
watch(showMenu, (v) => {
  try {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    if (v) window.addEventListener('click', closeMenu);
    else window.removeEventListener('click', closeMenu);
  } catch (_) { }
});
</script>

<template>
  <div class="tab-bar">
    <div class="tabs-scroll">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        :class="['tab', { active: tab.id === activeTabId }]"
        @click="emit('selectTab', tab.id)"
        @contextmenu.prevent="onContextmenu(tab, $event)"
      >
        <div class="tab-content">
          <span v-if="editingTabId === tab.id" class="tab-label-edit">
            <input
              v-model="editingName"
              @blur="saveEdit(tab.id)"
              @keydown="handleKeyDown($event, tab.id)"
              @click.stop
              class="tab-input"
              autofocus
            />
          </span>
          <span v-else class="tab-label" @dblclick="startEdit(tab)">
            <span v-if="tab.favorited" class="tab-star">🌟</span>
            {{ tab.name }}
          </span>
          <span v-if="tab.isModified" class="tab-modified">●</span>
        </div>
        <button
          class="tab-close"
          @click.stop="emit('closeTab', tab.id)"
          title="关闭"
        >
          ×
        </button>
      </div>
    </div>

    <div v-if="showMenu" class="tab-context-menu" :style="{ left: menuX + 'px', top: menuY + 'px' }" @click.stop>
      <ul class="menu-list">
        <li @click.stop="onMenuAction('close')">关闭此标签页</li>
        <li @click.stop="onMenuAction('closeOthers')">关闭其他标签页</li>
        <li @click.stop="onMenuAction('closeLeft')">关闭左侧标签页</li>
        <li @click.stop="onMenuAction('closeAll')">关闭所有标签页</li>
        <li @click.stop="onMenuAction('toggleFav')">
          {{ (tabs.find(t=>t.id===menuTabId) && tabs.find(t=>t.id===menuTabId).favorited) ? '取消收藏' : '收藏' }}
        </li>
      </ul>
    </div>

    <button class="tab-new" @click="emit('newTab')" title="新建标签页">
      +
    </button>
  </div>
</template>

<style scoped>
.tab-bar {
  display: flex;
  gap: 2px;
  background: var(--color-bg-secondary);
  padding: 3px;
  border-radius: 4px;
  align-items: center;
  overflow-x: auto;
}

.tabs-scroll {
  display: flex;
  gap: 2px;
  flex: 1;
  overflow-x: auto;
  min-width: 0;
}

.tab {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px 6px;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  cursor: pointer;
  white-space: nowrap;
  font-size: 11px;
  transition: all 0.2s;
  flex-shrink: 0;
  color: var(--color-text-primary);
}

.tab:hover {
  background: var(--color-hover-bg);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.tab.active {
  background: var(--color-bg-primary);
  border-color: var(--color-primary);
  color: var(--color-primary);
  font-weight: 500;
}

.tab-content {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* 自适应宽度，允许伸缩以显示更长标题 */
  flex: 1 1 auto;
  min-width: 40px;
  max-width: 40vw;
}

.tab-star {
  margin-right: 6px;
  color: var(--color-primary);
  font-size: 12px;
}
 
.tab-context-menu {
  position: absolute;
  z-index: 99999;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border);
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  border-radius: 4px;
  padding: 6px 0;
  min-width: 140px;
}

.tab-context-menu .menu-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.tab-context-menu .menu-list li {
  padding: 8px 12px;
  cursor: pointer;
  color: var(--color-text-primary);
  font-size: 13px;
}

.tab-context-menu .menu-list li:hover {
  background: var(--color-hover-bg);
}

.tab-label-edit {
  display: contents;
}

.tab-input {
  width: 80px;
  padding: 2px 4px;
  border: 1px solid var(--color-primary);
  border-radius: 2px;
  font-size: 11px;
  outline: none;
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
}

.tab-modified {
  color: var(--color-error);
  font-size: 8px;
}

.tab-close {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  color: var(--color-text-tertiary);
  padding: 0 2px;
  line-height: 1;
  transition: color 0.2s;
}

.tab-close:hover {
  color: var(--color-error);
}

.tab-new {
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 3px;
  padding: 3px 6px;
  cursor: pointer;
  font-size: 12px;
  font-weight: bold;
  transition: background 0.2s;
  flex-shrink: 0;
}

.tab-new:hover {
  background: var(--color-primary-dark);
}
</style>
