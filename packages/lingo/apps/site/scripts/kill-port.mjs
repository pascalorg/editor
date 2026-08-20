import { spawnSync } from 'node:child_process'

// Default matches the dev default (3000). If Next auto-incremented onto
// another port, pass it explicitly: `bun kill 3001`.
const ports = process.argv.slice(2)
const targetPorts = ports.length > 0 ? ports : ['3000']

function pidsForPort(port) {
  const result = spawnSync('lsof', [`-tiTCP:${port}`, '-sTCP:LISTEN'], {
    encoding: 'utf8',
  })

  if (result.status !== 0 && !result.stdout.trim()) {
    return []
  }

  return result.stdout
    .split('\n')
    .map((pid) => pid.trim())
    .filter(Boolean)
}

for (const port of targetPorts) {
  const pids = pidsForPort(port)
  if (pids.length === 0) {
    console.log(`kill: no listener on port ${port}`)
    continue
  }

  console.log(`kill: stopping port ${port} (${pids.join(', ')})`)
  spawnSync('kill', ['-TERM', ...pids], { stdio: 'inherit' })

  await new Promise((resolve) => setTimeout(resolve, 400))

  const remaining = pidsForPort(port)
  if (remaining.length > 0) {
    console.log(`kill: force stopping port ${port} (${remaining.join(', ')})`)
    spawnSync('kill', ['-KILL', ...remaining], { stdio: 'inherit' })
  }
}
