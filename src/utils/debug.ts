// Logs ignored errors in development so they are visible while developing, and stays silent in production.
export function debugIgnored(scope: string, err: unknown): void {
  if (import.meta.env?.DEV) {
    console.debug(`[ignored] ${scope}:`, err);
  }
}
