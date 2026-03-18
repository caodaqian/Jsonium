import { defineStore } from 'pinia';
import { ref, reactive } from 'vue';

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
    endpoint: ''
  });

  // AI composer UI 状态（草稿、模型列表、选中模型、加载态、错误）
  const aiComposer = reactive({
    visible: false,
    draft: '',
    selectedModel: '',
    models: [],
    loadingModels: false,
    modelLoadError: ''
  });

  const setAIDraft = (draft) => { aiComposer.draft = draft; };
  const setAISelectedModel = (modelId) => { aiComposer.selectedModel = modelId; };
  const setAIModels = (models) => {
    aiComposer.models = Array.isArray(models) ? models : [];
    if (!aiComposer.selectedModel && aiComposer.models.length > 0) {
      aiComposer.selectedModel = aiComposer.models[0].id;
    }
  };
  const setAIModelLoading = (loading) => { aiComposer.loadingModels = !!loading; };
  const setAIModelError = (error) => { aiComposer.modelLoadError = error || ''; };
  const resetAIComposer = (keepDraft = true) => {
    aiComposer.visible = false;
    if (!keepDraft) aiComposer.draft = '';
    aiComposer.selectedModel = aiComposer.models[0]?.id || '';
    aiComposer.loadingModels = false;
    aiComposer.modelLoadError = '';
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
  
  const diffSidebar = reactive({
    visible: false,
    mode: 'input', // 'input' | 'result'
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
    theme: 'vs-dark'
  });
  
  const showDiffSidebar = (leftContent = '') => {
    diffSidebar.visible = true;
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
      activeTabId.value = parsed.activeTabId || (tabs.value[0]?.id ?? null);
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
  };
  
  const showOutputPanel = (tab, payload = emptyPanel()) => {
    if (!outputTabs.includes(tab)) {
      return;
    }
    outputPanel.visible = true;
    outputPanel.currentTab = tab;
    outputPanel.content[tab] = payload;
  };
  
  const switchOutputTab = (tab) => {
    outputPanel.currentTab = tab;
    outputPanel.visible = true;
  };
  
  const clearOutput = (tab = null) => {
    if (tab) {
      outputPanel.content[tab] = emptyPanel();
    } else {
      outputPanel.content = createOutputContent();
    }
  };
  
  return {
    // State
    tabs,
    activeTabId,
    queryHistory,
    aiConfig,
    aiComposer,
    editorSettings,
    outputPanel,
    diffSidebar,
    
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
    setAISelectedModel,
    setAIModels,
    setAIModelLoading,
    setAIModelError,
    resetAIComposer,

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
    cleanupOldTabs
  };
});
