/**
 * AI JSON 处理模块 - 利用大模型进行 JSON 操作
 */

/**
 * AI 处理配置
 */
export const AI_PROVIDERS = {
  OPENAI: 'openai',
  CLAUDE: 'claude',
  CUSTOM: 'custom',
  UTOOLS: 'utools',
  OPENAI_COMPATIBLE: 'openai-compatible'
};

import { getStringifyIndent } from '../utils/indent.js';

/**
 * 调用 AI 处理 JSON
 */
export async function processWithAI(jsonData, instruction, aiConfig) {
  try {
    const {
      provider = AI_PROVIDERS.OPENAI,
      apiKey,
      model = 'gpt-3.5-turbo',
      endpoint,
      baseUrl,
      systemPrompt,
      temperature,
      headersJson,
      timeout = 30000
    } = aiConfig || {};

    // utools provider 不需要 API Key；其它 provider 继续校验
    if (provider !== AI_PROVIDERS.UTOOLS && !apiKey) {
      return { success: false, error: 'API Key 未配置' };
    }

    const prompt = buildPrompt(jsonData, instruction);

    let result;

    switch (provider) {
      case AI_PROVIDERS.OPENAI:
        result = await callOpenAI(prompt, apiKey, model, { timeout });
        break;
      case AI_PROVIDERS.CLAUDE:
        result = await callClaude(prompt, apiKey, model, { timeout });
        break;
      case AI_PROVIDERS.UTOOLS:
        result = await callUtools(prompt, aiConfig);
        break;
      case AI_PROVIDERS.OPENAI_COMPATIBLE:
        result = await callOpenAICompatible(prompt, {
          apiKey,
          model,
          baseUrl,
          systemPrompt,
          temperature,
          headersJson,
          timeout
        });
        break;
      case AI_PROVIDERS.CUSTOM:
        result = await callCustomAPI(prompt, apiKey, endpoint, model, { timeout });
        break;
      default:
        return { success: false, error: `未知的 AI 提供商: ${provider}` };
    }

    if (!result.success) {
      return result;
    }

    // 尝试解析响应为 JSON；若失败且配置允许，则尝试一次“仅返回 JSON”的重试（可配置）
    try {
      // 先尝试直接解析整体响应
      const directParsed = JSON.parse(result.data);
      return {
        success: true,
        data: JSON.stringify(directParsed, null, getStringifyIndent()),
        rawResponse: result.data,
        originalFormat: 'JSON'
      };
    } catch (e) {
      // 尝试摘取 ```json ``` 代码块
      const jsonMatch = (typeof result.data === 'string' && result.data.match(/```json\n([\s\S]*?)\n```/)) || null;
      if (jsonMatch) {
        try {
          const parsedBlock = JSON.parse(jsonMatch[1]);
          return {
            success: true,
            data: JSON.stringify(parsedBlock, null, getStringifyIndent()),
            rawResponse: result.data,
            originalFormat: 'JSON'
          };
        } catch (e2) {
          // 继续到重试逻辑
        }
      }

      const allowRetry = aiConfig?.parseRetry !== false;
      if (allowRetry) {
        try {
          const retryResult = await parseAIJsonWithRetry(result.data, { provider, aiConfig, maxRetries: aiConfig?.parseRetryMax || 1 });
          if (retryResult && retryResult.parsed) {
            return {
              success: true,
              data: JSON.stringify(retryResult.parsed, null, getStringifyIndent()),
              rawResponse: retryResult.raw || result.data,
              originalFormat: 'JSON',
              retry: true
            };
          }
        } catch (e3) {
          // ignore retry errors and fall back to returning original text
          // eslint-disable-next-line no-console
          console.warn('AI parse retry failed:', e3);
        }
      }

      // 回退：返回原始文本
      return {
        success: true,
        data: result.data,
        rawResponse: result.data,
        originalFormat: 'text'
      };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl || typeof baseUrl !== 'string') return '';
  return baseUrl.replace(/\/+$/, '');
}

function parseOptionalHeaders(headersJson) {
  if (!headersJson || typeof headersJson !== 'string' || !headersJson.trim()) {
    return { success: true, headers: {} };
  }
  try {
    const parsed = JSON.parse(headersJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { success: false, error: 'Headers JSON 必须是对象' };
    }
    return { success: true, headers: parsed };
  } catch (e) {
    return { success: false, error: `Headers JSON 解析失败: ${e.message}` };
  }
}

async function callOpenAICompatible(prompt, options = {}) {
  const {
    apiKey,
    model,
    baseUrl,
    systemPrompt,
    temperature,
    headersJson,
    timeout = 30000
  } = options;

  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) {
    return { success: false, error: 'openai-compatible 的 Base URL 未配置' };
  }

  const headerParsed = parseOptionalHeaders(headersJson);
  if (!headerParsed.success) {
    return { success: false, error: headerParsed.error };
  }

  const headers = {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...headerParsed.headers
  };

  const messages = [];
  const system = typeof systemPrompt === 'string' ? systemPrompt.trim() : '';
  if (system) {
    messages.push({ role: 'system', content: system });
  }
  messages.push({ role: 'user', content: prompt });

  const body = {
    model: model || 'gpt-3.5-turbo',
    messages,
    max_tokens: 2000
  };
  if (temperature !== '' && temperature !== null && temperature !== undefined) {
    const n = Number(temperature);
    if (!Number.isNaN(n)) {
      body.temperature = n;
    }
  }

  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
    const response = await fetch(`${normalized}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined
    });
    if (timer) clearTimeout(timer);

    if (!response.ok) {
      let message = `请求失败: ${response.status}`;
      try {
        const error = await response.json();
        message = error?.error?.message || error?.message || message;
      } catch (_e) { }
      return { success: false, error: message };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || data?.content || data?.result || data?.message;
    if (!content) {
      return { success: false, error: '未获取到响应' };
    }
    return { success: true, data: content };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
}

/**
 * 构建 AI 提示词
 */
function buildPrompt(jsonData, instruction) {
  let jsonStr = jsonData;
  if (typeof jsonData !== 'string') {
    try {
      jsonStr = JSON.stringify(jsonData, null, getStringifyIndent());
    } catch (e) {
      jsonStr = String(jsonData);
    }
  }

  return `你是一个 JSON 处理助手。根据以下指示操作提供的 JSON 数据。

JSON 数据:
\`\`\`json
${jsonStr}
\`\`\`

指示:
${instruction}

请返回处理后的 JSON 数据。如果返回值是 JSON，请使用以下格式:
\`\`\`json
{处理结果}
\`\`\`

如果返回值是其他格式或说明，请直接返回。`;
}

/**
 * 调用 OpenAI API
 */
async function callOpenAI(prompt, apiKey, model) {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model || 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: '你是一个 JSON 数据处理助手。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      const error = await response.json();
      return {
        success: false,
        error: error.error?.message || '调用失败'
      };
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      return { success: false, error: '未获取到响应' };
    }

    return { success: true, data: content };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 调用 Claude API
 */
async function callClaude(prompt, apiKey, model) {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model || 'claude-3-sonnet-20240229',
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      const error = await response.json();
      return {
        success: false,
        error: error.error?.message || '调用失败'
      };
    }

    const data = await response.json();
    const content = data.content[0]?.text;

    if (!content) {
      return { success: false, error: '未获取到响应' };
    }

    return { success: true, data: content };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 调用自定义 API
 */
async function callCustomAPI(prompt, apiKey, endpoint, model) {
  try {
    if (!endpoint) {
      return { success: false, error: '自定义端点未配置' };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      return {
        success: false,
        error: `请求失败: ${response.statusText}`
      };
    }

    const data = await response.json();
    let content = data.choices?.[0]?.text || data.content || data.result || data.message;

    if (!content) {
      return { success: false, error: '未获取到响应' };
    }

    return { success: true, data: content };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 调用 uTools 平台 AI（若在 uTools 环境中可用）
 *
 * 使用官方宿主接口：window.utools.ai(option[, streamCallback])
 * 返回统一 { success, data } 格式
 */
async function callUtools(prompt, aiConfig = {}) {
  try {
    if (typeof window === 'undefined' || !window.utools) {
      return { success: false, error: 'uTools 环境不可用' };
    }
    const uai = window.utools.ai;
    if (!uai) {
      return { success: false, error: 'uTools AI 接口未检测到' };
    }

    const model = aiConfig?.model;
    const messages = [
      { role: 'system', content: '你是一个 JSON 数据处理助手。' },
      { role: 'user', content: prompt }
    ];

    // If utools.ai is a function that accepts (options, streamCallback?)
    if (typeof uai === 'function') {
      const options = { model, messages, ...aiConfig };
      const res = await uai(options);
      const data = res?.content || res?.data || res?.text || res?.result || String(res);
      return { success: true, data };
    }

    // Try common method shapes: request/chat/generate
    if (typeof uai.request === 'function') {
      const options = { model, messages, ...aiConfig };
      const res = await uai.request(options);
      const data = res?.content || res?.data || res?.text || res?.result || String(res);
      return { success: true, data };
    }

    if (typeof uai.chat === 'function') {
      const res = await uai.chat({ model, messages, ...aiConfig });
      const data = res?.content || res?.data || res?.text || res?.result || String(res);
      return { success: true, data };
    }

    if (typeof uai.generate === 'function') {
      const res = await uai.generate({ model, messages, ...aiConfig });
      const data = res?.content || res?.data || res?.text || res?.result || String(res);
      return { success: true, data };
    }

    // Fallback: try any function-like property with options object
    for (const key of Object.keys(uai)) {
      if (typeof uai[key] === 'function') {
        try {
          const res = await uai[key]({ model, messages, ...aiConfig });
          const data = res?.content || res?.data || res?.text || res?.result || String(res);
          return { success: true, data };
        } catch (e) {
          // ignore and try next
        }
      }
    }

    return { success: false, error: '未能识别的 uTools AI 调用方式（已尝试官方 ai(options) 与常见方法）' };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
}

/**
 * 拉取 uTools 可用模型列表并标准化为 AiModelItem[]
 */
/**
 * 尝试对 AI 原始响应进行 JSON 解析并在必要时发起“仅返回 JSON”的重试请求。
 *
 * params:
 *  - originalText: 原始 AI 响应文本
 *  - opts: { provider, aiConfig, maxRetries = 1, retryPrompt? }
 *
 * 返回: { parsed: object|null, raw?: string }
 */
export async function parseAIJsonWithRetry(originalText, opts = {}) {
  const { provider, aiConfig = {}, maxRetries = 1, retryPrompt } = opts;
  const prompt = retryPrompt || aiConfig?.retryPrompt || '请仅返回有效的 JSON，不要包含任何解释性文字或代码块。只输出纯粹的 JSON 内容。';
  const apiKey = aiConfig?.apiKey;
  const model = aiConfig?.model;
  const endpoint = aiConfig?.endpoint;
  const timeout = aiConfig?.timeout || 30000;

  // Try simple parse helpers on originalText first
  try {
    // fenced json block
    const fenced = (typeof originalText === 'string' && originalText.match(/```json\n([\s\S]*?)\n```/)) || null;
    if (fenced) {
      try {
        const parsed = JSON.parse(fenced[1]);
        return { parsed, raw: originalText };
      } catch (e) {
        // continue
      }
    }
    // direct parse
    const direct = JSON.parse(originalText);
    return { parsed: direct, raw: originalText };
  } catch (_e) {
    // proceed to retry via provider
  }

  if (!provider || maxRetries <= 0) return { parsed: null };

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Build a focused prompt that includes the original response for context
      const retryPrompt = `${prompt}\n\n原始响应（供参考）:\n${originalText}`;

      let callRes = null;
      switch (provider) {
        case AI_PROVIDERS.OPENAI:
          callRes = await callOpenAI(retryPrompt, apiKey, model, { timeout });
          break;
        case AI_PROVIDERS.CLAUDE:
          callRes = await callClaude(retryPrompt, apiKey, model);
          break;
        case AI_PROVIDERS.CUSTOM:
          callRes = await callCustomAPI(retryPrompt, apiKey, endpoint, model);
          break;
        case AI_PROVIDERS.UTOOLS:
          callRes = await callUtools(retryPrompt, aiConfig);
          break;
        case AI_PROVIDERS.OPENAI_COMPATIBLE:
          callRes = await callOpenAICompatible(retryPrompt, {
            apiKey,
            model,
            baseUrl: aiConfig?.baseUrl,
            systemPrompt: aiConfig?.systemPrompt,
            temperature: aiConfig?.temperature,
            headersJson: aiConfig?.headersJson,
            timeout
          });
          break;
        default:
          callRes = { success: false, error: '未知 provider' };
      }

      if (!callRes || !callRes.success || !callRes.data) continue;

      const text = callRes.data;

      // try fenced block
      const match = (typeof text === 'string' && text.match(/```json\n([\s\S]*?)\n```/)) || null;
      if (match) {
        try {
          const parsed = JSON.parse(match[1]);
          return { parsed, raw: text };
        } catch (e) {
          // continue to direct parse
        }
      }

      try {
        const parsedDirect = JSON.parse(text);
        return { parsed: parsedDirect, raw: text };
      } catch (e) {
        // not parseable; continue retry loop
      }
    } catch (e) {
      // ignore and retry
      // eslint-disable-next-line no-console
      console.warn('parseAIJsonWithRetry attempt error:', e);
    }
  }

  return { parsed: null };
}

export async function fetchUtoolsModels() {
  try {
    if (typeof window === 'undefined' || !window.utools) {
      return { success: false, data: [], error: 'uTools 环境不可用' };
    }
    if (typeof window.utools.allAiModels !== 'function') {
      return { success: false, data: [], error: 'uTools allAiModels 接口不可用' };
    }
    const raw = await window.utools.allAiModels();
    if (!Array.isArray(raw)) {
      return { success: false, data: [], error: '返回数据格式异常' };
    }
    const models = raw.map(m => ({
      id: m.id || m.model || String(m.name || m.label || ''),
      label: m.label || m.name || m.title || m.id || '',
      description: m.description || '',
      icon: m.icon || '',
      cost: typeof m.cost === 'number' ? m.cost : undefined
    })).filter(m => m.id);
    if (models.length === 0) {
      return { success: false, data: [], error: '未获取到模型' };
    }
    return { success: true, data: models };
  } catch (e) {
    return { success: false, data: [], error: e.message || String(e) };
  }
}

export async function fetchOpenAICompatibleModels({ baseUrl, apiKey, headersJson } = {}) {
  try {
    const normalized = normalizeBaseUrl(baseUrl);
    if (!normalized) {
      return { success: false, data: [], error: 'Base URL 未配置' };
    }

    const headerParsed = parseOptionalHeaders(headersJson);
    if (!headerParsed.success) {
      return { success: false, data: [], error: headerParsed.error };
    }

    const headers = {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...headerParsed.headers
    };

    const response = await fetch(`${normalized}/models`, { method: 'GET', headers });
    if (!response.ok) {
      return { success: false, data: [], error: `请求失败: ${response.status}` };
    }

    const data = await response.json();
    const rows = Array.isArray(data?.data) ? data.data : [];
    const models = rows
      .map((m) => ({
        id: m?.id || m?.model || '',
        label: m?.id || m?.model || m?.name || '',
        description: m?.owned_by ? `owned_by: ${m.owned_by}` : ''
      }))
      .filter((m) => m.id);

    if (models.length === 0) {
      return { success: false, data: [], error: '未获取到模型' };
    }

    return { success: true, data: models };
  } catch (e) {
    return { success: false, data: [], error: e.message || String(e) };
  }
}

/**
 * 验证 AI 配置
 */
export function validateAIConfig(config) {
  const { provider, apiKey, baseUrl, model } = config || {};

  if (!provider) {
    return { valid: false, message: '未选择 AI 提供商' };
  }

  // uTools provider 可以依赖宿主环境，不需要 API Key
  if (provider !== AI_PROVIDERS.UTOOLS && !apiKey) {
    return { valid: false, message: 'API Key 未设置' };
  }

  if (provider === AI_PROVIDERS.OPENAI_COMPATIBLE) {
    if (!baseUrl) {
      return { valid: false, message: 'Base URL 未设置' };
    }
    if (!model) {
      return { valid: false, message: 'Model 未设置' };
    }
  }

  if (provider === AI_PROVIDERS.CUSTOM && !config.endpoint) {
    return { valid: false, message: '自定义端点未设置' };
  }

  return { valid: true };
}

/**
 * AI 指令模板
 */
export const AI_INSTRUCTION_TEMPLATES = [
  {
    title: '删除特定字段',
    template: '请删除 JSON 中的以下字段: {fieldNames}'
  },
  {
    title: '过滤数组元素',
    template: '请过滤数组，只保留满足以下条件的元素: {condition}'
  },
  {
    title: '转换字段名称',
    template: '请将所有字段名称从 {fromCase} 转换为 {toCase}'
  },
  {
    title: '提取特定数据',
    template: '请从 JSON 中提取以下字段: {fieldNames}'
  },
  {
    title: '合并数据',
    template: '请合并以下数据源的内容'
  },
  {
    title: '转换数据类型',
    template: '请将字段 {fieldNames} 转换为 {targetType} 类型'
  },
  {
    title: '生成代码',
    template: '请为此 JSON 生成 {language} 代码'
  },
  {
    title: '数据验证',
    template: '请验证此 JSON 数据的有效性，并报告任何问题'
  },
  {
    title: '数据标准化',
    template: '请对此 JSON 数据进行标准化处理'
  }
];

/**
 * 下载 AI 处理结果
 */
export function downloadAIResult(result, filename = 'ai-result.json') {
  try {
    const content = typeof result === 'string' ? result : JSON.stringify(result, null, getStringifyIndent());
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export default {
  processWithAI,
  parseAIJsonWithRetry,
  fetchOpenAICompatibleModels,
  validateAIConfig,
  AI_INSTRUCTION_TEMPLATES,
  AI_PROVIDERS,
  downloadAIResult
};
