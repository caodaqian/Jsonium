# 设计文档：utools 窗口最小宽度、编辑器自动换行与侧边栏悬浮隐藏箭头
日期：2026-03-20  
作者：自动生成（待人工确认）

## 概要
为了解决插件每次打开窗口过小导致长 JSON 行展示不友好的问题，并增加编辑器自动换行配置与侧边栏的悬浮隐藏箭头交互，提出以下设计与实现计划。目标是在 uTools 环境下尽量通过宿主窗口 API 放大窗口（最小宽度 1200px），并在应用内提供回退和用户设置。

## 目标
- 插件打开时尽量保证窗口最小宽度 1200px（用户可手动调整）。
- Editor 默认按容器宽度自动换行，用户可在设置中关闭或调整阈值。
- Diff 侧边栏增加一个悬浮隐藏/展开箭头，支持收起为窄条并可再次展开。
- 所有改动应具备回退策略（宿主不支持窗口 API 时回退到 CSS 内部最小宽度）。

## 非目标
- 不在此改动里实现复杂的窗口拖拽或多显示器策略。
- 不自动提交任何变更到 git（由用户手动提交）。

---

## 高层决策（已确认）
1. 窗口策略：采用“尝试调用宿主窗口 API 设置最小宽度 1200px；失败时回退到内部 min-width CSS；并保存用户上次窗口尺寸以便下次恢复”（推荐 A + C）。
2. 自动换行：默认启用，按编辑器容器宽度触发（使用 ResizeObserver），允许用户关闭或调整列阈值（推荐方案 1）。
3. 侧边栏交互：在侧边栏右边缘外侧放置一个悬浮箭头按钮；收起时侧边栏保留窄条（例如 36px）显示箭头；展开恢复完整侧栏（推荐 α）。

---

## 详细实现方案

### 1) preload/services.js（API 层）
- 增加 window.services 窗口相关封装（非破坏性、容错）：
  - trySetMinWindowWidth(width): Promise<boolean>
    - 目的：尝试通过宿主（window.utools）暴露的窗口 API 请求调整窗口最小宽度/当前尺寸到 width；成功返回 true，失败或异常返回 false。
    - 实现细节：安全调用 window.utools 的相关方法（若存在），并捕获异常。若宿主没有暴露对应方法，直接返回 false。
  - getLastWindowSize() / setLastWindowSize({width,height})
    - 目的：读取/保存上次窗口尺寸（供恢复使用），可以先在 renderer 端的 store 同步，也可通过 preload 持久化到本地（可选）。
- 注意：文档中不指定具体 uTools API 名称以避免硬编码；实现时在 preload 里做特性探测（if (window.utools && typeof window.utools.someWindowApi === 'function') ...）。

调用时序：
- 插件打开入口（App.vue 或 main.js）：调用 window.services.trySetMinWindowWidth(1200)。若返回 true 或成功，记录为已调整并保存尺寸；若失败，应用内以 CSS min-width 回退。

### 2) store/index.js（状态与持久化）
- 新建或扩展 editorSettings（默认值示例）：
  - wrapEnabled: true
  - wrapByWidth: true
  - wrapColumn: 120  // 可用于 fallback 或 UI 显示
  - wrapThresholdPx: 900  //（可选）当容器宽度小于此值时触发换行判定
  - minWindowWidth: 1200
  - lastWindowSize: { width: null, height: null }
  - preserveWhitespaceOnCopy: (已存在)
- 扩展 diffSidebar:
  - collapsed: false (新增)
- 持久化：
  - 使用 localStorage（或已存在的持久化逻辑）保存 editorSettings 与 diffSidebar.collapsed、lastWindowSize。提供 getter/setter。

### 3) Editor.vue（编辑器行为）
- 增加 ResizeObserver（或窗口 resize 事件）监听 editorContainer 宽度变化：
  - 当 store.editorSettings.wrapEnabled && store.editorSettings.wrapByWidth 为真时：
    - 计算容器宽度（px），使用字体/平均字符宽度估算适合的 wordWrapColumn（或直接使用 monaco 的 wordWrap: 'on'/'off'）：
      - 简单实现：当容器宽度小于 wrapThresholdPx（或小于某列对应像素）时启用 wordWrap 'on'，否则 'off'。
      - 更精确实现：根据 fontSize 与平均字符宽度估算 column = Math.floor(width / avgCharPx) 并设置 monaco option wordWrap: 'bounded' + wordWrapColumn。
  - 调用 monaco.editor.updateOptions({ wordWrap: 'on'/'off', wordWrapColumn: n })。
- 新增设置读取（使用 store.getEditorSettings()），并在初始化与 resize 回调中应用。
- 注意兼容性：monaco 的 option 键名与已有代码一致（使用 automaticLayout 保持尺寸同步）。
- 提供 UI hook（ControlPanel 或设置面板）以控制 wrapEnabled、wrapThreshold/column。

### 4) DiffSidebar.vue（侧栏折叠与悬浮按钮）
- 在组件外层保持现有的 aside.diff-sidebar 结构，增加：
  - 计算属性 collapsed 绑定到 store.diffSidebar.collapsed。
  - 在 template 中添加悬浮按钮（fixed/absolute）在侧边栏左侧或右侧外沿，样式如下：
    - 当 collapsed === false：显示向右的小箭头按钮（用于收起）
    - 当 collapsed === true：保留窄条（width: 36px），显示向左箭头（用于展开）
  - 点击切换 store.diffSidebar.collapsed。
- CSS：
  - 新增 .diff-sidebar.collapsed 样式：width: 36px; overflow: visible; 仅显示 header 的最小区域或隐藏主内容。
  - 添加平滑过渡（transition: width 180ms ease, transform 180ms）。
- 无障碍与焦点：
  - 悬浮按钮应可通过键盘聚焦，添加 aria-label。

### 5) 启动流程（App.vue / main.js）
- 在应用入口（App.vue mounted 或 main.js）处：
  - 读取 store.editorSettings.minWindowWidth（默认 1200）。
  - 调用 window.services.trySetMinWindowWidth(minWindowWidth)；若成功并返回尺寸信息，执行 store.setLastWindowSize(...).
  - 如果失败，确保根容器或 body 有 CSS min-width: 1200px 的回退（见下）。

### 6) CSS 回退（全局）
- index.html 或 main.css 中加入根级回退：`.app-root { min-width: 1200px; }`（使用更保守的选择器或仅在 uTools 环境生效）。
- 仅在宿主 API 不支持时生效；但也可一直生效以保证一致性（在窄屏显示下表现为横向滚动）。

---

## 容错与兼容性
- 所有对 window.utools 的调用必须捕获异常并返回失败标志，避免阻断渲染流程。
- 若 monaco 未就绪或在测试环境（非浏览器）中，Editor.vue 保持原有退化行为（已在代码中处理）。
- 对于无法精确设置宿主窗口大小的场景，依赖应用内 CSS 回退并在 UI 中给出提示（可选）。

---

## 测试要点
- 启动时尝试设置窗口到 minWidth=1200：在支持 API 的环境中确认窗口实际变化；在不支持环境确认无报错且应用内 min-width 生效。
- 编辑器在不同宽度下自动切换 wrap（resize 编辑器容器并观察 monaco 行为）。
- 用户设置关闭 wrap 后编辑器不再自动换行。
- Diff 侧边栏悬浮箭头：点击收起与展开，状态保存到 store 并持久化；收起时仅显示窄条与箭头，展开后恢复。
- 回退路径：当 window.services.trySetMinWindowWidth 返回 false，页面仍可通过水平滚动查看长行 JSON。

---

## 变更清单（待实现的文件）
- public/preload/services.js — 新增窗口相关封装（trySetMinWindowWidth 等）
- src/store/index.js — 增加 editorSettings 字段与 diffSidebar.collapsed、持久化逻辑
- src/components/Editor.vue — 增加 ResizeObserver、monaco.updateOptions 的换行逻辑，读取 store 设置
- src/components/DiffSidebar.vue — 增加 collapsed 状态与悬浮箭头 DOM/CSS/逻辑
- src/main.js 或 src/App.vue — 启动时调用 window.services.trySetMinWindowWidth 并保存尺寸
- src/main.css — 全局回退 min-width 样式（必要时）

---

## 实施步骤（建议顺序）
1. 在 store 中添加设置与持久化接口（避免后续实现重复改动）。
2. 在 preload 增加 trySetMinWindowWidth 等封装（容错实现）。
3. 在 App.vue/main.js 启动阶段调用 trySetMinWindowWidth（并在失败时不报错）。
4. 修改 Editor.vue：增加 ResizeObserver、根据宽度调整 monaco wordWrap。
5. 修改 DiffSidebar.vue：实现 collapsed 与悬浮箭头交互与样式。
6. 增加设置界面（ControlPanel 或设置页）以允许用户开关自动换行与调整阈值（可在后续 PR）。
7. 手动测试各场景并由你确认后提交代码。

---

## 后续备注
- 设计中保留了灵活的实现空间以应对 uTools 版本差异（窗体 API 名称/行为可能不同）。在实现阶段会在 preload 内做功能探测并逐步调整调用实现细节。
- 如需我直接开始修改代码，请切换到 Act mode（你已切换过一次）。目前我将按你要求先创建此文档（已完成），后续修改将在你确认后开始。