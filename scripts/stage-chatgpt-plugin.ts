import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The repository root mcp.json is the local server that Codex Git-marketplace installs use.
// The ChatGPT directory package connects one remote server, so its root mcp.json is
// packaging/chatgpt/mcp.json instead; everything else is the same portable package.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'dist', 'chatgpt-plugin')
const files = [
  'plugin.json',
  'LICENSE',
  'skills',
  'assets/pascal-mark.svg',
  'assets/pascal-mark-plate.svg',
] as const

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
for (const file of files) {
  cpSync(join(root, file), join(out, file), { recursive: true })
}
cpSync(join(root, 'packaging', 'chatgpt', 'mcp.json'), join(out, 'mcp.json'))

const { version } = (await Bun.file(join(root, 'plugin.json')).json()) as { version: string }
const zip = join(root, 'dist', `pascal-agent-skills-${version}-chatgpt.zip`)
rmSync(zip, { force: true })
const zipped = Bun.spawnSync(['zip', '-qr', zip, '.'], { cwd: out })
if (zipped.success && existsSync(zip)) console.log(`Wrote ${zip}`)
else console.log(`Staged ${out}; zip its contents (not the folder) for upload.`)
