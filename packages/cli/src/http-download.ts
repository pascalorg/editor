import { createWriteStream } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import type { Socket } from 'node:net'
import tls from 'node:tls'
import { CliError } from './errors.js'
import { version } from './version.js'

const DEFAULT_TIMEOUT_MS = 60_000
const MAX_REDIRECTS = 5
const PROGRESS_INTERVAL_MS = 200

export interface DownloadProgress {
  received: number
  total: number | null
}

export interface DownloadOptions {
  environment?: NodeJS.ProcessEnv
  onProgress?: (progress: DownloadProgress) => void
  timeoutMs?: number
}

/**
 * Streams an HTTPS URL to disk without adding a dependency. Node's built-in `fetch` only
 * honours `HTTPS_PROXY` when the process was started with `--use-env-proxy`, which a
 * published CLI cannot retrofit onto its own entrypoint, so the proxy tunnel is explicit.
 */
export async function downloadToFile(
  url: string,
  destination: string,
  options: DownloadOptions = {},
): Promise<number> {
  const environment = options.environment ?? process.env
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let target = parseHttpsUrl(url)
  for (let redirect = 0; ; redirect += 1) {
    const response = await requestOnce(target, environment, timeoutMs)
    const status = response.statusCode ?? 0
    if (status >= 300 && status < 400 && response.headers.location) {
      response.resume()
      if (redirect >= MAX_REDIRECTS) {
        throw new CliError('download_failed', `${url} redirected more than ${MAX_REDIRECTS} times.`)
      }
      target = parseHttpsUrl(new URL(response.headers.location, target).toString())
      continue
    }
    if (status !== 200) {
      response.resume()
      throw new CliError('download_failed', `${target.href} returned HTTP ${status}.`)
    }
    return writeResponse(response, destination, options.onProgress)
  }
}

export function resolveProxyUrl(target: URL, environment: NodeJS.ProcessEnv): string | null {
  if (isProxyBypassed(target.hostname, environment.NO_PROXY ?? environment.no_proxy)) return null
  const configured =
    environment.HTTPS_PROXY ??
    environment.https_proxy ??
    environment.ALL_PROXY ??
    environment.all_proxy
  return configured?.trim() ? configured.trim() : null
}

export function isProxyBypassed(hostname: string, noProxy: string | undefined): boolean {
  if (!noProxy?.trim()) return false
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  for (const raw of noProxy.split(/[,\s]+/)) {
    const entry = raw.trim().toLowerCase()
    if (!entry) continue
    if (entry === '*') return true
    const pattern = entry.replace(/^\*/, '').replace(/^\./, '').replace(/:\d+$/, '')
    if (!pattern) continue
    if (host === pattern || host.endsWith(`.${pattern}`)) return true
  }
  return false
}

function parseHttpsUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new CliError('download_failed', `Invalid download URL: ${value}`)
  }
  if (url.protocol !== 'https:') {
    throw new CliError('download_failed', `Only https downloads are supported: ${value}`)
  }
  return url
}

async function requestOnce(
  target: URL,
  environment: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<http.IncomingMessage> {
  const proxy = resolveProxyUrl(target, environment)
  const agent = proxy
    ? new TunnelAgent(
        await openProxyTunnel(parseProxyUrl(proxy), target, timeoutMs),
        target.hostname,
      )
    : undefined
  const request = https.request({
    hostname: target.hostname,
    port: target.port || 443,
    path: `${target.pathname}${target.search}`,
    method: 'GET',
    headers: {
      accept: 'application/octet-stream, */*',
      'accept-encoding': 'identity',
      'user-agent': `pascal-cli/${version}`,
    },
    ...(agent ? { agent } : {}),
  })
  request.setTimeout(timeoutMs, () =>
    request.destroy(new Error(`no response from ${target.host} within ${timeoutMs}ms`)),
  )
  request.end()
  return new Promise<http.IncomingMessage>((resolve, reject) => {
    request.once('response', resolve)
    request.once('error', (error) =>
      reject(new CliError('download_failed', `Unable to reach ${target.href}: ${error.message}`)),
    )
  })
}

async function writeResponse(
  response: http.IncomingMessage,
  destination: string,
  onProgress: ((progress: DownloadProgress) => void) | undefined,
): Promise<number> {
  const declared = Number(response.headers['content-length'])
  const total = Number.isFinite(declared) && declared > 0 ? declared : null
  const file = createWriteStream(destination, { mode: 0o600 })
  let received = 0
  let lastReport = 0
  await new Promise<void>((resolve, reject) => {
    const fail = (error: Error) => {
      response.destroy()
      file.destroy()
      reject(error)
    }
    response.on('data', (chunk: Buffer) => {
      received += chunk.byteLength
      if (!file.write(chunk)) response.pause()
      const now = Date.now()
      if (onProgress && now - lastReport >= PROGRESS_INTERVAL_MS) {
        lastReport = now
        onProgress({ received, total })
      }
    })
    file.on('drain', () => response.resume())
    response.once('error', fail)
    file.once('error', fail)
    response.once('end', () => file.end(resolve))
  })
  onProgress?.({ received, total })
  return received
}

function parseProxyUrl(value: string): URL {
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`
  let proxy: URL
  try {
    proxy = new URL(candidate)
  } catch {
    throw new CliError('download_failed', `Invalid proxy URL: ${value}`)
  }
  if (proxy.protocol !== 'http:' && proxy.protocol !== 'https:') {
    throw new CliError('download_failed', `Unsupported proxy protocol: ${proxy.protocol}`)
  }
  return proxy
}

async function openProxyTunnel(proxy: URL, target: URL, timeoutMs: number): Promise<Socket> {
  const authority = `${target.hostname}:${target.port || 443}`
  const headers: Record<string, string> = { host: authority }
  if (proxy.username) {
    const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`
    headers['proxy-authorization'] = `Basic ${Buffer.from(credentials).toString('base64')}`
  }
  const requestFn = proxy.protocol === 'https:' ? https.request : http.request
  const request = requestFn({
    host: proxy.hostname,
    port: proxy.port || (proxy.protocol === 'https:' ? 443 : 80),
    method: 'CONNECT',
    path: authority,
    headers,
  })
  request.setTimeout(timeoutMs, () =>
    request.destroy(new Error(`proxy ${proxy.host} did not answer CONNECT within ${timeoutMs}ms`)),
  )
  request.end()
  return new Promise<Socket>((resolve, reject) => {
    request.once('connect', (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy()
        reject(
          new CliError(
            'download_failed',
            `Proxy ${proxy.host} refused CONNECT ${authority} with HTTP ${response.statusCode}.`,
          ),
        )
        return
      }
      resolve(socket)
    })
    request.once('error', (error) =>
      reject(
        new CliError('download_failed', `Unable to reach proxy ${proxy.host}: ${error.message}`),
      ),
    )
  })
}

class TunnelAgent extends https.Agent {
  private readonly tunnel: Socket
  private readonly servername: string

  constructor(tunnel: Socket, servername: string) {
    super({ keepAlive: false, maxSockets: 1 })
    this.tunnel = tunnel
    this.servername = servername
  }

  override createConnection(): tls.TLSSocket {
    return tls.connect({
      socket: this.tunnel,
      servername: this.servername,
      ALPNProtocols: ['http/1.1'],
    })
  }
}
