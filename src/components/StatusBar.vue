<script setup>
import { computed, reactive, ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import { queryJsonPath, queryJq, validateQuery, detectQueryType } from '../services/queryEngine.js';
import { useJsonStore } from '../store/index.js';
import { fetchUtoolsModels } from '../services/aiProcessor.js';
import notify from '../services/notify.js';
import { jsonToGoStruct, jsonToJavaClass, jsonToPython, jsonToTypeScript, jsonToJavaScript } from '../services/converter.js';

const store = useJsonStore();
const props = defineProps({
  content: {
    type: String,
    default: '{}'
  }
});

const emit = defineEmits([
  'escape',
  'unescape',
  'compare',
  'aiProcess',
  'openTableView',
  'format'
]);

const queryExpression = ref('');
const queryType = ref('jsonpath');
const detectedQueryType = ref('jsonpath'); // 自动识别的类型
const queryResult = ref(null);
const queryError = ref('');
const showCopyMenu = ref(false);
const copyMenuButtonRef = ref(null);
const copyMenuRef = ref(null);
const copyMenuPosition = ref({ top: 0, left: 0, height: 0 });
const typeOverride = ref(false); // 用户是否手动覆盖了类型
let scrollRaf = null;


const showAiPanel = computed({
  get: () => store.aiComposer.visible,
  set: (v) => { store.aiComposer.visible = v; }
});
const aiTextareaRef = ref(null);
// expose local helpers to interact with store.aiComposer
const aiDraft = computed({
  get: () => store.aiComposer.draft,
  set: (v) => { store.setAIDraft(v); }
});
const aiSelectedModel = computed({
  get: () => store.aiComposer.selectedModel,
  set: (v) => { store.setAISelectedModel(v); }
});
const aiModels = computed(() => store.aiComposer.models);
const aiLoadingModels = computed(() => store.aiComposer.loadingModels);
const aiModelLoadError = computed(() => store.aiComposer.modelLoadError);

// 监听查询表达式变化，自动检测类型
watch(queryExpression, (newExpr) => {
  if (!typeOverride.value) {
    detectedQueryType.value = detectQueryType(newExpr);
    queryType.value = detectedQueryType.value;
  }
}, { immediate: true });

// UI: help tooltip & copy error feedback
const showHelpTooltip = ref(false);
const helpTooltipRef = ref(null);
const copyErrorMessage = ref('');
let copyErrorTimer = null;

function handleEditorCopyError(e) {
  try {
    copyErrorMessage.value = (e && e.detail && e.detail.reason) ? e.detail.reason : '复制失败';
    if (copyErrorTimer) clearTimeout(copyErrorTimer);
    copyErrorTimer = setTimeout(() => { copyErrorMessage.value = ''; copyErrorTimer = null; }, 3000);
  } catch (err) {
    // ignore
  }
}

const copyMenuStyles = computed(() => {
  const margin = 8;
  const top = copyMenuPosition.value.adjustedTop !== undefined && copyMenuPosition.value.adjustedTop !== null
    ? copyMenuPosition.value.adjustedTop
    : (copyMenuPosition.value.top + copyMenuPosition.value.height + margin);
  const left = copyMenuPosition.value.adjustedLeft !== undefined && copyMenuPosition.value.adjustedLeft !== null
    ? copyMenuPosition.value.adjustedLeft
    : copyMenuPosition.value.left;
  return {
    top: `${top}px`,
    left: `${left}px`
  };
});

const positionCopyMenu = () => {
  const menuEl = copyMenuRef.value;
  const btnRect = copyMenuPosition.value && {
    top: copyMenuPosition.value.top,
    left: copyMenuPosition.value.left,
    height: copyMenuPosition.value.height
  };
  if (!menuEl || !btnRect) return;
  const margin = 8;
  const menuW = menuEl.offsetWidth;
  const menuH = menuEl.offsetHeight;
  let left = btnRect.left;
  let top = btnRect.top + btnRect.height + window.scrollY;

  if (left + menuW > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - menuW - margin);
  }
  if (top + menuH > window.innerHeight - margin + window.scrollY) {
    top = btnRect.top + window.scrollY - menuH - margin;
  }

  left = Math.max(margin, left);
  top = Math.max(margin, top);

  copyMenuPosition.value.adjustedLeft = left;
  copyMenuPosition.value.adjustedTop = top;
};

const handleWindowResize = () => {
  if (showCopyMenu.value) positionCopyMenu();
};
const handleWindowScroll = () => {
  if (!showCopyMenu.value) return;
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    try {
      if (showCopyMenu.value) positionCopyMenu();
    } catch (_) {}
    scrollRaf = null;
  });
};
const handleWindowKeyDown = (e) => {
  if (e.key === 'Escape' && showCopyMenu.value) {
    showCopyMenu.value = false;
  }
};

const toggleCopyMenu = (event) => {
  event.stopPropagation();
  const rect = event.currentTarget.getBoundingClientRect();
  copyMenuPosition.value = {
    top: rect.top + window.scrollY,
    left: rect.left + window.scrollX,
    height: rect.height,
    adjustedTop: undefined,
    adjustedLeft: undefined
  };
  showCopyMenu.value = !showCopyMenu.value;
  if (showCopyMenu.value) {
    nextTick(() => {
      positionCopyMenu();
    });
  }
};

const handleDocumentClick = (event) => {
  if (!showCopyMenu.value) return;
  const target = event.target;
  if (copyMenuRef.value?.contains(target) || copyMenuButtonRef.value?.contains(target)) {
    return;
  }
  showCopyMenu.value = false;
};

// 切换查询类型（用户手动切换）
const toggleQueryType = () => {
  typeOverride.value = true;
  queryType.value = queryType.value === 'jsonpath' ? 'jq' : 'jsonpath';
};

onMounted(() => {
  document.addEventListener('click', handleDocumentClick);
  window.addEventListener('resize', handleWindowResize);
  // use capture to catch scrolls on any scrollable ancestor; passive to avoid blocking scroll
  window.addEventListener('scroll', handleWindowScroll, { capture: true, passive: true });
  window.addEventListener('keydown', handleWindowKeyDown);
  // listen for copy errors from Editor
  try { window.addEventListener('editor-copy-error', handleEditorCopyError); } catch (e) {}
});

// no automatic collapse: prefer single-line horizontal scrolling so labels remain visible

// helper for More menu: convert id to readable text
const humanizeActionId = (id) => {
  const map = {
    copy: '复制',
    compare: '对比',
    ai: 'AI',
    table: '表格',
    escape: '转义',
    unescape: '反转义',
    settings: '设置'
  };
  return map[id] || id;
};

// handle clicks coming from the More menu
const handleMoreAction = (id) => {
  showMoreMenu.value = false;
  switch (id) {
    case 'copy': toggleCopyMenu({ currentTarget: copyMenuButtonRef.value, stopPropagation: () => {} }); break;
    case 'compare': handleCompareClick(); break;
    case 'ai': toggleAiPanel(); break;
    case 'table': emit('openTableView'); break;
    case 'escape': escapeJson(); break;
    case 'unescape': unescapeJson(); break;
    case 'settings': store.editorSettings.controlPanelVisible = !store.editorSettings.controlPanelVisible; break;
    default: break;
  }
};

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick);
  window.removeEventListener('resize', handleWindowResize);
  try { window.removeEventListener('scroll', handleWindowScroll, { capture: true, passive: true }); } catch (e) { window.removeEventListener('scroll', handleWindowScroll, true); }
  window.removeEventListener('keydown', handleWindowKeyDown);
  try { if (typeof scrollRaf === 'number' && scrollRaf) { cancelAnimationFrame(scrollRaf); } } catch (e) {}
  try { window.removeEventListener('editor-copy-error', handleEditorCopyError); } catch (e) {}
  if (copyErrorTimer) {
    try { clearTimeout(copyErrorTimer); } catch (e) {}
    copyErrorTimer = null;
  }
});

const executeQuery = () => {
  try {
    queryError.value = '';
    queryResult.value = null;

    if (!queryExpression.value.trim()) {
      queryError.value = '请输入查询表达式';
      return;
    }

    // Pre-validate expression syntax
    const validation = validateQuery(queryExpression.value, queryType.value);
    if (!validation.valid) {
      queryError.value = validation.message;
      const tabKey = queryType.value === 'jsonpath' ? 'jsonpath' : 'jq';
      store.showOutputPanel(tabKey, { value: null, error: queryError.value });
      return;
    }

    let result;
    if (queryType.value === 'jsonpath') {
      result = queryJsonPath(props.content, queryExpression.value);
    } else {
      result = queryJq(props.content, queryExpression.value);
    }

    const tabKey = queryType.value === 'jsonpath' ? 'jsonpath' : 'jq';
    const display = result.display !== undefined ? result.display : result.results;

    if (result.success) {
      queryResult.value = display;
      // Show "empty result" indication when query succeeds but returns 0 matches
      if (result.count === 0) {
        queryError.value = '查询结果为空（0 条匹配）';
        store.showOutputPanel(tabKey, { value: null, error: queryError.value });
      } else {
        store.addQueryHistory(queryExpression.value, queryType.value);
        store.showOutputPanel(tabKey, { value: display, error: null });
      }
    } else {
      queryResult.value = null;
      queryError.value = result.error || '查询失败';
      store.showOutputPanel(tabKey, { value: null, error: queryError.value });
    }
  } catch (e) {
    queryError.value = e.message;
    const tabKey = queryType.value === 'jsonpath' ? 'jsonpath' : 'jq';
    store.showOutputPanel(tabKey, { value: null, error: e.message });
  }
};

const handleKeyDown = (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    executeQuery();
  }
};

const copyToClipboard = async (format) => {
  // if no query result and content is empty-ish, do nothing
  if (!queryResult.value && (props.content === undefined || props.content === null || String(props.content).trim() === '')) return;

  let textToCopy = '';
  let data;
  // try parse JSON, but fall back to raw text on failure
  try {
    data = queryResult.value !== null && queryResult.value !== undefined ? queryResult.value : JSON.parse(props.content);
  } catch (e) {
    // not valid JSON — treat as plain text
    data = queryResult.value !== null && queryResult.value !== undefined ? queryResult.value : props.content;
  }

  try {
    switch (format) {
      case 'singleline':
        try {
          textToCopy = (typeof data === 'string') ? data : JSON.stringify(data);
        } catch (e) {
          textToCopy = String(data);
        }
        break;
      case 'go': {
        const r = jsonToGoStruct(typeof data === 'string' ? data : JSON.stringify(data));
        textToCopy = r.success ? r.data : (typeof data === 'string' ? data : JSON.stringify(data));
        break;
      }
      case 'java': {
        const r = jsonToJavaClass(typeof data === 'string' ? data : JSON.stringify(data));
        textToCopy = r.success ? r.data : (typeof data === 'string' ? data : JSON.stringify(data));
        break;
      }
      case 'python': {
        const r = jsonToPython(typeof data === 'string' ? data : JSON.stringify(data));
        textToCopy = r.success ? r.data : (typeof data === 'string' ? data : JSON.stringify(data));
        break;
      }
      case 'typescript': {
        const r = jsonToTypeScript(typeof data === 'string' ? data : JSON.stringify(data));
        textToCopy = r.success ? r.data : (typeof data === 'string' ? data : JSON.stringify(data));
        break;
      }
      case 'javascript': {
        const r = jsonToJavaScript(typeof data === 'string' ? data : JSON.stringify(data));
        textToCopy = r.success ? r.data : (typeof data === 'string' ? data : JSON.stringify(data));
        break;
      }
      default:
        try {
          textToCopy = (typeof data === 'string') ? data : JSON.stringify(data, null, 2);
        } catch (e) {
          textToCopy = String(data);
        }
    }

    if (window.utools) {
      window.utools.copyText(textToCopy);
    } else {
      await navigator.clipboard.writeText(textToCopy);
    }
    showCopyMenu.value = false;
    notify.success('已复制到剪贴板');
  } catch (e) {
    // surface a clearer message
    notify.error('复制失败: ' + (e && e.message ? e.message : String(e)));
  }
};


const handleCompareClick = () => {
  // 打开对比侧边栏，预填当前编辑器内容到左侧
  emit('compare', props.content, '');
};

async function loadModelsIfNeeded() {
  if (aiModels.value.length > 0 || aiLoadingModels.value) return;
  try {
    store.setAIModelLoading(true);
    store.setAIModelError('');
    const res = await fetchUtoolsModels();
    if (res.success) {
      store.setAIModels(res.data);
      // ensure selected model exists
      if (!store.aiComposer.selectedModel && res.data.length > 0) {
        store.setAISelectedModel(res.data[0].id);
      }
    } else {
      store.setAIModelError(res.error || '模型加载失败');
      // fallback to virtual default
      store.setAIModels([{ id: 'utools-default', label: 'utools-default', description: '默认模型', icon: '', cost: 0 }]);
      store.setAISelectedModel('utools-default');
    }
  } catch (e) {
    store.setAIModelError(e.message || String(e));
    store.setAIModels([{ id: 'utools-default', label: 'utools-default', description: '默认模型', icon: '', cost: 0 }]);
    store.setAISelectedModel('utools-default');
  } finally {
    store.setAIModelLoading(false);
  }
}

function autoResizeAiTextarea() {
  const el = aiTextareaRef.value;
  if (!el) return;
  el.style.height = 'auto';
  const max = 200;
  el.style.height = Math.min(el.scrollHeight, max) + 'px';
}

const handleAiTextareaKeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitAIProcess();
  }
  // Shift+Enter default behavior: insert newline
};

const toggleAiPanel = async () => {
  store.aiComposer.visible = !store.aiComposer.visible;
  if (store.aiComposer.visible) {
    await nextTick();
    loadModelsIfNeeded();
    // resize after open
    nextTick(() => autoResizeAiTextarea());
  }
};

const submitAIProcess = () => {
  const draft = (aiDraft.value || '').trim();
  if (!draft) {
    notify.warn('请输入处理指令');
    return;
  }

  const model = aiSelectedModel.value || store.aiConfig.model || 'utools-default';
  emit('aiProcess', draft, {
    provider: 'utools',
    model
  });

  // 按实施计划：发送成功后清空草稿。这里无法同步获得成功状态，先清空并关闭面板 for UX parity.
  store.setAIDraft('');
  store.aiComposer.visible = false;
};

const escapeJson = () => {
  try {
    const data = queryResult.value || JSON.parse(props.content);
    const escaped = JSON.stringify(JSON.stringify(data));
    emit('escape', escaped);
    showCopyMenu.value = false;
  } catch (e) {
    notify.error('转义失败: ' + e.message);
  }
};

const unescapeJson = () => {
  try {
    const data = queryResult.value || JSON.parse(props.content);
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    const unescaped = JSON.parse(str);
    emit('unescape', JSON.stringify(unescaped, null, 2));
    showCopyMenu.value = false;
  } catch (e) {
    notify.error('反转义失败: ' + e.message);
  }
};

// format button moved to editor context menu; keep help tooltip but remove bottom-bar emit






</script>

<template>
  <div class="status-bar">
    <div class="status-bar-row">
      <!-- 移除 query-type-segment 按钮，改用类型徽章 -->
      <input
        v-model="queryExpression"
        :placeholder="queryType === 'jsonpath' ? '例: $.store.book[0].title' : '例: .store.book[].price'"
        class="query-input"
        @keydown="handleKeyDown"
      />
      
      <!-- 类型徽章：显示检测到的类型，可点击切换 -->
      <button
        class="query-type-badge"
        :class="{ override: typeOverride }"
        @click="toggleQueryType"
        :title="`当前: ${queryType.toUpperCase()}${typeOverride ? ' (已手动切换)' : ' (自动识别)'}`"
      >
        <span class="badge-text">{{ queryType.toUpperCase() }}</span>
        <span class="badge-hint" v-if="!typeOverride">🤖</span>
      </button>

      <button class="query-btn primary" @click="executeQuery">⚙️</button>

      <div class="actions-inline" ref="actionsInlineRef">
        <!-- Format button removed: use editor context menu / Shift+Alt+F -->

        <div class="action-menu">
          <button
            ref="copyMenuButtonRef"
            data-action-id="copy"
            @click="toggleCopyMenu"
            class="action-btn action-btn--icon action-btn--copy"
            title="复制选项"
            aria-label="复制 (copy)"
          >
            <span class="action-btn__icon emoji-badge emoji-badge--copy" aria-hidden="true">📋</span>
            <span class="action-btn__text">复制</span>
          </button>
        </div>

        <!-- Format button: visible and compact so users always have access -->
        <button data-action-id="format" @click="$emit('format')" class="action-btn action-btn--icon action-btn--format" title="格式化" aria-label="格式化">
          <span class="action-btn__icon emoji-badge emoji-badge--format" aria-hidden="true">📐</span>
          <span class="action-btn__text">格式化</span>
        </button>

        <button data-action-id="compare" @click="handleCompareClick" class="action-btn action-btn--icon action-btn--compare" title="对比" aria-label="对比 (compare)">
          <span class="action-btn__icon emoji-badge emoji-badge--compare" aria-hidden="true">⚖️</span>
          <span class="action-btn__text">对比</span>
        </button>

        <button data-action-id="ai" @click="toggleAiPanel" class="action-btn action-btn--icon action-btn--ai" title="AI" aria-label="AI">
          <span class="action-btn__icon emoji-badge emoji-badge--ai" aria-hidden="true">🤖</span>
          <span class="action-btn__text">AI</span>
        </button>

        <button data-action-id="escape" @click="escapeJson" class="action-btn action-btn--icon action-btn--escape" title="转义" aria-label="转义 (escape)">
          <span class="action-btn__icon emoji-badge emoji-badge--escape" aria-hidden="true">🔒</span>
          <span class="action-btn__text">转义</span>
        </button>

        <button data-action-id="unescape" @click="unescapeJson" class="action-btn action-btn--icon action-btn--unescape" title="反转义" aria-label="反转义 (unescape)">
          <span class="action-btn__icon emoji-badge emoji-badge--unescape" aria-hidden="true">🗝️</span>
          <span class="action-btn__text">反转义</span>
        </button>

        <button data-action-id="table" @click="$emit('openTableView')" class="action-btn action-btn--icon action-btn--table" title="表格视图" aria-label="表格视图 (table view)">
          <span class="action-btn__icon emoji-badge emoji-badge--table" aria-hidden="true">📊</span>
          <span class="action-btn__text">表格</span>
        </button>

        <button data-action-id="settings" @click="store.editorSettings.controlPanelVisible = !store.editorSettings.controlPanelVisible" class="action-btn action-btn--icon action-btn--settings" title="设置" aria-label="设置">
          <span class="action-btn__icon emoji-badge emoji-badge--settings" aria-hidden="true">⚙️</span>
          <span class="action-btn__text">设置</span>
        </button>

        <!-- overflow More menu (shown when adjustActions hides labels) -->
        <!-- no automatic collapse: rely on horizontal scrolling to keep all actions visible on one line -->

        <!-- Help tooltip on the right -->
        <div
          class="help-wrapper"
          @mouseenter="showHelpTooltip = true"
          @mouseleave="showHelpTooltip = false"
          ref="helpTooltipRef"
          title="帮助"
        >
          <div class="help-label">帮助</div>
          <div v-if="showHelpTooltip" class="help-tooltip">
            <div class="help-title">支持的功能与快捷键</div>
            <div class="help-item">格式化：Shift + Alt + F</div>
            <div class="help-item">单行复制：Shift + Alt + C（备用：Cmd/Ctrl + Shift + C）</div>
            <div class="help-item">转义字符串复制：Shift + Alt + \（备用：Cmd/Ctrl + Shift + \）</div>
            <div class="help-item">查询执行：Cmd/Ctrl + Enter（在查询输入框中）</div>
            <div class="help-item">格式化开关：在设置中控制自动格式化</div>
            <div class="help-item">关闭当前标签：Cmd/Ctrl + W（在编辑器或标签栏聚焦时）</div>
            <div class="help-item">新建标签：Cmd/Ctrl + N</div>
            <div class="help-item">标签右键菜单：关闭此 / 关闭其他 / 关闭左侧 / 关闭所有 / 收藏（收藏项以 🌟 标记并优先保留）</div>
            <div class="help-item">备注：快捷键在不同平台或输入法下可能有差异，若无响应请尝试切换焦点到编辑器或标签栏。</div>
          </div>
        </div>

        <!-- transient copy error message -->
        <div v-if="copyErrorMessage" class="copy-error">{{ copyErrorMessage }}</div>
      </div>
    </div>
    <div v-if="queryError" class="query-error">{{ queryError }}</div>

    <teleport to="body">
      <div
        v-if="showCopyMenu"
        ref="copyMenuRef"
        class="menu-dropdown"
        :style="copyMenuStyles"
      >
        <button @click="copyToClipboard('singleline')" class="menu-item">📄 单行</button>
        <button @click="copyToClipboard('go')" class="menu-item">🐹 Go 结构体</button>
        <button @click="copyToClipboard('java')" class="menu-item">☕ Java 类</button>
        <button @click="copyToClipboard('python')" class="menu-item">🐍 Python 类</button>
        <button @click="copyToClipboard('typescript')" class="menu-item">🔵 TypeScript 接口</button>
        <button @click="copyToClipboard('javascript')" class="menu-item">⚡ JavaScript 类</button>
      </div>
    </teleport>


    <div v-if="showAiPanel" class="aux-panel">
      <h4>AI 处理</h4>
      <div class="form-row">
        <div style="min-width:200px;">
          <label style="font-size:12px;color:var(--color-text-secondary);margin-bottom:4px;display:block;">模型</label>
          <select v-model="store.aiComposer.selectedModel" class="form-select" :disabled="aiLoadingModels">
            <option v-for="m in aiModels" :key="m.id" :value="m.id">{{ m.label || m.id }}</option>
          </select>
          <div v-if="aiModelLoadError" class="query-error" style="margin-top:6px;">{{ aiModelLoadError }}</div>
        </div>

        <div style="flex:1;">
          <label style="font-size:12px;color:var(--color-text-secondary);margin-bottom:4px;display:block;">说明</label>
          <textarea
            ref="aiTextareaRef"
            v-model="store.aiComposer.draft"
            placeholder="例：删除所有 price 小于 10 的元素"
            class="form-textarea"
            rows="2"
            @input="autoResizeAiTextarea"
            @keydown="handleAiTextareaKeydown"
          ></textarea>
        </div>
      </div>

      <button @click="submitAIProcess" class="panel-btn primary">
        🤖 发送
      </button>
    </div>
  </div>
</template>

<style scoped>
.status-bar {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  padding: 8px 10px;
  background: var(--color-bg-secondary);
  border-top: 1px solid var(--color-divider);
  font-size: var(--font-size-sm);
  max-height: 260px;
  overflow-y: auto;
  /* add right safe padding so floating controls (global toggle) don't cover buttons */
  padding-right: calc(96px + env(safe-area-inset-right));
  position: relative;
  z-index: 120000; /* above many app elements but below global modals */
}

.status-bar-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-bottom: 0;
  /* prefer single-line layout; allow horizontal scroll instead of wrapping so buttons remain visible */
  flex-wrap: nowrap;
  overflow-x: auto;
  overflow-y: hidden;
}

/* 移除旧的 query-type-segment 样式，改用新的徽章 */
.query-type-segment {
  display: none; /* 隐藏旧的类型切换按钮 */
}

.query-type-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-weight: 600;
  font-size: var(--font-size-xs);
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
  flex-shrink: 0;
}

.query-type-badge:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-hover-bg);
}

.query-type-badge.override {
  background: rgba(79, 172, 254, 0.1);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.badge-text {
  font-size: 12px;
  font-weight: 700;
}

.badge-hint {
  font-size: 10px;
  opacity: 0.7;
}

.type-seg-btn {
  flex: 1 1 50%;
  padding: 0 0;
  height: 100%;
  font-weight: 500;
  font-size: var(--font-size-xs);
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  border-radius: 4px;
  cursor: pointer;
  position: relative;
  z-index: 2;
  transition: color .18s;
}
.type-seg-btn.active {
  color: var(--color-primary);
  font-weight: 700;
}
.type-seg-indicator {
  content: '';
  position: absolute;
  bottom: 2px;
  left: 0;
  width: 50%;
  height: 3px;
  background: var(--color-primary);
  border-radius: 1.5px;
  z-index: 1;
  box-shadow: 0 1px 4px 0 var(--color-primary-alpha,rgba(80,186,255,0.19));
  transition: left 0.3s;
}
.actions-inline {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  min-width: 0;
  /* prefer single line; allow horizontal scroll when space is constrained */
  flex: 0 0 auto;
  flex-wrap: nowrap;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  padding-right: 8px; /* give internal breathing room for scroll/clip */
}

  .query-input {
    /* prefer to give the query input space but prevent it from pushing action buttons off-screen */
    flex: 1 1 360px;
    min-width: 120px;
    padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-family: 'Monaco', 'Menlo', monospace;
}

.query-btn {
  padding: 6px 12px;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--font-size-sm);
  white-space: nowrap;
}

.query-error {
  padding: 6px 8px;
  background: rgba(239, 68, 68, 0.1);
  color: var(--color-error);
  border-radius: 4px;
  font-size: var(--font-size-xs);
}

/* 移除旧 action-bar，让 .actions-inline 生效 */


.action-btn {
  padding: 6px;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: var(--font-size-xs);
  transition: background 0.12s, transform 0.12s;
  color: var(--color-text-primary);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  position: relative; /* for tooltip positioning */
}

.action-menu {
  position: relative;
}

.action-btn__icon {
  font-size: 14px;
  line-height: 1;
}

.action-btn__text {
  line-height: 1;
}

/* Tooltip behaviour: hide labels by default, show on hover/focus */
.action-btn__text {
  display: none;
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border);
  padding: 6px 8px;
  border-radius: 6px;
  white-space: nowrap;
  box-shadow: var(--shadow-lg);
  font-size: var(--font-size-xs);
  z-index: 200000;
  color: var(--color-text-primary);
}
.action-btn:hover .action-btn__text,
.action-btn:focus-visible .action-btn__text {
  display: block;
}

  .action-btn.show-text .action-btn__text { display: inline-block; position: static; padding: 0; border: none; box-shadow: none; transform: none; }

/* Show labels inline earlier and make the action area horizontally scroll when needed.
   This keeps the bar compact on narrow screens while making buttons readable on larger screens. */
@media (min-width: 900px) {
  .action-btn__text {
    display: inline-block;
    position: static;
    padding: 0;
    border: none;
    box-shadow: none;
    transform: none;
  }

  .actions-inline {
    /* keep actions on a single row when possible, but allow horizontal scroll if space is constrained */
    flex: 0 0 auto;
    flex-wrap: nowrap;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    gap: 8px;
    min-width: 0;
  }

  /* small, unobtrusive scrollbar styling for webkit browsers */
  .actions-inline::-webkit-scrollbar { height: 8px; }
  .actions-inline::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.08); border-radius: 999px; }
}

/* Large-screen: pin the status bar to the bottom and prefer a single-line actions area.
    This prevents parent overflow from clipping the action buttons on very wide windows. */
@media (min-width: 1400px) {
  .status-bar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    margin: 0;
    padding: 10px 20px 12px calc(12px + env(safe-area-inset-left));
    background: linear-gradient(180deg, var(--color-bg-secondary), rgba(0,0,0,0));
    box-shadow: 0 -6px 18px rgba(0,0,0,0.06);
    max-height: none;
  }

  .status-bar-row {
    flex-wrap: nowrap;
    align-items: center;
    gap: 12px;
    overflow: visible;
  }

  .query-input {
    /* limit input width so actions have dedicated space on the right */
    flex: 1 1 640px;
    max-width: calc(100% - 560px);
    min-width: 220px;
  }

  /* 大屏幕：显示徽章并清晰显示所有按钮文本 */
  .query-type-badge {
    padding: 6px 10px;
    font-size: var(--font-size-xs);
  }

  .actions-inline {
    flex: 0 0 auto;
    gap: 8px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    padding-right: 12px;
    background: transparent;
  }
}

/* 中等屏幕优化 (900px - 1400px) */
@media (min-width: 900px) and (max-width: 1399px) {
  .query-input {
    flex: 1 1 400px;
    max-width: calc(100% - 400px);
    min-width: 150px;
  }

  .query-type-badge {
    padding: 6px 10px;
    font-size: var(--font-size-xs);
  }

  .actions-inline {
    gap: 6px;
  }
}

.panel-btn {
  width: 100%;
  padding: 6px 10px;
  margin-top: 8px;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--font-size-xs);
}

.aux-panel {
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-select,
.form-input,
.form-textarea {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: var(--font-size-xs);
  outline: none;
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
}

.form-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.form-textarea {
  font-family: 'Monaco', 'Menlo', monospace;
  resize: vertical;
}

.menu-dropdown {
  position: fixed;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  box-shadow: var(--shadow-lg);
  z-index: 9999;
  min-width: 150px;
  pointer-events: auto;
}

.menu-item {
  padding: 6px 10px;
  background: transparent;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: var(--font-size-xs);
  color: var(--color-text-primary);
  text-align: left;
  transition: all 0.2s;
}

/* Help tooltip styles */
.help-wrapper {
  margin-left: auto;
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  cursor: default;
  user-select: none;
}
.help-label {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}
.help-tooltip {
  /* 固定定位，确保浮层在编辑器之上并不受父容器 stacking context 限制 */
  position: fixed;
  right: 12px;
  bottom: 64px;
  min-width: 220px;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 8px;
  box-shadow: var(--shadow-lg);
  z-index: 200000;
  font-size: var(--font-size-xs);
}
.help-title {
  font-weight: 600;
  margin-bottom: 6px;
  color: var(--color-text-primary);
}
.help-item {
  margin: 4px 0;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

/* transient copy error */
.copy-error {
  margin-left: 12px;
  padding: 6px 10px;
  background: rgba(255, 59, 48, 0.08);
  color: var(--color-error);
  border-radius: 6px;
  font-size: var(--font-size-xs);
}

/* emoji badge styles for better recognizability */
.emoji-badge {
  display: inline-block;
  padding: 0 6px;
  line-height: 1;
  background: transparent;
  border-radius: 4px;
  font-size: 16px;
}
.emoji-badge--escape { /* left as semantic hook for future theming */ }
.emoji-badge--unescape { }
.emoji-badge--format { }
.emoji-badge--copy { }
.emoji-badge--compare { }
.emoji-badge--ai { }
.emoji-badge--table { }
.emoji-badge--settings { }

/* hover/focus feedback for buttons */
.action-btn:hover,
.action-btn:focus-visible {
  background: var(--color-action-hover, rgba(0,0,0,0.04));
}

@media (max-width: 900px) {
  /* 小屏幕：隐藏按钮文本，让按钮浮动填满右侧 */
  .action-btn__text { display: none; }
  .action-btn.action-btn--escape .action-btn__text,
  .action-btn.action-btn--unescape .action-btn__text {
    display: inline-block;
    font-size: 11px;
    margin-left: 6px;
  }

  /* 小屏幕优化：按钮组动态占满右侧空间 */
  .actions-inline {
    flex: 1 1 auto;
    gap: 4px;
    justify-content: flex-end;
  }

  .query-input {
    flex: 1 1 120px;
    min-width: 80px;
    max-width: 60%;
  }

  /* 缩小徽章尺寸以节省空间 */
  .query-type-badge {
    padding: 5px 8px;
    font-size: 11px;
    min-width: fit-content;
  }

  /* 缩小按钮 padding 以紧凑排列 */
  .action-btn {
    padding: 5px;
    gap: 4px;
  }

  /* 缩小 emoji 尺寸 */
  .action-btn__icon {
    font-size: 13px;
  }
}
</style>
