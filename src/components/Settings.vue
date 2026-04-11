<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

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
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.26);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 400000;
}
.settings-panel {
  min-width: 340px;
  background: var(--color-bg-secondary, #fff);
  border-radius: 12px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.18);
  border: 1px solid var(--color-divider, #eee);
  display: flex;
  flex-direction: column;
}
.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px 8px 18px;
  font-weight: 600;
  font-size: 18px;
  color: var(--color-text-primary, #333);
}
.close-btn {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: var(--color-text-tertiary, #aaa);
}
.settings-body {
  padding: 8px 24px 18px 24px;
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
input[type="radio"] {
  accent-color: var(--color-primary, #42b883);
  width: 1.15em;
  height: 1.15em;
}
</style>