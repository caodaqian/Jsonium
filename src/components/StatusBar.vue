<script setup>
import { computed, reactive, ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { queryJsonPath, queryJq, validateQuery } from '../services/queryEngine.js';
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
  'format',
  'escape',
  'unescape',
  'compare',
  'aiProcess'
]);

const queryExpression = ref('');
const queryType = ref('jsonpath');
const queryResult = ref(null);
const queryError = ref('');
const showCopyMenu = ref(false);
const copyMenuButtonRef = ref(null);
const copyMenuRef = ref(null);
const copyMenuPosition = ref({ top: 0, left: 0, height: 0 });


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
  if (showCopyMenu.value) positionCopyMenu();
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

onMounted(() => {
  document.addEventListener('click', handleDocumentClick);
  window.addEventListener('resize', handleWindowResize);
  // use capture to catch scrolls on any scrollable ancestor
  window.addEventListener('scroll', handleWindowScroll, true);
  window.addEventListener('keydown', handleWindowKeyDown);
  // listen for copy errors from Editor
  try { window.addEventListener('editor-copy-error', handleEditorCopyError); } catch (e) {}
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick);
  window.removeEventListener('resize', handleWindowResize);
  window.removeEventListener('scroll', handleWindowScroll, true);
  window.removeEventListener('keydown', handleWindowKeyDown);
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

const formatJson = () => {
  // 委托给 Editor 的统一格式化入口，由上层组件处理（emit 触发）
  emit('format');
  showCopyMenu.value = false;
};






</script>

<template>
  <div class="status-bar">
    <div class="status-bar-row">
      <!-- 选项卡（带滑动）、输入、执行、所有底部按钮一行化 -->
      <div class="query-type-segment">
        <button
          v-for="type in ['jsonpath', 'jq']"
          :key="type"
          :class="['type-seg-btn', { active: queryType === type }]"
          @click="queryType = type"
        >
          {{ type.toUpperCase() }}
        </button>
        <span class="type-seg-indicator" :style="{left: queryType==='jsonpath'?'0%':'50%'}"/>
      </div>
      <input
        v-model="queryExpression"
        :placeholder="queryType === 'jsonpath' ? '例: $.store.book[0].title' : '例: .store.book[].price'"
        class="query-input"
        @keydown="handleKeyDown"
      />
      <button class="query-btn primary" @click="executeQuery">⚙️</button>

      <div class="actions-inline">
        <button @click="formatJson" class="action-btn" title="格式化">
          📐 格式化
        </button>
        <div class="action-menu">
          <button
            ref="copyMenuButtonRef"
            @click="toggleCopyMenu"
            class="action-btn"
            title="复制选项"
          >
            📋 复制
          </button>
        </div>
        <button @click="handleCompareClick" class="action-btn" title="对比">
          ⚖️ 对比
        </button>
        <button @click="toggleAiPanel" class="action-btn" title="AI">
          🤖 AI
        </button>
        <button @click="escapeJson" class="action-btn" title="转义">
          🔒 转义
        </button>
        <button @click="unescapeJson" class="action-btn" title="反转义">
          🔓 反转义
        </button>
        <button @click="store.editorSettings.controlPanelVisible = !store.editorSettings.controlPanelVisible" class="action-btn" title="设置">
          ⚙️ 设置
        </button>
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
  gap: var(--spacing-md);
  padding: var(--spacing-md);
  background: var(--color-bg-secondary);
  border-top: 1px solid var(--color-divider);
  font-size: var(--font-size-sm);
  max-height: 320px;
  overflow-y: auto;
}

.status-bar-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--spacing-sm);
  width: 100%;
  margin-bottom: 0;
  flex-wrap: wrap;
}
.query-type-segment {
  display: flex;
  position: relative;
  width: 94px;
  height: 30px;
  margin-right: 8px;
  background: var(--color-bg-primary);
  border-radius: 4px;
  border: 1px solid var(--color-border);
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
  gap: 8px;
  margin-left: auto;
}

.query-input {
  flex: 1;
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
  padding: 6px 12px;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--font-size-xs);
  transition: all 0.2s;
  white-space: nowrap;
}

.action-menu {
  position: relative;
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
</style>