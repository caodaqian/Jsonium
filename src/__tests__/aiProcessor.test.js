import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_PROVIDERS, fetchOpenAICompatibleModels, processWithAI, validateAIConfig } from '../services/aiProcessor.js';

describe('aiProcessor - uTools provider', () => {
  const originalWindow = global.window;

  beforeEach(() => {
    // ensure global.window exists for tests
    if (!global.window) global.window = {};
  });

  afterEach(() => {
    // restore and clean
    global.window = originalWindow;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('calls uTools ai.chat when available and returns its result', async () => {
    const mockRes = { data: 'processed result from utools' };
    const chatMock = vi.fn().mockResolvedValue(mockRes);
    global.window.utools = { ai: { chat: chatMock } };

    const res = await processWithAI('{"a":1}', '请处理', { provider: AI_PROVIDERS.UTOOLS });

    expect(chatMock).toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.data).toBe('processed result from utools');
  });

  it('returns error when uTools environment is not available', async () => {
    // ensure no utools
    delete global.window.utools;

    const res = await processWithAI('{"a":1}', '请处理', { provider: AI_PROVIDERS.UTOOLS });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/uTools 环境不可用|AI 接口未检测到/i);
  });

  it('validateAIConfig accepts uTools provider without apiKey', () => {
    const v = validateAIConfig({ provider: AI_PROVIDERS.UTOOLS });
    expect(v.valid).toBe(true);
  });

  it('validateAIConfig requires baseUrl and model for openai-compatible', () => {
    const noBase = validateAIConfig({ provider: AI_PROVIDERS.OPENAI_COMPATIBLE, apiKey: 'x', model: 'gpt' });
    expect(noBase.valid).toBe(false);

    const noModel = validateAIConfig({ provider: AI_PROVIDERS.OPENAI_COMPATIBLE, apiKey: 'x', baseUrl: 'https://example.com/v1' });
    expect(noModel.valid).toBe(false);

    const ok = validateAIConfig({
      provider: AI_PROVIDERS.OPENAI_COMPATIBLE,
      apiKey: 'x',
      baseUrl: 'https://example.com/v1',
      model: 'gpt-4o-mini'
    });
    expect(ok.valid).toBe(true);
  });

  it('fetchOpenAICompatibleModels returns normalized model list', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4.1' }] })
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchOpenAICompatibleModels({
      baseUrl: 'https://example.com/v1',
      apiKey: 'sk-test',
      headersJson: ''
    });

    expect(fetchMock).toHaveBeenCalledWith('https://example.com/v1/models', expect.any(Object));
    expect(res.success).toBe(true);
    expect(res.data.map((m) => m.id)).toEqual(['gpt-4o-mini', 'gpt-4.1']);
  });

  it('fetchOpenAICompatibleModels falls back with error when endpoint unavailable', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchOpenAICompatibleModels({
      baseUrl: 'https://example.com/v1',
      apiKey: 'sk-test'
    });

    expect(res.success).toBe(false);
    expect(res.data).toEqual([]);
  });
});