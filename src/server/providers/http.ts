import { ProviderError } from './types';
import { timeoutSeconds } from './thinking';

const REQUEST_TIMEOUT_MS = 120_000;
const MAX_ERROR_TEXT = 320;

export interface JsonRequestOptions {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal;
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbortLike(error: unknown): boolean {
  return (
    (error instanceof DOMException &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')) ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

export function providerMessageFromBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return '';
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (isRecord(parsed)) {
      const error = parsed.error;
      if (isRecord(error) && typeof error.message === 'string') {
        return error.message.trim();
      }
      if (typeof error === 'string' && error.trim()) {
        return error.trim();
      }
      if (typeof parsed.message === 'string' && parsed.message.trim()) {
        return parsed.message.trim();
      }
    }
  } catch {
    // Non-JSON provider error page: use a short excerpt below.
  }
  return trimmed.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function statusLabel(status: number): string {
  switch (status) {
    case 400:
      return '请求参数被模型服务拒绝';
    case 401:
      return '鉴权失败，请检查 API Key';
    case 403:
      return '访问被拒绝，请检查 API Key 权限';
    case 404:
      return '接口或模型不存在，请检查 Base URL 与模型 ID';
    case 413:
      return '请求内容过长';
    case 429:
      return '请求频率受限或额度不足';
    default:
      return status >= 500 ? '模型服务暂时不可用' : '模型服务返回错误';
  }
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export async function requestJson(options: JsonRequestOptions): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combined = AbortSignal.any([options.signal, timeoutSignal]);
  const seconds = timeoutSeconds(timeoutMs);

  let response: Response;
  try {
    response = await fetch(options.url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': 'ChuHeLunYi/1.0 (+local xiangqi model arena)',
        ...options.headers,
      },
      body: JSON.stringify(options.body),
      signal: combined,
    });
  } catch (error) {
    if (options.signal.aborted) {
      throw error;
    }
    if (timeoutSignal.aborted || (error instanceof DOMException && error.name === 'TimeoutError')) {
      throw new ProviderError(`模型请求超时（${seconds} 秒），可稍后重试`, { retryable: true });
    }
    const detail = isAbortLike(error) ? '请求被中断' : error instanceof Error ? error.message : '未知网络错误';
    throw new ProviderError(`无法连接模型服务：${detail}`, { retryable: true });
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    if (options.signal.aborted) throw error;
    if (timeoutSignal.aborted) {
      throw new ProviderError(`读取模型响应超时（${seconds} 秒），可稍后重试`, { retryable: true });
    }
    throw new ProviderError(
      `读取模型响应失败：${error instanceof Error ? error.message : '未知错误'}`,
      { retryable: true },
    );
  }

  if (!response.ok) {
    const detail = providerMessageFromBody(text).slice(0, MAX_ERROR_TEXT);
    const suffix = detail ? `：${detail}` : '';
    throw new ProviderError(
      `${statusLabel(response.status)}（HTTP ${response.status}）${suffix}`,
      { status: response.status, retryable: retryableStatus(response.status) },
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderError('模型服务返回的内容不是合法 JSON', { retryable: true });
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

export function asNonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

/** Strip a known secret plus common key shapes before showing provider text to the browser. */
export function redactSecrets(text: string, secrets: string[] = []): string {
  let safe = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) {
      safe = safe.split(secret).join('***');
    }
  }
  safe = safe
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-***')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer ***')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, 'AIza***');
  return safe.replace(/\s+/g, ' ').trim().slice(0, 500);
}

export const REQUEST_TIMEOUT = REQUEST_TIMEOUT_MS;
