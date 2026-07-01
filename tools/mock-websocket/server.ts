import signals from './signals.json'
import type { ServerWebSocket } from 'bun'

type SignalType = 'number' | 'boolean' | 'string'
type SignalWave = 'sine' | 'toggle' | 'cycle'
type SignalDefinition = {
  path: string
  label: string
  type: SignalType
  unit?: string
  min?: number
  max?: number
  values?: string[]
  category?: string
  wave?: SignalWave
  periodMs?: number
}

type Snapshot = {
  ts: number
  seq: number
  values: Record<string, string | number | boolean | null>
}

const definitions = signals as SignalDefinition[]
const port = Number(Bun.env.MOCK_WS_PORT ?? 3102)
const startedAt = Date.now()
let seq = 0
const clients = new Set<ServerWebSocket<unknown>>()

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'content-type': 'application/json; charset=utf-8',
    },
  })
}

function valueForSignal(signal: SignalDefinition, now: number) {
  const elapsed = now - startedAt
  const period = Math.max(500, signal.periodMs ?? 5000)
  const phase = (elapsed % period) / period

  if (signal.type === 'boolean') {
    return phase < 0.65
  }

  if (signal.type === 'string') {
    const values = signal.values?.length ? signal.values : ['normal', 'warning', 'error']
    return values[Math.floor(phase * values.length) % values.length] ?? values[0] ?? null
  }

  const min = signal.min ?? 0
  const max = signal.max ?? 100
  const ratio =
    signal.wave === 'toggle'
      ? phase < 0.5
        ? 0
        : 1
      : 0.5 + Math.sin(phase * Math.PI * 2) * 0.5
  return Number((min + (max - min) * ratio).toFixed(2))
}

function snapshot(): Snapshot {
  const now = Date.now()
  seq += 1
  return {
    ts: now,
    seq,
    values: Object.fromEntries(definitions.map((signal) => [signal.path, valueForSignal(signal, now)])),
  }
}

const server = Bun.serve({
  port,
  fetch(req, server) {
    const url = new URL(req.url)

    if (req.method === 'OPTIONS') return json({})

    if (url.pathname === '/ws') {
      if (server.upgrade(req)) return undefined
      return json({ error: 'WebSocket upgrade failed' }, 400)
    }

    if (url.pathname === '/health') {
      return json({ ok: true, service: 'pascal-mock-websocket', clients: clients.size })
    }

    if (url.pathname === '/paths') {
      return json(
        definitions.map(({ wave: _wave, periodMs: _periodMs, ...definition }) => definition),
      )
    }

    if (url.pathname === '/snapshot') {
      return json(snapshot())
    }

    return json({ error: 'Not found' }, 404)
  },
  websocket: {
    open(ws) {
      clients.add(ws)
      ws.send(JSON.stringify(snapshot()))
    },
    close(ws) {
      clients.delete(ws)
    },
  },
})

setInterval(() => {
  if (clients.size === 0) return
  const frame = JSON.stringify(snapshot())
  for (const client of clients) client.send(frame)
}, Number(Bun.env.MOCK_WS_INTERVAL_MS ?? 1000))

console.log(`[pascal mock websocket] http://localhost:${server.port}`)
console.log(`[pascal mock websocket] ws://localhost:${server.port}/ws`)
