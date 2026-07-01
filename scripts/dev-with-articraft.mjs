import { spawn, execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const articraftRoot = path.join(repoRoot, 'articraft')

const editorHost = process.env.EDITOR_HOST ?? '127.0.0.1'
const editorPort = process.env.EDITOR_PORT ?? '3002'
const articraftHost = process.env.ARTICRAFT_VIEWER_HOST ?? '127.0.0.1'
const articraftPort = process.env.ARTICRAFT_VIEWER_PORT ?? '8765'
const args = new Set(process.argv.slice(2))
const startEditor = !args.has('--no-editor') && process.env.START_EDITOR !== '0'
const startArticraft = !args.has('--no-articraft') && process.env.START_ARTICRAFT !== '0'
const editorPublicUrl = process.env.NEXT_PUBLIC_EDITOR_URL ?? `http://${editorHost}:${editorPort}`
const assetsCdnUrl = process.env.NEXT_PUBLIC_ASSETS_CDN_URL ?? ''

const children = new Set()
const trackedPids = new Set()
let shuttingDown = false

function prefixOutput(name, stream, output) {
  output.on('data', (chunk) => {
    const text = chunk.toString()
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) stream.write(`[${name}] ${line}\n`)
    }
  })
}

function startProcess(name, command, args, cwd, env = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    windowsHide: true,
  })

  children.add(child)
  prefixOutput(name, process.stdout, child.stdout)
  prefixOutput(name, process.stderr, child.stderr)

  child.on('exit', (code, signal) => {
    children.delete(child)
    if (shuttingDown) return

    console.error(`[${name}] exited with ${signal ?? `code ${code}`}`)
    shutdown(code ?? 1)
  })

  child.on('error', (err) => {
    children.delete(child)
    if (shuttingDown) return

    console.error(`[${name}] failed to start: ${err.message}`)
    shutdown(1)
  })

  return child
}

function killPid(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' })
    } else {
      process.kill(pid, 'SIGTERM')
    }
    return true
  } catch {
    return false
  }
}

function findPidOnPort(port) {
  try {
    if (process.platform === 'win32') {
      const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' })
      const lines = output.trim().split(/\r?\n/)
      for (const line of lines) {
        if (line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/)
          const pid = parseInt(parts[parts.length - 1], 10)
          if (!isNaN(pid) && pid !== 0 && pid !== process.pid) return pid
        }
      }
    } else {
      const output = execSync(`lsof -ti :${port}`, { encoding: 'utf8' })
      const pid = parseInt(output.trim(), 10)
      if (!isNaN(pid) && pid !== process.pid) return pid
    }
  } catch {
    // Port is free or lookup failed
  }
  return null
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true

  // Kill self-launched child processes
  for (const child of children) {
    child.kill('SIGTERM')
  }

  // Kill reused external processes we adopted
  for (const pid of trackedPids) {
    killPid(pid)
  }

  setTimeout(() => {
    for (const child of children) {
      child.kill('SIGKILL')
    }
    for (const pid of trackedPids) {
      killPid(pid)
    }
    process.exit(exitCode)
  }, 1500).unref()
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

async function isHttpReady(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)

  try {
    const response = await fetch(url, { signal: controller.signal })
    return response.status >= 200 && response.status < 400
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

async function ensurePortReady(name, host, port, healthUrl) {
  // HTTP healthy → reuse and track the PID for cleanup
  if (await isHttpReady(healthUrl)) {
    console.log(`[${name}] Reusing existing server on ${healthUrl}`)
    const pid = findPidOnPort(port)
    if (pid) trackedPids.add(pid)
    return 'reused'
  }

  // Port occupied but HTTP unhealthy → kill the stale process
  const stalePid = findPidOnPort(port)
  if (stalePid) {
    console.log(`[${name}] Port ${port} occupied by stale process (PID ${stalePid}), killing...`)
    killPid(stalePid)
    await new Promise((r) => setTimeout(r, 500))
  }

  return 'start'
}

function keepAliveForReusedServices() {
  console.log('All requested services are already running. Press Ctrl+C to stop all managed services.')
  setInterval(() => {}, 2 ** 31 - 1)
}

function articraftViewerCommand() {
  const venvPython = path.join(
    articraftRoot,
    '.venv',
    process.platform === 'win32' ? 'Scripts' : 'bin',
    process.platform === 'win32' ? 'python.exe' : 'python',
  )
  const cliEntry = path.join(articraftRoot, 'cli', 'main.py')
  if (existsSync(venvPython) && existsSync(cliEntry)) {
    return {
      command: venvPython,
      args: [cliEntry, 'viewer', '--host', articraftHost, '--port', articraftPort],
    }
  }
  return {
    command: 'uv',
    args: ['run', '--frozen', 'articraft', 'viewer', '--host', articraftHost, '--port', articraftPort],
  }
}

async function main() {
  const editorUrl = `http://${editorHost}:${editorPort}`
  const articraftUrl = `http://${articraftHost}:${articraftPort}/viewer`

  console.log(`Pascal editor:      ${editorUrl}`)
  console.log(`Articraft viewer:   ${articraftUrl}`)
  console.log('')

  let launched = 0

  if (startEditor) {
    const result = await ensurePortReady('editor', editorHost, editorPort, editorUrl)
    if (result === 'start') {
      launched++
      startProcess(
        'editor',
        'bun',
        ['--cwd', 'apps/editor', 'dev'],
        repoRoot,
        {
          PORT: editorPort,
          NEXT_PUBLIC_ARTICRAFT_VIEWER_URL: `http://${articraftHost}:${articraftPort}`,
          NEXT_PUBLIC_ASSETS_CDN_URL: assetsCdnUrl,
        },
      )
    } else {
      console.log(
        `[editor] Existing editor keeps the environment it was started with. If the Articraft modal still points at the wrong port, restart the editor so NEXT_PUBLIC_ARTICRAFT_VIEWER_URL=http://${articraftHost}:${articraftPort} is applied.`,
      )
    }
  } else {
    console.log('[editor] Skipped')
  }

  if (startArticraft) {
    const result = await ensurePortReady('articraft', articraftHost, articraftPort, articraftUrl)
    if (result === 'start') {
      launched++
      const viewer = articraftViewerCommand()
      startProcess(
        'articraft',
        viewer.command,
        viewer.args,
        articraftRoot,
      )
    }
  } else {
    console.log('[articraft] Skipped')
  }

  if (launched === 0) {
    keepAliveForReusedServices()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  shutdown(1)
})
