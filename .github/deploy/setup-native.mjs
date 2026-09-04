// Turbopack requires an externalized native package under a build-specific
// hashed alias (e.g. "@node-rs/argon2-4d195bca84303183") but emits no package
// by that name. Recreate the alias as a symlink to the real install. Runs as
// the bundle's "build" step, i.e. right after npm install on the host.
import { readdirSync, readFileSync, mkdirSync, symlinkSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const chunks = join('.next', 'server', 'chunks')
const found = new Set()
for (const f of readdirSync(chunks)) {
  if (!f.endsWith('.js')) continue
  const m = readFileSync(join(chunks, f), 'utf8').matchAll(/@node-rs\/argon2-[a-f0-9]{16}/g)
  for (const hit of m) found.add(hit[0])
}
for (const alias of found) {
  const target = join('node_modules', alias)
  if (existsSync(target)) rmSync(target, { recursive: true })
  mkdirSync(join('node_modules', '@node-rs'), { recursive: true })
  symlinkSync('argon2', target)
  console.log(`[setup-native] ${alias} -> @node-rs/argon2`)
}
if (found.size === 0) console.log('[setup-native] no hashed native aliases found')
