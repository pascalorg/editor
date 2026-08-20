import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const dirs = ['.next', '.next-dev', '.next-build']

for (const dir of dirs) {
  const path = resolve(process.cwd(), dir)
  if (!existsSync(path)) {
    console.log(`clean: ${dir} not present`)
    continue
  }

  rmSync(path, { recursive: true, force: true })
  console.log(`clean: removed ${dir}`)
}
