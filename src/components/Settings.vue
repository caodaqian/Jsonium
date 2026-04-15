<script setup>
  import { useJsonStore } from '@/store/index.js';
  import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const emit = defineEmits(['themeChange', 'close']);
const props = defineProps({
  visible: { type: Boolean, default: false }, // 父组件控制显示
  currentTheme: { type: String, default: 'catppuccin' }, // 'catppuccin' | 'vue'
  currentMode: { type: String, default: 'auto' }, // 'auto' | 'light' | 'dark'
});

// 支持的风格主题和模式
const themes = [
  { value: 'catppuccin', label: 'Catppuccin（卡布奇诺）' },
  { value: 'vue', label: 'Vue 官方风格' }
];
const modes = [
  { value: 'auto', label: '跟随系统' },
  { value: 'light', label: '亮色 Light' },
  { value: 'dark', label: '暗色 Dark' }
];

// 当前选择
const themeValue = ref(props.currentTheme);
const modeValue = ref(props.currentMode);

  const store = useJsonStore();
  const stickyEnabled = computed({
    get: () => !!(store.editorSettings && store.editorSettings.stickyEnabled),
    set: (v) => {
      try {
        store.updateEditorSettings({ stickyEnabled: !!v });
        store.saveSettingsState();
      } catch (e) { }
    }
  });

  const useTab = computed({
    get: () => !!(store.editorSettings && store.editorSettings.useTab),
    set: (v) => {
      try {
        store.updateEditorSettings({ useTab: !!v });
        store.saveSettingsState();
      } catch (e) { }
    }
  });

  const tabSize = computed({
    get: () => (store.editorSettings && typeof store.editorSettings.tabSize === 'number') ? store.editorSettings.tabSize : 2,
    set: (v) => {
      try {
        const n = Number(v) || 2;
        store.updateEditorSettings({ tabSize: n });
        store.saveSettingsState();
      } catch (e) { }
    }
  });

watch(themeValue, (val) => {
  emit('themeChange', { theme: val, mode: modeValue.value });
});
watch(modeValue, (val) => {
  emit('themeChange', { theme: themeValue.value, mode: val });
});

// 支持 ESC 快捷关闭
const handleClose = () => emit('close');
const onKeydown = (e) => {
  if (e.key === 'Escape') handleClose();
};
onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  try { window.removeEventListener('keydown', onKeydown); } catch (e) { }
});
</script>

<template>
  <div class="settings-overlay" v-if="visible">
    <div class="settings-panel" role="dialog" aria-modal="true">
      <div class="settings-header">
        <span>设置</span>
        <button class="close-btn" @click="handleClose" title="关闭">×</button>
      </div>
      <div class="settings-body">
        <div class="section">
          <div class="section-title">编辑器</div>
          <label class="checkbox-label">
            <input type="checkbox" v-model="stickyEnabled" />
            <span>启用粘性节点（Sticky）</span>
            <span class="info-icon" role="img" tabindex="0" title="启用后会在编辑器中显示折叠区域的粘性节点，便于定位长 JSON 的结构。">i</span>
          </label>
        </div>
        <div class="section">
          <div class="section-title">主题风格</div>
          <div class="radio-group">
            <label v-for="opt in themes" :key="opt.value" class="radio-label">
              <input type="radio" name="themeStyle" :value="opt.value" v-model="themeValue" />
              <span>{{ opt.label }}</span>
            </label>
          </div>
        </div>
        <div class="section">
          <div class="section-title">配色模式</div>
          <div class="radio-group">
            <label v-for="opt in modes" :key="opt.value" class="radio-label">
              <input type="radio" name="themeMode" :value="opt.value" v-model="modeValue" />
              <span>{{ opt.label }}</span>
            </label>
          </div>
        </div>
        <div class="section">
          <div class="section-title">编辑器</div>
          <label class="checkbox-label">
            <input type="checkbox" v-model="stickyEnabled" />
            <span>启用粘性节点（Sticky）</span>
          </label>
          <div style="margin-top:10px;display:flex;flex-direction:column;gap:8px;">
            <label class="checkbox-label">
              <input type="checkbox" v-model="useTab" />
              <span>使用 Tab 缩进（启用后编辑器使用实际 Tab，格式化使用软 Tab 显示）</span>
            </label>
            <label style="display:flex;align-items:center;gap:8px;">
              <span>缩进宽度：</span>
              <input type="number" min="1" style="width:80px" v-model.number="tabSize" />
              <span class="info-icon" title="当使用空格缩进时，这个值表示每级缩进的空格数；当使用 tab 时，这个值表示 softtab 的可视宽度">i</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-overlay {
  position: fixed;
  inset: 0;
    background: rgba(0, 0, 0, 0.14);

 
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 400000;
}
.settings-panel {
  min-width: 340px;
    background: var(--color-bg-primary, #fff);
    border-radius: 4px;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.18);

 
  border: 1px solid var(--color-divider, #eee);
  display: flex;
  flex-direction: column;
}
.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
    padding: 14px 16px 10px 16px;
 
  font-weight: 600;
    font-size: 15px;
 
  color: var(--color-text-primary, #333);
    border-bottom: 1px solid var(--color-divider, #e5e5e5);
 
}
.close-btn {
  background: none;
  border: none;
    font-size: 18px;
 
  cursor: pointer;
  color: var(--color-text-tertiary, #aaa);
}
.settings-body {
    padding: 12px 18px 18px 18px;
 
}
.section {
  margin-bottom: 18px;
}
.section-title {
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 10px;
  color: var(--color-text-secondary, #666);
}
.radio-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.radio-label {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 15px;
  padding: 2px 0;
}

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
    color: var(--color-text-primary, #333);
  }



 
input[type="radio"] {
  accent-color: var(--color-primary, #42b883);
  width: 1.15em;
  height: 1.15em;
}

  input[type="checkbox"] {
    width: 1.15em;
    height: 1.15em;
    accent-color: var(--color-primary, #42b883);
  }

  .info-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--color-bg-secondary, #f3f4f6);
    color: var(--color-text-secondary, #666);
    font-size: 12px;
    line-height: 1;
    cursor: help;
    border: 1px solid var(--color-divider, #e5e5e5);
  }

  .info-icon:focus {
    outline: 2px solid var(--color-primary, #42b883);
  }
</style>