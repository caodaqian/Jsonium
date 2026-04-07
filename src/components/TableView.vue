<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import {
  extractTableFromJson,
  applyEditsToJson,
  filterAndSortRows,
  exportTableToCsv,
  exportTableToXlsx
} from '../services/tableView.js';
import notify from '../services/notify.js';

// =============================================
// Props & Emits
// =============================================
const props = defineProps({
  jsonContent: { type: String, default: '{}' },
  arrayPath: { type: String, default: null }
});

const emit = defineEmits(['apply', 'close']);

// =============================================
// 状态
// =============================================
const loading = ref(false);
const error = ref('');

// 原始数据
const allRows = ref([]);
const columns = ref([]);  // TableColumn[]
const totalRows = ref(0);

// 编辑记录
const edits = ref({}); // key = `${rowIndex}::${columnPath}` → newValue

// 搜索 & 过滤 & 排序
const globalSearch = ref('');
const columnFilters = ref({});
const sortColumn = ref(null);
const sortDir = ref('asc');

// 分页
const pageSize = ref(50);
const currentPage = ref(1);

// 列配置面板开关
const showColumnPanel = ref(false);

// 路径输入（arrayPath 输入框）
const arrayPathInput = ref(props.arrayPath || '');

// =============================================
// 初始化：解析 JSON
// =============================================
function loadTable() {
  loading.value = true;
  error.value = '';
  edits.value = {};
  globalSearch.value = '';
  columnFilters.value = {};
  sortColumn.value = null;
  sortDir.value = 'asc';
  currentPage.value = 1;

  try {
    const result = extractTableFromJson(props.jsonContent, {
      arrayPath: arrayPathInput.value || null
    });
    if (!result.success) {
      error.value = result.error || '解析失败';
      allRows.value = [];
      columns.value = [];
      totalRows.value = 0;
    } else {
      allRows.value = result.rows;
      columns.value = result.columns;
      totalRows.value = result.totalRows;
    }
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

// 初始加载
loadTable();

// =============================================
// 过滤 + 排序后的行
// =============================================
const filteredRows = computed(() => {
  const rows = allRows.value.map(row => {
    // 将本地编辑叠加到行数据上（用于展示）
    const patched = { ...row };
    for (const [key, val] of Object.entries(edits.value)) {
      const [ri, cp] = key.split('::');
      if (Number(ri) === row._rowIndex) {
        patched[cp] = val;
      }
    }
    return patched;
  });

  return filterAndSortRows(rows, {
    globalSearch: globalSearch.value,
    columnFilters: columnFilters.value,
    sortColumn: sortColumn.value,
    sortDir: sortDir.value
  });
});

// 当前页行数
const pagedRows = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filteredRows.value.slice(start, start + pageSize.value);
});

const totalPages = computed(() => Math.max(1, Math.ceil(filteredRows.value.length / pageSize.value)));

// 可见列
const visibleColumns = computed(() => columns.value.filter(c => c.visible));

// =============================================
// 单元格编辑
// =============================================
const editingCell = ref(null); // { rowIndex, columnPath }
const editingValue = ref('');

function startEdit(row, col) {
  if (!col.editable) return;
  editingCell.value = { rowIndex: row._rowIndex, columnPath: col.path };
  const editKey = `${row._rowIndex}::${col.path}`;
  editingValue.value = editKey in edits.value
    ? String(edits.value[editKey] ?? '')
    : String(getCellValue(row, col) ?? '');
}

function commitEdit() {
  if (!editingCell.value) return;
  const { rowIndex, columnPath } = editingCell.value;
  const col = columns.value.find(c => c.path === columnPath);
  let parsed = editingValue.value;
  // 类型转换
  if (col) {
    if (col.type === 'number') {
      const n = Number(editingValue.value);
      parsed = isNaN(n) ? editingValue.value : n;
    } else if (col.type === 'boolean') {
      parsed = editingValue.value === 'true' || editingValue.value === '1';
    }
  }
  edits.value[`${rowIndex}::${columnPath}`] = parsed;
  editingCell.value = null;
  editingValue.value = '';
}

function cancelEdit() {
  editingCell.value = null;
  editingValue.value = '';
}

function handleCellKeydown(e) {
  if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
  if (e.key === 'Escape') cancelEdit();
}

function getCellValue(row, col) {
  const editKey = `${row._rowIndex}::${col.path}`;
  if (editKey in edits.value) return edits.value[editKey];
  // 对于嵌套路径直接从原始行中取（行对象是 flat 的）
  const val = row[col.path];
  if (val !== undefined) return val;
  // 回退到点路径
  const parts = col.path.split('.');
  let cur = row;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

function formatCellDisplay(row, col) {
  const val = getCellValue(row, col);
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

// =============================================
// 排序
// =============================================
function toggleSort(colPath) {
  if (sortColumn.value === colPath) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortColumn.value = colPath;
    sortDir.value = 'asc';
  }
  currentPage.value = 1;
}

function getSortIcon(colPath) {
  if (sortColumn.value !== colPath) return '↕';
  return sortDir.value === 'asc' ? '↑' : '↓';
}

// =============================================
// 列筛选
// =============================================
function updateColumnFilter(path, val) {
  columnFilters.value = { ...columnFilters.value, [path]: val };
  currentPage.value = 1;
}

// =============================================
// 应用修改
// =============================================
function handleApply() {
  const editList = Object.entries(edits.value).map(([key, newValue]) => {
    const [rowIndex, columnPath] = key.split('::');
    const row = allRows.value.find(r => r._rowIndex === Number(rowIndex));
    const oldValue = row ? row[columnPath] : undefined;
    return { rowIndex: Number(rowIndex), columnPath, oldValue, newValue };
  });

  if (editList.length === 0) {
    notify.warn('没有待应用的修改');
    return;
  }

  const result = applyEditsToJson(props.jsonContent, {
    arrayPath: arrayPathInput.value || null,
    edits: editList
  });

  if (!result.success) {
    notify.error('应用失败: ' + result.error);
    return;
  }

  notify.success(`已应用 ${editList.length} 处修改`);
  emit('apply', result.jsonString);
  edits.value = {};
}

// =============================================
// 重置
// =============================================
function handleReset() {
  edits.value = {};
  globalSearch.value = '';
  columnFilters.value = {};
  sortColumn.value = null;
  sortDir.value = 'asc';
  currentPage.value = 1;
}

// =============================================
// 导出
// =============================================
function handleExportCsv() {
  exportTableToCsv(visibleColumns.value, filteredRows.value);
}

async function handleExportXlsx() {
  await exportTableToXlsx(visibleColumns.value, filteredRows.value);
}

// =============================================
// 分页
// =============================================
function goToPage(p) {
  currentPage.value = Math.max(1, Math.min(p, totalPages.value));
}

// =============================================
// 列显示切换 & 重命名
// =============================================
function toggleColumnVisible(col) {
  col.visible = !col.visible;
}

function handleLabelInput(col, e) {
  col.label = e.target.value;
}

// =============================================
// 列拖拽排序
// =============================================
const dragSrcIndex = ref(-1);

function handleDragStart(index, e) {
  dragSrcIndex.value = index;
  e.dataTransfer.effectAllowed = 'move';
  // 用透明图片替换默认拖拽预览，避免整行出现在光标旁
  const img = new Image();
  img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  e.dataTransfer.setDragImage(img, 0, 0);
}

function handleDragOver(index, e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const src = dragSrcIndex.value;
  if (src === -1 || src === index) return;
  // 实时重排：把 src 位置的列移到 index 位置
  const cols = columns.value.slice();
  const [moved] = cols.splice(src, 1);
  cols.splice(index, 0, moved);
  columns.value = cols;
  dragSrcIndex.value = index;
}

function handleDragEnd() {
  dragSrcIndex.value = -1;
}

// =============================================
// ESC 关闭
// =============================================
function handleKeydown(e) {
  if (e.key === 'Escape') emit('close');
}
</script>

<template>
  <div class="tv-overlay" @keydown="handleKeydown" tabindex="-1">
    <div class="tv-panel">
      <!-- 顶部工具栏 -->
      <div class="tv-toolbar">
        <div class="tv-toolbar-left">
          <button class="tv-btn tv-btn-icon" @click="emit('close')" title="关闭">✕</button>
          <span class="tv-title">📊 表格视图</span>
          <span class="tv-count" v-if="!error">
            共 {{ totalRows }} 条 · 过滤后 {{ filteredRows.length }} 条
            <span v-if="Object.keys(edits).length > 0" class="tv-edit-badge">
              {{ Object.keys(edits).length }} 处修改
            </span>
          </span>
        </div>

        <!-- 路径输入 -->
        <div class="tv-path-row">
          <label class="tv-path-label">数组路径</label>
          <input
            v-model="arrayPathInput"
            class="tv-path-input"
            placeholder="留空=根数组，支持: items / $.store.books / .items"
            @keydown.enter="loadTable"
          />
          <button class="tv-btn tv-btn-sm" @click="loadTable">加载</button>
        </div>

        <div class="tv-toolbar-right">
          <!-- 全局搜索 -->
          <input
            v-model="globalSearch"
            class="tv-search"
            placeholder="🔍 全局搜索..."
            @input="currentPage = 1"
          />

          <button class="tv-btn tv-btn-sm" @click="showColumnPanel = !showColumnPanel" title="列设置">
            ⚙️ 列
          </button>
          <button class="tv-btn tv-btn-sm" @click="handleReset" title="重置过滤/排序">
            🔄 重置
          </button>
          <button class="tv-btn tv-btn-sm" @click="handleExportCsv" title="导出 CSV">
            📥 CSV
          </button>
          <button class="tv-btn tv-btn-sm" @click="handleExportXlsx" title="导出 XLSX">
            📥 XLSX
          </button>
          <button
            class="tv-btn tv-btn-primary"
            :disabled="Object.keys(edits).length === 0"
            @click="handleApply"
            title="将修改写回 JSON"
          >
            ✅ 应用修改
          </button>
        </div>
      </div>

      <!-- 列配置面板 -->
      <div v-if="showColumnPanel" class="tv-col-panel">
        <div class="tv-col-panel-header">列设置（拖动可调整顺序）</div>
        <div class="tv-col-list">
          <div
            v-for="(col, colIdx) in columns"
            :key="col.id"
            class="tv-col-item"
            :class="{ 'tv-col-item-dragging': dragSrcIndex === colIdx }"
            draggable="true"
            @dragstart="handleDragStart(colIdx, $event)"
            @dragover="handleDragOver(colIdx, $event)"
            @dragend="handleDragEnd"
          >
            <span class="tv-col-drag-handle" title="拖动调整顺序">⠿</span>
            <input
              type="checkbox"
              :checked="col.visible"
              @change="toggleColumnVisible(col)"
            />
            <input
              class="tv-col-label-input"
              :value="col.label"
              @input="handleLabelInput(col, $event)"
              :title="`路径: ${col.path} | 类型: ${col.type}`"
            />
            <span class="tv-col-type">{{ col.type }}</span>
          </div>
        </div>
      </div>

      <!-- 错误提示 -->
      <div v-if="error" class="tv-error">
        <span>⚠️ {{ error }}</span>
        <div class="tv-error-hint">
          若 JSON 根节点不是数组，请在上方输入目标数组的点路径后点击"加载"。
        </div>
      </div>

      <!-- 加载中 -->
      <div v-else-if="loading" class="tv-loading">正在解析...</div>

      <!-- 空数据 -->
      <div v-else-if="allRows.length === 0" class="tv-empty">数组为空，无数据可展示</div>

      <!-- 表格主体 -->
      <div v-else class="tv-table-wrap">
        <table class="tv-table">
          <thead>
            <!-- 列标题行 -->
            <tr class="tv-thead-row">
              <th class="tv-th tv-th-seq">#</th>
              <th
                v-for="col in visibleColumns"
                :key="col.id"
                class="tv-th"
                @click="toggleSort(col.path)"
                :title="col.path"
              >
                <span class="tv-th-label">{{ col.label }}</span>
                <span class="tv-sort-icon">{{ getSortIcon(col.path) }}</span>
              </th>
            </tr>
            <!-- 列过滤行 -->
            <tr class="tv-filter-row">
              <th class="tv-th tv-th-seq"></th>
              <th v-for="col in visibleColumns" :key="'f' + col.id" class="tv-th tv-th-filter">
                <input
                  class="tv-filter-input"
                  :value="columnFilters[col.path] || ''"
                  :placeholder="'过滤 ' + col.label"
                  @input="updateColumnFilter(col.path, $event.target.value)"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, idx) in pagedRows"
              :key="row._rowIndex"
              class="tv-row"
              :class="{ 'tv-row-edited': Object.keys(edits).some(k => k.startsWith(row._rowIndex + '::')) }"
            >
              <!-- 序号 -->
              <td class="tv-td tv-td-seq">{{ (currentPage - 1) * pageSize + idx + 1 }}</td>
              <!-- 数据单元格 -->
              <td
                v-for="col in visibleColumns"
                :key="col.id"
                class="tv-td"
                :class="{
                  'tv-td-editable': col.editable,
                  'tv-td-editing': editingCell?.rowIndex === row._rowIndex && editingCell?.columnPath === col.path,
                  'tv-td-modified': (`${row._rowIndex}::${col.path}`) in edits
                }"
                @dblclick="startEdit(row, col)"
                :title="col.editable ? '双击编辑' : ''"
              >
                <!-- 编辑状态 -->
                <template v-if="editingCell?.rowIndex === row._rowIndex && editingCell?.columnPath === col.path">
                  <input
                    v-if="col.type === 'boolean'"
                    class="tv-cell-input"
                    :value="editingValue"
                    @input="editingValue = $event.target.value"
                    @keydown="handleCellKeydown"
                    @blur="commitEdit"
                    placeholder="true / false"
                    autofocus
                  />
                  <input
                    v-else
                    class="tv-cell-input"
                    v-model="editingValue"
                    @keydown="handleCellKeydown"
                    @blur="commitEdit"
                    autofocus
                  />
                </template>
                <!-- 展示状态 -->
                <template v-else>
                  <span
                    class="tv-cell-text"
                    :class="{
                      'tv-cell-null': getCellValue(row, col) == null,
                      'tv-cell-bool': col.type === 'boolean',
                      'tv-cell-num': col.type === 'number',
                      'tv-cell-obj': col.type === 'object' || col.type === 'array'
                    }"
                  >{{ formatCellDisplay(row, col) }}</span>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 底部分页栏 -->
      <div class="tv-pagination" v-if="!error && !loading && allRows.length > 0">
        <div class="tv-page-info">
          第 {{ currentPage }} / {{ totalPages }} 页，每页
          <select v-model.number="pageSize" class="tv-page-size-sel" @change="currentPage = 1">
            <option :value="20">20</option>
            <option :value="50">50</option>
            <option :value="100">100</option>
            <option :value="200">200</option>
          </select>
          条
        </div>
        <div class="tv-page-btns">
          <button class="tv-btn tv-btn-sm" :disabled="currentPage <= 1" @click="goToPage(1)">«</button>
          <button class="tv-btn tv-btn-sm" :disabled="currentPage <= 1" @click="goToPage(currentPage - 1)">‹</button>
          <span class="tv-page-num">{{ currentPage }}</span>
          <button class="tv-btn tv-btn-sm" :disabled="currentPage >= totalPages" @click="goToPage(currentPage + 1)">›</button>
          <button class="tv-btn tv-btn-sm" :disabled="currentPage >= totalPages" @click="goToPage(totalPages)">»</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ---- 遮罩层 ---- */
.tv-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: stretch;
  justify-content: center;
  z-index: 400000;
  padding: 16px;
  outline: none;
}

/* ---- 面板 ---- */
.tv-panel {
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 1400px;
  overflow: hidden;
  box-shadow: 0 16px 56px rgba(0, 0, 0, 0.5);
}

/* ---- 工具栏 ---- */
.tv-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--color-divider);
  flex-shrink: 0;
}

.tv-toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.tv-toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-wrap: wrap;
}

.tv-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.tv-count {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.tv-edit-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  background: rgba(251, 191, 36, 0.2);
  color: #d97706;
  border-radius: 10px;
  font-size: 11px;
}

.tv-path-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tv-path-label {
  font-size: 11px;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.tv-path-input {
  width: 200px;
  padding: 4px 8px;
  font-size: 12px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
}

.tv-search {
  width: 180px;
  padding: 4px 8px;
  font-size: 12px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
}

/* ---- 按钮 ---- */
.tv-btn {
  padding: 5px 10px;
  font-size: 12px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}
.tv-btn:hover { background: var(--color-bg-secondary); }
.tv-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.tv-btn-icon {
  padding: 4px 8px;
  font-size: 13px;
  line-height: 1;
}
.tv-btn-sm {
  padding: 4px 8px;
}
.tv-btn-primary {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
}
.tv-btn-primary:hover { opacity: 0.9; }

/* ---- 列配置面板 ---- */
.tv-col-panel {
  padding: 10px 14px;
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--color-divider);
  flex-shrink: 0;
}
.tv-col-panel-header {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin-bottom: 8px;
}
.tv-col-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tv-col-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 12px;
  cursor: grab;
  transition: opacity 0.15s, box-shadow 0.15s;
}
.tv-col-item:active { cursor: grabbing; }
.tv-col-item-dragging {
  opacity: 0.4;
  box-shadow: 0 0 0 2px var(--color-primary, #50baff);
}
.tv-col-drag-handle {
  font-size: 14px;
  color: var(--color-text-secondary);
  cursor: grab;
  user-select: none;
  line-height: 1;
}
.tv-col-label-input {
  border: none;
  background: transparent;
  font-size: 12px;
  color: var(--color-text-primary);
  outline: none;
  width: 100px;
}
.tv-col-type {
  font-size: 10px;
  color: var(--color-text-secondary);
  background: var(--color-bg-secondary);
  padding: 1px 4px;
  border-radius: 3px;
}

/* ---- 错误 / 加载 / 空 ---- */
.tv-error {
  padding: 20px;
  color: var(--color-error);
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tv-error-hint {
  font-size: 12px;
  color: var(--color-text-secondary);
}
.tv-loading, .tv-empty {
  padding: 40px;
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 14px;
}

/* ---- 表格容器 ---- */
.tv-table-wrap {
  flex: 1;
  overflow: auto;
  min-height: 0;
}

/* ---- 表格 ---- */
.tv-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  table-layout: auto;
}

.tv-th {
  position: sticky;
  top: 0;
  padding: 7px 10px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-divider);
  font-weight: 600;
  font-size: 11px;
  color: var(--color-text-secondary);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  z-index: 2;
}
.tv-th:hover { background: var(--color-bg-primary); color: var(--color-text-primary); }
.tv-th-seq {
  width: 40px;
  text-align: center;
  cursor: default;
}
.tv-th-filter {
  padding: 4px 6px;
  cursor: default;
  top: 33px; /* 第二行 sticky */
}
.tv-th-label { margin-right: 4px; }
.tv-sort-icon { font-size: 10px; color: var(--color-text-secondary); }

.tv-filter-input {
  width: 100%;
  padding: 3px 6px;
  font-size: 11px;
  border: 1px solid var(--color-border);
  border-radius: 3px;
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  outline: none;
}

.tv-row { transition: background 0.1s; }
.tv-row:hover { background: var(--color-bg-secondary); }
.tv-row-edited { background: rgba(251, 191, 36, 0.07); }

.tv-td {
  padding: 6px 10px;
  border: 1px solid var(--color-divider);
  color: var(--color-text-primary);
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}
.tv-td-seq {
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 11px;
  width: 40px;
}
.tv-td-editable { cursor: text; }
.tv-td-editable:hover { background: rgba(var(--color-primary-rgb, 80,186,255), 0.06); }
.tv-td-editing { padding: 2px 4px; }
.tv-td-modified { background: rgba(251, 191, 36, 0.15) !important; }

/* ---- 单元格输入 ---- */
.tv-cell-input {
  width: 100%;
  padding: 3px 6px;
  font-size: 12px;
  border: 1px solid var(--color-primary);
  border-radius: 3px;
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  outline: none;
}

/* ---- 单元格文本样式 ---- */
.tv-cell-null { color: var(--color-text-secondary); font-style: italic; }
.tv-cell-bool { color: #8b5cf6; }
.tv-cell-num { color: #0891b2; font-family: 'Monaco', 'Menlo', monospace; }
.tv-cell-obj { color: var(--color-text-secondary); font-size: 11px; }

/* ---- 分页 ---- */
.tv-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: var(--color-bg-secondary);
  border-top: 1px solid var(--color-divider);
  font-size: 12px;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}
.tv-page-info {
  display: flex;
  align-items: center;
  gap: 6px;
}
.tv-page-size-sel {
  padding: 2px 6px;
  font-size: 12px;
  border: 1px solid var(--color-border);
  border-radius: 3px;
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
}
.tv-page-btns {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tv-page-num {
  min-width: 28px;
  text-align: center;
  color: var(--color-text-primary);
  font-weight: 600;
}
</style>
