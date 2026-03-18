import { reactive } from 'vue';

const state = reactive({
  toasts: []
});

let _uid = 1;
function _push(message, type = 'info', duration = 3000) {
  const id = Date.now() + (_uid++);
  const toast = { id, message, type };
  state.toasts.push(toast);
  if (duration > 0) {
    setTimeout(() => remove(id), duration);
  }
  return id;
}

function remove(id) {
  const idx = state.toasts.findIndex(t => t.id === id);
  if (idx !== -1) state.toasts.splice(idx, 1);
}

const notify = {
  toasts: state.toasts,
  push(message, options = {}) {
    const { type = 'info', duration = 3000 } = options;
    return _push(message, type, duration);
  },
  success(message, options = {}) {
    return _push(message, 'success', options.duration ?? 3000);
  },
  info(message, options = {}) {
    return _push(message, 'info', options.duration ?? 3000);
  },
  error(message, options = {}) {
    return _push(message, 'error', options.duration ?? 5000);
  },
  warn(message, options = {}) {
    return _push(message, 'warn', options.duration ?? 4000);
  },
  remove
};

export default notify;