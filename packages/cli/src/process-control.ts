import { type ChildProcess, execFile } from 'node:child_process'
import net from 'node:net'
import { CliError } from './errors.js'

export function isProcessRunning(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export async function terminateProcess(pid: number): Promise<void> {
  try {
    process.kill(pid, 'SIGTERM')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return
    throw error
  }
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

export async function findAvailablePort(preferredPort: number): Promise<number> {
  if (!Number.isInteger(preferredPort) || preferredPort < 0 || preferredPort > 65_535) {
    throw new CliError('invalid_port', `Invalid port: ${preferredPort}`)
  }
  if (preferredPort === 0) return probePort(0)
  if (!(await isPortAcceptingConnections(preferredPort))) {
    try {
      return await probePort(preferredPort)
    } catch {}
  }
  return probePort(0)
}

async function isPortAcceptingConnections(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    let settled = false
    const finish = (result: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(250)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

async function probePort(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port }, () => {
      const address = server.address()
      const resolvedPort = typeof address === 'object' && address ? address.port : port
      server.close((error) => (error ? reject(error) : resolve(resolvedPort)))
    })
  })
}

export async function processCommand(pid: number): Promise<string> {
  return new Promise((resolve) => {
    execFile('ps', ['-ww', '-p', String(pid), '-o', 'command='], (error, stdout) => {
      resolve(error ? '' : stdout.trim())
    })
  })
}

export async function waitForSpawn(child: ChildProcess, binary: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  }).catch((error) => {
    throw new CliError('start_failed', `Unable to launch ${binary}: ${errorMessage(error)}`)
  })
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
