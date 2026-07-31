import { getSession } from '@panel/lib/auth/session';
import { jobsFingerprint, listJobs, startJobWorker } from '@panel/lib/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const POLL_MS = 1000;
const HEARTBEAT_MS = 15_000;

/**
 * GET /api/jobs/stream — live queue over SSE, with the client falling back to a
 * 4 s poll if the stream cannot be opened.
 *
 * The payload is only pushed when the fingerprint changes, so an idle queue
 * costs one heartbeat comment every 15 s rather than a list per second.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session || session.mfaPending) {
    return new Response('unauthorized', { status: 401 });
  }

  startJobWorker();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let lastFingerprint = '';
      let lastBeat = Date.now();
      let closed = false;

      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* already closed by the client */
        }
      };

      // The abort signal is the only reliable close notice — a disconnected
      // client does not error the enqueue until much later.
      request.signal.addEventListener('abort', stop);

      const timer = setInterval(() => {
        if (closed) return;
        void (async () => {
          try {
            const fingerprint = await jobsFingerprint();
            if (fingerprint !== lastFingerprint) {
              lastFingerprint = fingerprint;
              send('jobs', { jobs: await listJobs() });
              lastBeat = Date.now();
              return;
            }
            if (Date.now() - lastBeat >= HEARTBEAT_MS) {
              controller.enqueue(encoder.encode(': keep-alive\n\n'));
              lastBeat = Date.now();
            }
          } catch {
            stop();
          }
        })();
      }, POLL_MS);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Proxies that buffer will otherwise hold the whole stream back.
      'x-accel-buffering': 'no',
    },
  });
}
