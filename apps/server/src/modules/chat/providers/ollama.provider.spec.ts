import type { StreamChunk } from '@repo/types';
import { OllamaProvider } from './ollama.provider';

// ── env 夹具 ──────────────────────────────────────────────────
// Provider 在构造函数里读 env（与 Nest 生命周期一致），所以每个用例先摆好
// env 再 new。原值用完还原，避免污染同进程的其他 spec。

const ENV_KEYS = [
  'OLLAMA_BASE_URL',
  'OLLAMA_USERNAME',
  'OLLAMA_PASSWORD',
] as const;

const ORIGINAL_ENV: Record<string, string | undefined> = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

function applyEnv(values: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/** 造一个 Ollama 风格的 NDJSON 响应（默认一条 content 行） */
function ndjsonResponse(
  lines: string[] = ['{"message":{"content":"hi"}}'],
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

/** 替换 global.fetch，并记录每次调用的 url / init */
function mockFetch(
  response: Response | (() => Response),
): Array<{ url: string; init: any }> {
  const calls: Array<{ url: string; init: any }> = [];
  global.fetch = jest.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return typeof response === 'function' ? response() : response;
  }) as unknown as typeof fetch;
  return calls;
}

/** 完整消费生成器：走完 provider 的 finally（清计时器、cancel reader） */
async function consume(
  provider: OllamaProvider,
  config: { apiModelName: string; apiBaseUrl?: string },
) {
  const chunks: StreamChunk[] = [];
  for await (const chunk of provider.streamChat(
    [{ role: 'user', content: 'hi' }],
    config,
  )) {
    chunks.push(chunk);
  }
  return chunks;
}

const basic = (user: string, pass: string) =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

describe('OllamaProvider 反代（Nginx auth_basic）凭据', () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    applyEnv(ORIGINAL_ENV);
  });

  it('凭据齐全时命中内置基地址：携带 Basic 头', async () => {
    applyEnv({
      OLLAMA_BASE_URL: 'https://ollama.example.com',
      OLLAMA_USERNAME: 'ollama-client',
      OLLAMA_PASSWORD: 'secret',
    });
    const calls = mockFetch(ndjsonResponse());

    const chunks = await consume(new OllamaProvider(), {
      apiModelName: 'qwen2.5:1.5b',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://ollama.example.com/api/chat');
    expect(calls[0].init.headers.Authorization).toBe(
      basic('ollama-client', 'secret'),
    );
    expect(chunks).toEqual([{ type: 'text', content: 'hi' }]);
  });

  it('基地址带结尾斜杠时仍判为同源（origin 比对不受拼接影响）', async () => {
    applyEnv({
      OLLAMA_BASE_URL: 'https://ollama.example.com/',
      OLLAMA_USERNAME: 'u',
      OLLAMA_PASSWORD: 'p',
    });
    const calls = mockFetch(ndjsonResponse());

    await consume(new OllamaProvider(), { apiModelName: 'qwen2.5:1.5b' });

    expect(calls[0].url).toBe('https://ollama.example.com/api/chat');
    expect(calls[0].init.headers.Authorization).toBe(basic('u', 'p'));
  });

  it('自定义模型指向其他 host：不携带凭据（否则等于把口令发给第三方端点）', async () => {
    applyEnv({
      OLLAMA_BASE_URL: 'https://ollama.example.com',
      OLLAMA_USERNAME: 'u',
      OLLAMA_PASSWORD: 'p',
    });
    const calls = mockFetch(ndjsonResponse());

    await consume(new OllamaProvider(), {
      apiModelName: 'llama3',
      apiBaseUrl: 'https://user-supplied.example.net',
    });

    expect(calls[0].url).toBe('https://user-supplied.example.net/api/chat');
    expect(calls[0].init.headers.Authorization).toBeUndefined();
  });

  it('未配置凭据（直连本机 Ollama）：不发 Authorization 头', async () => {
    applyEnv({ OLLAMA_BASE_URL: 'http://localhost:11434' });
    const calls = mockFetch(ndjsonResponse());

    await consume(new OllamaProvider(), { apiModelName: 'qwen2.5:1.5b' });

    expect(calls[0].init.headers.Authorization).toBeUndefined();
  });

  it('只填了用户名：不发半个凭据', async () => {
    applyEnv({
      OLLAMA_BASE_URL: 'https://ollama.example.com',
      OLLAMA_USERNAME: 'u',
    });
    const calls = mockFetch(ndjsonResponse());

    await consume(new OllamaProvider(), { apiModelName: 'qwen2.5:1.5b' });

    expect(calls[0].init.headers.Authorization).toBeUndefined();
  });

  it('401 指向凭据配置，而不是把 Nginx 的 HTML 原样抛出', async () => {
    applyEnv({
      OLLAMA_BASE_URL: 'https://ollama.example.com',
      OLLAMA_USERNAME: 'u',
      OLLAMA_PASSWORD: 'wrong',
    });
    mockFetch(() => new Response('<html>401</html>', { status: 401 }));

    await expect(
      consume(new OllamaProvider(), { apiModelName: 'qwen2.5:1.5b' }),
    ).rejects.toThrow(/OLLAMA_USERNAME \/ OLLAMA_PASSWORD/);
  });

  it('未带凭据时被 401 拒绝：提示可能是反代要求认证', async () => {
    applyEnv({ OLLAMA_BASE_URL: 'http://localhost:11434' });
    mockFetch(() => new Response('<html>401</html>', { status: 401 }));

    await expect(
      consume(new OllamaProvider(), { apiModelName: 'qwen2.5:1.5b' }),
    ).rejects.toThrow(/Nginx auth_basic/);
  });
});
