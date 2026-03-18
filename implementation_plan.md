# Implementation Plan

[Overview]
目标：按用户优先级对编辑器/格式化、格式检测/转换、AI 输出处理和查询引擎实施稳健性修复与可回退的默认优化，以提升可靠性、可预测性与可维护性。

本计划基于现有代码库（核心文件：src/services/{editorFormatting.js,formatDetector.js,diffEngine.js,queryEngine.js,aiProcessor.js} 与组件 src/components/Editor.vue 等）提出逐步实现方案。改动以“默认优化且可在设置中回退”为原则，先修复高风险边界，再推进体验与性能改进，配套增加单元/集成测试与配置项，确保向后兼容与可回滚。

[Types]  
对类型系统的主要补充为一组小型 JS/TS 接口与枚举，用于一致地表达路径、格式检测结果、格式化结果与 AI 返回契约。

类型定义（建议放置于 src/types/index.d.ts 或 src/services/types.js）
- EditRange { startLine: number, startColumn: number, endLine: number, endColumn: number }
- TextEdit { range: EditRange, text: string }
- FormatResult { success: boolean, data?: string, error?: string, format?: string }
- DetectResult { success: boolean, data?: string, originalFormat?: string, error?: string }
- DiffPath = string // 统一采用 JSONPath-like 表示（例如 $.a.b[0].c）
- AIResponse { success: boolean, data: string, rawResponse?: string, originalFormat?: 'JSON'|'text' }
- EditorSettings (增补字段):
  - autoFormat: boolean
  - autoFormatOnIdle: boolean
  - idleDelayMs: number
  - enterGuardMs: number
  - autoFormatOnPaste: boolean
  - preserveWhitespaceOnCopy: boolean (新增，可回退)
  - formatDetectorMode: 'strict'|'lenient' (新增)

校验规则
- EditRange 字段均为 1+ 的整数。
- DetectResult.data 在 success 为 true 时必有且为可解析 JSON（除非 originalFormat 声明为非 JSON）。

[Files]  
修改与新增文件概览（以路径为准）：

新建文件
- src/utils/textUtils.js — 行尾归一化、CRLF/ LF 处理、trim 选项（函数：normalizeLineEndings, ensureTrailingNewline）
- src/utils/pathUtils.js — 统一 JSONPath-like 解析与 get/set（函数：toJsonPath, getValueAtJsonPath, setValueAtJsonPath）
- src/services/xmlUtils.js — 使用 fast-xml-parser 做 JSON<->XML 的稳健转换（函数：jsonToXmlSafe, xmlToJsonSafe）

修改文件
- src/services/editorFormatting.js
  - 修改 computeMinimalEdits（替换为 computeMinimalEditsEnhanced），修正 CRLF、末尾换行、纯插入/删除、全部替换逻辑。
  - 修改 runEditorFormat：明确优先顺序、增加超时/失败回退路径与可配置 allowFallback；导出新的 helper registerFormattingProviderWithLifecycle。
- src/components/Editor.vue
  - 使用新的 scheduleAutoFormat 简化调度逻辑，增加 UI 状态（formattingPending）并暴露取消接口；将 copyToClipboard 的“去空白”行为改为依据设置 preserveWhitespaceOnCopy。
- src/services/formatDetector.js
  - 重构检测流程：strict 模式下更保守（优先 JSON，再尝试其他），lenient 模式下保留现有策略。提取重复用到的 safeParse helpers。
  - toFormat：用 xmlUtils.jsonToXmlSafe 替代内置实现，并对 base64/escaped encoding 标注原始格式。
- src/services/aiProcessor.js
  - 增加 parseAIJsonWithRetry(resultText, { maxRetries, retryPrompt })，当未解析到 JSON 时提供二次请求逻辑（仅在用户允许或默认尝试一次）。
  - 增加网络调用超时/错误码处理与统一错误包装。
- src/services/diffEngine.js
  - 统一 diff path 表示到 JSONPath-like（以 $ 开头），重写 getValueByPath/setNestedValue 为基于 pathUtils 的 getValueAtJsonPath/setValueAtJsonPath。
- src/services/queryEngine.js
  - 抽出 parseJqPath 改为更保守实现并增加异常处理，改进 getQueryPaths 以返回精确路径（尽可能）。
- 测试文件（新增/修改）
  - src/__tests__/editorFormatting.test.js — 扩展 CRLF 与末尾换行、空文件、整替换用例
  - src/__tests__/formatDetector.test.js — 严格/宽松模式用例
  - src/__tests__/aiProcessor.test.js — 模拟非 JSON 响应并验证 retry 行为
  - src/__tests__/queryEngine.test.js — 复杂 filter / slice cases

删除或移动
- 无删除文件计划。现有轻量 xml 转换实现将被替换，保留旧实现作为注释或迁移说明（非运行时文件）。

配置更新
- package.json：新增依赖 fast-xml-parser、ajv（JSON Schema 校验用于中期改进）、fast-deep-equal（如需相似度）
- vite/test 配置不需要变更，添加 jest/vitest 测试用例（已有 vitest 配置可复用）。

[Functions]  
函数层面的新增与修改，精确列出签名与目的。

新增函数
- normalizeLineEndings(content: string, mode: 'lf'|'crlf'|'auto') : string — src/utils/textUtils.js
- ensureTrailingNewline(content: string, ensure: boolean) : string — src/utils/textUtils.js
- computeMinimalEditsEnhanced(oldText: string, newText: string, monacoInstance?: object) : Array<TextEdit> — src/services/editorFormatting.js
  - 修正边界：CRLF/LF 混合、末尾换行、纯插入/删除（避免多余换行）、当差异占全文超过阈值（例如 60%）回退到全替换但尽量保留选区
- scheduleAutoFormatSimple(state, reason, delay, callback) — src/services/editorFormatting.js
  - 简化调度：单一计时器、cancel 可视化标志、重复触发保护
- registerFormattingProviderWithLifecycle(monacoInstance) : IDisposable|null — src/services/editorFormatting.js
  - 返回 disposable，供组件在 onUnmount 调用 dispose
- parseAIJsonWithRetry(text: string, options: {maxRetries:number, retryPrompt?:string, callAiFn:Function}) : Promise<AIResponse> — src/services/aiProcessor.js
  - 若初次解析失败，自动发起一次简短的“只返回 JSON”请求（可配置）
- jsonToXmlSafe(obj: any, options?): string — src/services/xmlUtils.js
- xmlToJsonSafe(xml: string): any — src/services/xmlUtils.js
- getValueAtJsonPath(obj: any, path: string): any — src/utils/pathUtils.js
- setValueAtJsonPath(obj: any, path: string, value: any): void — src/utils/pathUtils.js

修改函数（精确到文件与函数名）
- src/services/editorFormatting.js
  - computeMinimalEdits -> 替换为 computeMinimalEditsEnhanced（返回精确 range；保留 _createRange）
  - runEditorFormat(editor, options) -> 明确返回 { status, method, timedOut? }，在尝试 Monaco action 时设置超时（例如 3s），若失败立即尝试 fallback。
- src/components/Editor.vue
  - copyToClipboard(text) -> 依据设置 preserveWhitespaceOnCopy 决定是否去空白，确保行为可配置且默认保留空白（以兼容性策略）。
  - formatJson(reason) -> 调用 runEditorFormat 并设置 UI 状态（formattingPending），支持用户取消（例如 expose cancelFormat）。
  - scheduleAutoFormat 调用改为 scheduleAutoFormatSimple，移除复杂 enterGuard 分支或将其合并为更可预测的延迟计算。
- src/services/formatDetector.js
  - detectAndConvert(input) -> 增加 mode 参数（来自设置）；在 strict 模式中：优先标准 JSON -> escaped_json -> base64 -> JSON5 -> XML -> YAML；lenient 模式保留原策略但记录 originalFormat 字段。
  - toFormat(data, format) -> 对 xml 分支使用 jsonToXmlSafe，增加对不支持格式的清晰错误信息。
- src/services/diffEngine.js
  - getDifferences, buildTreeDiff 等函数内部改用 JSONPath-like 路径并使用 pathUtils 的 getValue/setValue。

移除函数
- 无立即删除计划；旧 helper 可标注为 deprecated 并在后续版本删除。

[Classes]  
项目当前以函数式为主，无需新增复杂类；为便于管理可以新增小型封装类（可选）：

新增（可选）
- FormatDetector (src/services/formatDetector.js) — 将现有检测函数包装为类以便维护状态（mode）和可配置规则（不会强制使用，保留函数式兼容层）。

修改类
- 无修改现有类需求。

[Dependencies]  
依赖变更摘要（在 package.json 中新增/升级）

新增依赖（建议）
- fast-xml-parser (稳定的 JSON<->XML 解析) — ^4.x
- ajv (JSON Schema 校验，为中期功能准备) — ^8.x
- fast-deep-equal 或 lodash.isequal（用于差异相似度） — ^3.x
- optionally he (HTML/XML escape) — ^1.x

版本变更与集成
- 保持现有主依赖（vue、monaco 等）版本不变；新增依赖应在 package.json 中声明并通过 npm install 添加。编写变更时留意打包体积（XML 库体积较小的优先）。

[Testing]  
测试策略简述：扩展现有 vitest 单元测试，增加边界用例与集成测试，重点覆盖 computeMinimalEditsEnhanced、formatDetector 严格/宽松行为、AI 解析回退与 queryEngine 复杂表达式。

测试清单（文件路径）
- src/__tests__/editorFormatting.test.js
  - 用例：CRLF 与 LF 混合、末尾无换行/有换行、空文件、整文件替换阈值、光标/selection 保持（模拟 monaco）
- src/__tests__/formatDetector.test.js
  - 用例：strict vs lenient 对同一输入的判定差异（JSON/YAML/JSON5/XML/base64/escaped）
- src/__tests__/aiProcessor.test.js
  - 用例：AI 返回只有文本、包含 ```json 块、JSON 近似但无代码块时的 retry 行为
- src/__tests__/diffEngine.test.js 改进
  - 用例：路径统一后数组索引与点分混合，extractOnlyDifferences 稳健性测试
- 集成测试（可选）
  - 模拟编辑器端点格式化时序（格式化请求超时回退）、粘贴触发 autoFormat 场景

[Implementation Order]  
实现顺序（最小风险、便于回滚）：

1. 新建辅助工具
   - 实现 src/utils/textUtils.js 与 src/utils/pathUtils.js（小且易测试）。
2. computeMinimalEdits 修正
   - 在 src/services/editorFormatting.js 中实现 computeMinimalEditsEnhanced 并增加单元测试；不修改外部 API（保留 computeMinimalEdits 名称的兼容导出一段时期）。
3. runEditorFormat 强化
   - 增加超时、失败回退、返回值标准化；在 Editor.vue 调用点读取新的返回格式并更新 UI 状态（formattingPending）。
4. 简化 autoFormat 调度
   - 用 scheduleAutoFormatSimple 替换复杂逻辑，Editor.vue 增加可视化 pending indicator 及取消接口（expose cancelFormat）。
5. copyToClipboard 可配置化
   - 增加设置 preserveWhitespaceOnCopy；修改 Editor.vue 中 copyToClipboard 行为并更新 UI 设置面板（ControlPanel.vue）。
6. formatDetector 行为调整
   - 引入 strict/lenient 模式，修改 detectAndConvert/toFormat，用 xmlUtils 替换简易实现；增加测试。
7. AI 输出解析回退
   - 在 aiProcessor.js 中实现 parseAIJsonWithRetry，集成到 processWithAI；对失败场景展示原始响应并提供重试选项（UI 交互在中期实现，先提供函数层面支持）。
8. diff 路径统一
   - 修改 diffEngine 使用 pathUtils，并调整 buildTreeDiff/getDifferences；扩展测试。
9. queryEngine 容错改进
   - 加固 parseJqPath 与 matchesFilter，对复杂条件增加稳定性测试。
10. 额外优化/中期功能
   - 引入 ajv、JSON Schema 支持、性能优化（大文件分块/虚拟化）按需推进。

注意：每一步均先提交小型 PR 并运行测试；保留向后兼容层（兼容导出与 config 回退）。