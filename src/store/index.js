import { defineStore } from 'pinia';
import { reactive, ref } from 'vue';

export const useJsonStore = defineStore('json', () => {
  // 状态
  const tabs = ref([{
    id: Date.now(),
    name: 'Untitled',
    content: '{}',
    format: 'json',
    isModified: false,
    favorited: false,
    createdAt: new Date(),
    lastAccessed: new Date()
  }]);
  const activeTabId = ref(tabs.value[0].id);
  const queryHistory = ref([]);
  const aiConfig = ref({
    provider: 'utools',
    apiKey: '',
    model: 'gpt-3.5-turbo',
    endpoint: '',
    baseUrl: '',
    systemPrompt: '你是名为 Jsoniun 的 JSON 助手，负责处理用户对于 json 数据的处理、比对、分析等任务。包括 jq/jsonpath 做相关的数据提取、转换，同时也需要在用户分析数据异动时，提供数据的差异分析、重点数据描述、以及对应的数据洞察',
    temperature: '',
    headersJson: '',
    // 自动解析重试：默认开启一次重试
    parseRetry: true,
    parseRetryMax: 1
  });

  // AI composer UI 状态（草稿、模型列表、选中模型、加载态、错误）
  const aiComposer = reactive({
    visible: false,
    draft: '',
    messages: [],
    sending: false,
    error: '',
    selectedModel: '',
    models: [],
    loadingModels: false,
    modelLoadError: '',
    openaiModels: [],
    openaiModelLoading: false,
    openaiModelError: ''
  });

  const setAIDraft = (draft) => { aiComposer.draft = draft; };
  const addAIMessage = (message) => {
    if (!message || typeof message !== 'object') return;
    aiComposer.messages.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      role: message.role || 'assistant',
      content: message.content || '',
      meta: message.meta || null,
      createdAt: message.createdAt || new Date().toISOString()
    });
  };
  const clearAIMessages = () => { aiComposer.messages = []; };
  const setAISending = (sending) => { aiComposer.sending = !!sending; };
  const setAIError = (error) => { aiComposer.error = error || ''; };
  const setAISelectedModel = (modelId) => { aiComposer.selectedModel = modelId; };
  const setAIModels = (models) => {
    aiComposer.models = Array.isArray(models) ? models : [];
    if (!aiComposer.selectedModel && aiComposer.models.length > 0) {
      aiComposer.selectedModel = aiComposer.models[0].id;
    }
  };
  const setAIModelLoading = (loading) => { aiComposer.loadingModels = !!loading; };
  const setAIModelError = (error) => { aiComposer.modelLoadError = error || ''; };
  const setOpenAIModels = (models) => {
    aiComposer.openaiModels = Array.isArray(models) ? models : [];
  };
  const setOpenAIModelLoading = (loading) => { aiComposer.openaiModelLoading = !!loading; };
  const setOpenAIModelError = (error) => { aiComposer.openaiModelError = error || ''; };
  const resetAIComposer = (keepDraft = true) => {
    aiComposer.visible = false;
    if (!keepDraft) aiComposer.draft = '';
    aiComposer.sending = false;
    aiComposer.error = '';
    aiComposer.selectedModel = aiComposer.models[0]?.id || '';
    aiComposer.loadingModels = false;
    aiComposer.modelLoadError = '';
    aiComposer.openaiModelLoading = false;
    aiComposer.openaiModelError = '';
  };

  const showAITab = () => {
    diffSidebar.visible = true;
    diffSidebar.collapsed = false;
    diffSidebar.mode = 'ai';
    aiComposer.visible = true;
  };

  const hideAITab = () => {
    if (diffSidebar.mode === 'ai') {
      diffSidebar.visible = false;
      diffSidebar.collapsed = false;
      diffSidebar.mode = 'input';
    }
    aiComposer.visible = false;
  };

  // OutputPanel 状态
  const outputTabs = ['jsonpath', 'jq', 'diff'];

  const emptyPanel = () => ({
    value: null,
    error: null
  });

  const createOutputContent = () => {
    const content = {};
    outputTabs.forEach((tab) => {
      content[tab] = emptyPanel();
    });
    return content;
  };

  const outputPanel = reactive({
    visible: false,
    currentTab: 'jsonpath',
    content: createOutputContent(),
    history: []
  });

  // ========= 表格视图状态 begin =========
  const tableView = reactive({
    visible: false,
    arrayPath: null,   // null 表示根数组
    columns: [],
    pageSize: 50
  });

  const showTableView = (arrayPath = null) => {
    tableView.visible = true;
    tableView.arrayPath = arrayPath;
  };
  const hideTableView = () => {
    tableView.visible = false;
  };
  const updateTableColumns = (columns) => {
    tableView.columns = columns;
  };
  // ========= 表格视图状态 end =========

  const diffSidebar = reactive({
    visible: false,
    collapsed: false,
    mode: 'input', // 'input' | 'result' | 'output' | 'ai'
    // 停靠偏好：'auto' | 'panel' | 'sidebar'
    dockMode: 'auto',
    leftInput: '',
    leftContent: '',
    rightContent: '',
    diffLines: [],
    // 新增树形结果与统计、筛选
    diffTree: null,
    diffStats: { added: 0, removed: 0, changed: 0, unchanged: 0 },
    diffFilter: 'all', // all | changed | added | removed | modified
    error: ''
  });

  // ========= 主题系统 begin =========
  const themePreference = ref({
    theme: 'catppuccin', // 'catppuccin' | 'vue'
    mode: 'auto',        // 'auto' | 'light' | 'dark'
  });

  // 获取主题偏好（持久化/默认）
  const getThemePreference = () => ({ ...themePreference.value });

  // 计算当前应生效的主题，根据偏好/utools/系统
  const getEffectiveTheme = () => {
    // 1. 用户自定义优先
    let theme = themePreference.value.theme || 'catppuccin';
    let mode = themePreference.value.mode || 'auto';
    // 2. 自动判断明暗
    if (mode === 'auto') {
      // 检测 utools/系统
      try {
        if (typeof window !== 'undefined') {
          // 优先 utools
          if (window.isDarkColors && typeof window.isDarkColors === 'function') {
            mode = window.isDarkColors() ? 'dark' : 'light';
          } else if (window.utools && window.utools.isDarkColors) {
            // 某些版本在 utools 下定义
            mode = window.utools.isDarkColors() ? 'dark' : 'light';
          } else if (window.matchMedia) {
            const m = window.matchMedia('(prefers-color-scheme: dark)');
            mode = m && m.matches ? 'dark' : 'light';
          }
        }
      } catch(_) {}
    }
    return { theme, mode };
  };

  // 设置主题偏好
  const setThemePreference = (theme, mode) => {
    themePreference.value = { theme, mode };
    try { saveSettingsState(); } catch (_) { /* ignore */ }
  };
  // ========= 主题系统 end =========

  const editorSettings = reactive({
    autoFormat: true,
    // 兼容旧配置：保留 debounceMs 但引入更语义化的 idleDelayMs
    debounceMs: 300,
    // 是否在空闲时自动格式化
    autoFormatOnIdle: true,
    // 是否在粘贴时自动格式化
    autoFormatOnPaste: true,
    // 是否允许回车触发即时格式化（默认禁用以改善输入体验）
    autoFormatOnEnter: false,
    // 回车保护窗（ms），在此期间会延后自动格式化以避免光标漂移
    enterGuardMs: 400,
    // 空闲触发延迟（ms），更保守的默认值
    idleDelayMs: 800,
    minimap: true,
    folding: true,
    lineNumbers: true,
    wordWrap: 'off',
    fontSize: 14,
    fontFamily: '',
    theme: 'vs-dark',
    // 新增：基于宽度的自动换行控制（默认开启）
    wrapEnabled: true,
    wrapByWidth: true,
    wrapColumn: 120,
    wrapThresholdPx: 900,
    // 控制面板是否显示（UI 控制，默认隐藏）
    controlPanelVisible: false,
    // diff 显示首选位置：'auto'|'panel'|'sidebar'
    diffDock: 'auto',
    // 最小窗口宽度与上次窗口尺寸记录
    minWindowWidth: 1200,
    lastWindowSize: { width: null, height: null },
    // 新增：复制到剪贴板时是否保留原始空白（默认保留以兼容旧行为）
    preserveWhitespaceOnCopy: true,
    // 新增：格式检测模式，'lenient' | 'strict'
    formatDetectorMode: 'lenient'
    ,
    // 新增：是否启用编辑器的粘性节点（sticky）功能
    stickyEnabled: true
    ,
    // 新增：编辑缩进配置
    useTab: true,
    tabSize: 4
  });

  const showDiffSidebar = (leftContent = '') => {
    diffSidebar.visible = true;
    diffSidebar.collapsed = false;
    diffSidebar.mode = 'input';
    diffSidebar.leftInput = leftContent;
    diffSidebar.leftContent = '';
    diffSidebar.rightContent = '';
    diffSidebar.diffLines = [];
    diffSidebar.diffTree = null;
    diffSidebar.diffStats = { added: 0, removed: 0, changed: 0, unchanged: 0 };
    diffSidebar.diffFilter = 'all';
    diffSidebar.error = '';
  };

  // 在首选位置展示对比结果（向后兼容的入口）
  const showDiff = (leftContent = '', rightContent = '', payload = {}) => {
    // 先写入结果数据
    setDiffResult(leftContent, rightContent, payload || {});
    // 决定显示位置：优先使用 editorSettings.diffDock，其次使用 diffSidebar.dockMode
    diffSidebar.visible = true;
    diffSidebar.collapsed = false;
    diffSidebar.mode = 'result';
  };

  const setDiffResult = (leftContent, rightContent, payload = {}) => {
    diffSidebar.mode = 'result';
    diffSidebar.leftContent = leftContent;
    diffSidebar.rightContent = rightContent;
    // 支持行级与树级结果兼容
    diffSidebar.diffLines = payload.diffLines || [];
    diffSidebar.diffTree = payload.diffTree || null;
    diffSidebar.diffStats = payload.diffStats || diffSidebar.diffStats;
    diffSidebar.error = '';
  };

  const hideDiffSidebar = () => {
    diffSidebar.visible = false;
    if (diffSidebar.mode === 'output') {
      outputPanel.visible = false;
    }
    // 可选：清理临时数据
    diffSidebar.leftInput = '';
    diffSidebar.leftContent = '';
    diffSidebar.rightContent = '';
    diffSidebar.diffLines = [];
    diffSidebar.diffTree = null;
    diffSidebar.error = '';
  };

  const setDiffLines = (lines) => {
    diffSidebar.diffLines = lines;
  };

  const setDiffError = (error) => {
    diffSidebar.error = error;
  };
  // Tab 管理
  const addTab = (content = '', name = '', format = 'json') => {
    const id = Date.now();
    // 如果没有指定名称，使用当前日期时间作为默认标题（YYYY-MM-DD HH:mm:ss）
    let defaultName = name;
    if (!name) {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      defaultName = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    const now = new Date();
    const tab = {
      id,
      name: defaultName,
      content,
      format,
      isModified: false,
      favorited: false,
      createdAt: now,
      lastAccessed: now
    };
    tabs.value.push(tab);
    activeTabId.value = id;
    return id;
  };

  const closeTab = (tabId) => {
    const index = tabs.value.findIndex(t => t.id === tabId);
    if (index > -1) {
      tabs.value.splice(index, 1);

      if (activeTabId.value === tabId) {
        activeTabId.value = tabs.value.length > 0 ? tabs.value[tabs.value.length - 1].id : null;
      }
    }
  };

  const updateTabContent = (tabId, content) => {
    const tab = tabs.value.find(t => t.id === tabId);
    if (tab) {
      tab.content = content;
      tab.isModified = true;
    }
  };

  const updateTabName = (tabId, name) => {
    const tab = tabs.value.find(t => t.id === tabId);
    if (tab) {
      tab.name = name;
    }
  };

  const getActiveTab = () => {
    return tabs.value.find(t => t.id === activeTabId.value);
  };

  // 设置激活 tab（同时记录 lastAccessed）
  const setActiveTab = (tabId) => {
    const tab = tabs.value.find(t => t.id === tabId);
    if (tab) {
      tab.lastAccessed = new Date();
      activeTabId.value = tabId;
    } else {
      activeTabId.value = tabId;
    }
  };

  const toggleFavorite = (tabId) => {
    const tab = tabs.value.find(t => t.id === tabId);
    if (!tab) return;
    tab.favorited = !tab.favorited;
    // 如果变为收藏且存在，确保它的 lastAccessed 不为空
    if (tab.favorited && !tab.lastAccessed) tab.lastAccessed = new Date();
  };

  const closeAllTabs = ({ keepFavorited = true } = {}) => {
    if (keepFavorited) {
      tabs.value = tabs.value.filter(t => t.favorited);
    } else {
      tabs.value = [];
    }
    activeTabId.value = tabs.value.length > 0 ? tabs.value[tabs.value.length - 1].id : null;
  };

  const closeOtherTabs = (tabId, { keepFavorited = true } = {}) => {
    const keepSet = new Set();
    if (keepFavorited) {
      tabs.value.forEach(t => { if (t.favorited) keepSet.add(t.id); });
    }
    keepSet.add(tabId);
    tabs.value = tabs.value.filter(t => keepSet.has(t.id));
    activeTabId.value = tabs.value.length > 0 ? tabs.value[0].id : null;
  };

  const closeLeftTabs = (tabId, { keepFavorited = true } = {}) => {
    const idx = tabs.value.findIndex(t => t.id === tabId);
    if (idx <= 0) return;
    const survivors = [];
    for (let i = 0; i < tabs.value.length; i++) {
      const t = tabs.value[i];
      if (i < idx) {
        if (keepFavorited && t.favorited) survivors.push(t);
      } else {
        survivors.push(t);
      }
    }
    tabs.value = survivors;
    activeTabId.value = tabs.value.length > 0 ? tabs.value[0].id : null;
  };

  const cleanupOldTabs = (ageDays = 1) => {
    const now = Date.now();
    const threshold = now - (ageDays * 24 * 60 * 60 * 1000);
    const survivors = tabs.value.filter(t => {
      if (t.favorited) return true;
      const last = t.lastAccessed ? new Date(t.lastAccessed).getTime() : (t.createdAt ? new Date(t.createdAt).getTime() : now);
      return last >= threshold;
    });
    tabs.value = survivors;
    activeTabId.value = tabs.value.length > 0 ? tabs.value[0].id : null;
  };

  // 持久化：保存/加载 tabs 状态（优先 utools.dbStorage，回退 localStorage）
  const STORAGE_KEY = 'json_tabs_v1';
  const serializeTab = (t) => ({
    id: t.id,
    name: t.name,
    content: t.content,
    format: t.format,
    isModified: !!t.isModified,
    favorited: !!t.favorited,
    createdAt: (t.createdAt instanceof Date) ? t.createdAt.toISOString() : (t.createdAt || null),
    lastAccessed: (t.lastAccessed instanceof Date) ? t.lastAccessed.toISOString() : (t.lastAccessed || null)
  });

  const saveTabsState = () => {
    try {
      const data = tabs.value.map(serializeTab);
      const payload = JSON.stringify({
        tabs: data,
        activeTabId: activeTabId.value,
        savedAt: new Date().toISOString()
      });
      if (typeof window !== 'undefined' && window.utools && window.utools.dbStorage && typeof window.utools.dbStorage.setItem === 'function') {
        window.utools.dbStorage.setItem(STORAGE_KEY, payload);
      } else if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, payload);
      }
    } catch (e) {
      // ignore
    }
  };

  const loadTabsState = async () => {
    try {
      let raw = null;
      if (typeof window !== 'undefined' && window.utools && window.utools.dbStorage && typeof window.utools.dbStorage.getItem === 'function') {
        raw = window.utools.dbStorage.getItem(STORAGE_KEY);
      } else if (typeof localStorage !== 'undefined') {
        raw = localStorage.getItem(STORAGE_KEY);
      }
      if (!raw) return false;
      let parsed;
      try { parsed = JSON.parse(raw); } catch { return false; }
      if (!parsed || !Array.isArray(parsed.tabs)) return false;
      tabs.value = parsed.tabs.map(t => ({
        id: t.id,
        name: t.name,
        content: t.content,
        format: t.format,
        isModified: !!t.isModified,
        favorited: !!t.favorited,
        createdAt: t.createdAt ? new Date(t.createdAt) : null,
        lastAccessed: t.lastAccessed ? new Date(t.lastAccessed) : (t.createdAt ? new Date(t.createdAt) : null)
      }));
      // 优先通过 setActiveTab 恢复以确保 lastAccessed 等一致性；回退到直接赋值
      if (parsed.activeTabId) {
        try { setActiveTab(parsed.activeTabId); } catch (_) { activeTabId.value = parsed.activeTabId; }
      } else {
        activeTabId.value = tabs.value.length > 0 ? tabs.value[0].id : null;
      }
      return true;
    } catch (e) {
      return false;
    }
  };

  const SETTINGS_KEY = 'json_settings_v2';
  const LEGACY_SETTINGS_KEY = 'json_settings_v1';
  const LEGACY_THEME_KEY = 'json_theme_pref_v1';
  const saveSettingsState = () => {
    try {
      const payload = JSON.stringify({
        themePreference: { ...themePreference.value },
        aiConfig: { ...aiConfig.value },
        editorSettings: { ...editorSettings },
        diffSidebarCollapsed: !!diffSidebar.collapsed,
        lastWindowSize: editorSettings.lastWindowSize || null,
        savedAt: new Date().toISOString(),
        version: 2
      });
      if (typeof window !== 'undefined' && window.utools && window.utools.dbStorage && typeof window.utools.dbStorage.setItem === 'function') {
        window.utools.dbStorage.setItem(SETTINGS_KEY, payload);
      } else if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SETTINGS_KEY, payload);
      }
    } catch (e) {
      // ignore
    }
  };

  const loadSettingsState = () => {
    try {
      let raw = null;
      let legacyThemeRaw = null;
      if (typeof window !== 'undefined' && window.utools && window.utools.dbStorage && typeof window.utools.dbStorage.getItem === 'function') {
        raw = window.utools.dbStorage.getItem(SETTINGS_KEY);
        if (!raw) raw = window.utools.dbStorage.getItem(LEGACY_SETTINGS_KEY);
        if (!raw) legacyThemeRaw = window.utools.dbStorage.getItem(LEGACY_THEME_KEY);
      } else if (typeof localStorage !== 'undefined') {
        raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) raw = localStorage.getItem(LEGACY_SETTINGS_KEY);
        if (!raw) legacyThemeRaw = localStorage.getItem(LEGACY_THEME_KEY);
      }
      if (!raw && legacyThemeRaw) {
        let legacyTheme = null;
        try { legacyTheme = JSON.parse(legacyThemeRaw); } catch (_) { legacyTheme = null; }
        if (legacyTheme && typeof legacyTheme === 'object') {
          themePreference.value = {
            theme: legacyTheme.theme ?? themePreference.value.theme,
            mode: legacyTheme.mode ?? themePreference.value.mode
          };
          try { saveSettingsState(); } catch (_) { /* ignore */ }
          return true;
        }
      }
      if (!raw) return false;
      let parsed;
      try { parsed = JSON.parse(raw); } catch { return false; }
      if (parsed && parsed.themePreference && typeof parsed.themePreference === 'object') {
        const nextTheme = {
          theme: parsed.themePreference.theme ?? themePreference.value.theme,
          mode: parsed.themePreference.mode ?? themePreference.value.mode
        };
        themePreference.value = nextTheme;
      }
      if (parsed && parsed.aiConfig && typeof parsed.aiConfig === 'object') {
        setAIConfig(parsed.aiConfig);
      }
      if (parsed && parsed.editorSettings) {
        try { updateEditorSettings(parsed.editorSettings); } catch (_) { /* ignore */ }
      }
      if (parsed && typeof parsed.diffSidebarCollapsed !== 'undefined') {
        diffSidebar.collapsed = !!parsed.diffSidebarCollapsed;
      }
      if (parsed && parsed.lastWindowSize) {
        editorSettings.lastWindowSize = parsed.lastWindowSize;
      }
      // 将旧版本配置升级为新键，减少后续分支处理成本
      try { saveSettingsState(); } catch (_) { /* ignore */ }
      return true;
    } catch (e) {
      return false;
    }
  };

  // 查询历史
  const addQueryHistory = (query, type) => {
    queryHistory.value.unshift({
      query,
      type,
      timestamp: new Date(),
      id: Date.now()
    });

    // 限制历史记录数量
    if (queryHistory.value.length > 50) {
      queryHistory.value.pop();
    }
  };

  const clearQueryHistory = () => {
    queryHistory.value = [];
  };

  // AI 配置
  const setAIConfig = (config) => {
    Object.assign(aiConfig.value, config);
  };

  const getAIConfig = () => {
    return { ...aiConfig.value };
  };

  // 编辑器设置
  const updateEditorSettings = (settings) => {
    Object.assign(editorSettings, settings);
  };

  const getEditorSettings = () => {
    return { ...editorSettings };
  };

  // OutputPanel 操作

  const hideOutputPanel = () => {
    outputPanel.visible = false;
    if (diffSidebar.mode === 'output') {
      diffSidebar.visible = false;
      diffSidebar.collapsed = false;
      diffSidebar.mode = 'input';
    }
  };

  const showOutputPanel = (tab, payload = emptyPanel()) => {
    if (!outputTabs.includes(tab)) {
      return;
    }
    // 针对 diff tab：将结果写入统一的 diff state 并根据偏好展示
    if (tab === 'diff') {
      // payload 可选地承载 left/right/diffPayload
      const left = payload && payload.left ? payload.left : (diffSidebar.leftContent || diffSidebar.leftInput || '');
      const right = payload && payload.right ? payload.right : (diffSidebar.rightContent || (getActiveTab() ? getActiveTab().content : '') || '');
      const diffPayload = payload && payload.diffPayload ? payload.diffPayload : (payload && payload.value && typeof payload.value === 'object' ? payload.value : {});
      setDiffResult(left, right, diffPayload || {});
      outputPanel.visible = true;
      outputPanel.currentTab = 'diff';
      diffSidebar.visible = true;
      diffSidebar.collapsed = false;
      diffSidebar.mode = 'output';
      return;
    }

    outputPanel.visible = true;
    outputPanel.currentTab = tab;
    outputPanel.content[tab] = payload;
    diffSidebar.visible = true;
    diffSidebar.collapsed = false;
    diffSidebar.mode = 'output';
  };

  const switchOutputTab = (tab) => {
    if (!outputTabs.includes(tab)) {
      return;
    }
    outputPanel.currentTab = tab;
    outputPanel.visible = true;
    diffSidebar.visible = true;
    diffSidebar.collapsed = false;
    diffSidebar.mode = 'output';
  };

  const clearOutput = (tab = null) => {
    if (tab) {
      outputPanel.content[tab] = emptyPanel();
    } else {
      outputPanel.content = createOutputContent();
    }
  };

      return {
        // ========= 主题系统 =========
        themePreference,
        getThemePreference,
        setThemePreference,
        getEffectiveTheme,
    // State
    tabs,
    activeTabId,
    queryHistory,
    aiConfig,
    aiComposer,
    editorSettings,
    outputPanel,
    diffSidebar,
    tableView,

    // Tab 管理
    addTab,
    closeTab,
    updateTabContent,
    updateTabName,
    getActiveTab,
    // 持久化
    saveTabsState,
    loadTabsState,

    // 查询历史
    addQueryHistory,
    clearQueryHistory,

    // AI 配置
    setAIConfig,
    getAIConfig,

    // AI Composer
    setAIDraft,
        addAIMessage,
        clearAIMessages,
        setAISending,
        setAIError,
    setAISelectedModel,
    setAIModels,
    setAIModelLoading,
    setAIModelError,
        setOpenAIModels,
        setOpenAIModelLoading,
        setOpenAIModelError,
    resetAIComposer,
        showAITab,
        hideAITab,

    // 编辑器设置
    updateEditorSettings,
    getEditorSettings,

    // OutputPanel 操作
    showOutputPanel,
    hideOutputPanel,
    switchOutputTab,
    clearOutput,

    // DiffSidebar 操作
    showDiffSidebar,
        showDiff,
    hideDiffSidebar,
    setDiffLines,
    setDiffResult,
    setDiffError,

    // Tab extras
    setActiveTab,
    toggleFavorite,
    closeAllTabs,
    closeOtherTabs,
    closeLeftTabs,
    cleanupOldTabs,

    // Settings persistence
    saveSettingsState,
    loadSettingsState,

    // TableView 操作
    showTableView,
    hideTableView,
    updateTableColumns
  };
});
