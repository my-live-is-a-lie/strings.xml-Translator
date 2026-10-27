import { Capacitor, CapacitorHttp, HttpResponse } from '@capacitor/core';

export interface NativeRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  data?: unknown;
  params?: Record<string, string>;
  timeoutMs?: number;
}

export interface NativeResponse<T = unknown> {
  status: number;
  ok: boolean;
  data: T;
  text: string;
}

/**
 * Executes an HTTP request.
 * On native platforms (Android / iOS via Capacitor), uses CapacitorHttp to route the call
 * through the native networking stack (OkHttp/HttpURLConnection), bypassing browser CORS completely.
 * On standard Web browsers, uses the standard fetch API.
 */
export async function nativeFetch<T = unknown>(
  url: string,
  options: NativeRequestOptions = {}
): Promise<NativeResponse<T>> {
  const method = options.method || 'GET';
  const timeoutMs = options.timeoutMs || 25000;

  if (Capacitor.isNativePlatform()) {
    try {
      const res: HttpResponse = await CapacitorHttp.request({
        url,
        method,
        headers: options.headers,
        data: options.data,
        params: options.params,
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
      });

      const ok = res.status >= 200 && res.status < 300;
      let text = '';
      if (typeof res.data === 'string') {
        text = res.data;
      } else if (res.data !== undefined && res.data !== null) {
        text = JSON.stringify(res.data);
      }

      return {
        status: res.status,
        ok,
        data: res.data as T,
        text,
      };
    } catch (nativeErr) {
      console.warn('[nativeHttp] Native request encountered an error, falling back to fetch:', nativeErr);
    }
  }

  // Web Browser fallback
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let body: BodyInit | undefined;
    if (options.data !== undefined && options.data !== null && method !== 'GET') {
      body = typeof options.data === 'string' ? options.data : JSON.stringify(options.data);
    }

    const res = await fetch(url, {
      method,
      headers: options.headers,
      body,
      signal: controller.signal,
    });

    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Keep as raw text
    }

    return {
      status: res.status,
      ok: res.ok,
      data: parsed as T,
      text,
    };
  } finally {
    clearTimeout(timer);
  }
}
