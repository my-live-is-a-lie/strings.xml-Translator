import type { NextFunction, Request, Response } from 'express';

/** Counters kept in memory; reset when the process restarts. */
export const metrics = {
  startedAt: Date.now(),
  requests: 0,
  errors5xx: 0,
  rateLimited: 0,
  byRoute: {} as Record<string, number>,
};

export type LogLevel = 'info' | 'warn' | 'error';

/** One JSON object per line, easy to ship to any log collector. Never pass keys or request bodies in. */
export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
}

/** Logs method, path, status and duration for /api requests. Query strings and bodies are never logged. */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const route = `${req.method} ${req.baseUrl}${req.path}`;
    metrics.requests += 1;
    metrics.byRoute[route] = (metrics.byRoute[route] ?? 0) + 1;
    if (res.statusCode >= 500) metrics.errors5xx += 1;
    log(res.statusCode >= 500 ? 'error' : 'info', 'request', {
      route,
      status: res.statusCode,
      ms: Math.round(ms),
    });
  });
  next();
}

export function metricsSnapshot() {
  return {
    uptimeSeconds: Math.round((Date.now() - metrics.startedAt) / 1000),
    requests: metrics.requests,
    errors5xx: metrics.errors5xx,
    rateLimited: metrics.rateLimited,
    byRoute: metrics.byRoute,
  };
}
