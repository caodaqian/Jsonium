const fs = require('node:fs')
const path = require('node:path')

// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
  // 读文件
  readFile (file) {
    return fs.readFileSync(file, { encoding: 'utf-8' })
  },
  // 文本写入到下载目录
  writeTextFile (text) {
    const filePath = path.join(window.utools.getPath('downloads'), Date.now().toString() + '.txt')
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },
  // 图片写入到下载目录
  writeImageFile (base64Url) {
    const matchs = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url)
    if (!matchs) return
    const filePath = path.join(window.utools.getPath('downloads'), Date.now().toString() + '.' + matchs[1])
    fs.writeFileSync(filePath, base64Url.substring(matchs[0].length), { encoding: 'base64' })
    return filePath
  },

  // 尝试通过宿主 API 将窗口调整到至少指定宽度（容错，多重探测）
  async trySetMinWindowWidth (minWidth) {
    try {
      if (typeof minWidth !== 'number' || !isFinite(minWidth) || minWidth <= 0) return false;
      // 探测常见的 utools 窗口 API 名称并尝试调用
      if (typeof window !== 'undefined' && window.utools) {
        const height = window.outerHeight || window.innerHeight || 800;
        const candidates = [
          'setWindowSize',
          'resizeWindow',
          'setSize',
          'setPluginWindowSize',
          'setMainWindowSize'
        ];
        for (let i = 0; i < candidates.length; i++) {
          const name = candidates[i];
          try {
            const fn = window.utools[name];
            if (typeof fn === 'function') {
              // 尝试以 (width, height) 签名调用；若 API 需要不同参数则忽略异常继续尝试
              try {
                fn(minWidth, height);
                return true;
              } catch (e) {
                // 某些 API 可能是异步或返回 Promise
                try {
                  const res = fn(minWidth, height);
                  if (res && typeof res.then === 'function') {
                    await res;
                    return true;
                  }
                } catch (_) {
                  // ignore and continue probing
                }
              }
            }
          } catch (e) {
            // ignore and continue
          }
        }
      }
      return false;
    } catch (e) {
      return false;
    }
  },

  // 持久化：记录/读取上次窗口尺寸（优先 utools.dbStorage，回退 localStorage）
  setLastWindowSize (size) {
    try {
      const key = 'json_window_size_v1';
      const payload = JSON.stringify(size || {});
      if (typeof window !== 'undefined' && window.utools && window.utools.dbStorage && typeof window.utools.dbStorage.setItem === 'function') {
        window.utools.dbStorage.setItem(key, payload);
      } else if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, payload);
      }
      return true;
    } catch (e) {
      return false;
    }
  },

  getLastWindowSize () {
    try {
      const key = 'json_window_size_v1';
      let raw = null;
      if (typeof window !== 'undefined' && window.utools && window.utools.dbStorage && typeof window.utools.dbStorage.getItem === 'function') {
        raw = window.utools.dbStorage.getItem(key);
      } else if (typeof localStorage !== 'undefined') {
        raw = localStorage.getItem(key);
      }
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    } catch (e) {
      return null;
    }
  }
}
