// `bun kill` — stop lingo dev processes (house pattern, adapted):
//   1. listeners on the dev ports 3000-3003 (site default + auto-increments),
//   2. tsup --watch processes whose cwd is inside THIS repo (the library
//      watcher holds no port, so a pure port sweep strands it; the cwd check
//      keeps us from killing another repo's watcher).
// Killing the children makes a lingering `turbo run dev` parent exit on its own.
import { spawnSync } from 'node:child_process'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const PORTS = '3000,3001,3002,3003'

function lines(cmd, args) {
  const out = spawnSync(cmd, args, { encoding: 'utf8' }).stdout ?? ''
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

const portPids = lines('lsof', [`-ti:${PORTS}`])
const watcherPids = lines('pgrep', ['-f', 'tsup --watch']).filter((pid) => {
  const cwd = spawnSync('lsof', ['-p', pid, '-a', '-d', 'cwd', '-Fn'], {
    encoding: 'utf8',
  }).stdout
  return cwd.includes(ROOT)
})

const pids = [...new Set([...portPids, ...watcherPids])]
if (pids.length === 0) {
  console.log(`kill: no processes on ports ${PORTS}, no lingo watchers`)
  process.exit(0)
}

if (portPids.length > 0) {
  console.log(`kill: ports ${PORTS} → ${portPids.join(', ')}`)
}
if (watcherPids.length > 0) {
  console.log(`kill: lingo tsup watcher → ${watcherPids.join(', ')}`)
}
spawnSync('kill', ['-9', ...pids], { stdio: 'inherit' })
