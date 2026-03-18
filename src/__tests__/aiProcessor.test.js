import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processWithAI, validateAIConfig, AI_PROVIDERS } from '../services/aiProcessor.js';

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
});