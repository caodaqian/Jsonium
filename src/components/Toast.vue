<script setup>
import { computed } from 'vue';
import notify from '../services/notify.js';

const toasts = computed(() => notify.toasts);
function remove(id) {
  notify.remove(id);
}
</script>

<template>
  <div class="toast-container" aria-live="polite" aria-atomic="true">
    <div v-for="t in toasts" :key="t.id" :class="['toast', 'toast-' + t.type]" @click="remove(t.id)">
      <div class="toast-message">{{ t.message }}</div>
    </div>
  </div>
</template>

<style scoped>
.toast-container {
  position: fixed;
  right: 16px;
  top: 16px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.toast {
  min-width: 200px;
  max-width: 420px;
  padding: 10px 14px;
  border-radius: 8px;
  color: var(--color-text-primary);
  background: rgba(0,0,0,0.75);
  backdrop-filter: blur(6px);
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(0,0,0,0.2);
  transition: transform 0.12s ease, opacity 0.12s ease;
}
.toast-message {
  font-size: 13px;
  line-height: 1.2;
  word-break: break-word;
}
.toast-success { background: #1e7e34; color: #fff; }
.toast-error { background: #b02a37; color: #fff; }
.toast-info { background: #0d6efd; color: #fff; }
.toast-warn { background: #f0ad4e; color: #000; }
</style>