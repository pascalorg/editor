'use client';

import { useEffect } from 'react';

/**
 * Browser error catcher. `window.onerror` plus unhandled promise rejections go
 * to /api/telemetry, which records them against actor_label 'browser'.
 *
 * Two guards, both learned from the old panel:
 *
 * - 5 s suppression per identical message. A render loop throwing the same
 *   error 60 times a second would otherwise write 60 rows a second.
 * - `keepalive` on the POST, so an error thrown during navigation still gets
 *   reported instead of being cancelled with the page.
 *
 * It reports and does nothing else — no swallowing, no re-throwing. The console
 * still shows the error to whoever has devtools open.
 */
const SUPPRESS_MS = 5000;
const recent = new Map<string, number>();

function shouldReport(key: string): boolean {
  const now = Date.now();
  const last = recent.get(key);
  if (last !== undefined && now - last < SUPPRESS_MS) return false;

  recent.set(key, now);
  // The map is bounded so a page throwing unique messages cannot grow it forever.
  if (recent.size > 50) {
    for (const [entry, at] of recent) {
      if (now - at > SUPPRESS_MS) recent.delete(entry);
    }
  }
  return true;
}

function report(payload: Record<string, unknown>): void {
  try {
    void fetch('/api/telemetry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'same-origin',
      keepalive: true,
    }).catch(() => {
      /* the sink being down must never itself throw */
    });
  } catch {
    /* ignore */
  }
}

export function ErrorReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      // A failed resource load fires an error event with no message on the
      // element, not on window — not a JS error, and not worth a row.
      if (!event.message && !event.error) return;
      if (!shouldReport(event.message)) return;

      report({
        message: event.message || 'Unknown error',
        source: event.filename || undefined,
        line: Number.isFinite(event.lineno) ? event.lineno : undefined,
        column: Number.isFinite(event.colno) ? event.colno : undefined,
        stack: event.error instanceof Error ? event.error.stack : undefined,
      });
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message =
        reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : 'Unhandled rejection';
      if (!shouldReport(message)) return;

      report({
        message: `Unhandled rejection: ${message}`,
        stack: reason instanceof Error ? reason.stack : undefined,
      });
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
