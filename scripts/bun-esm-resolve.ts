import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { plugin } from 'bun'

// three r186 turned its CommonJS entry into a re-export of the ES module. Bun
// cannot require() an ES module that the same process is also importing, so
// the R3F packages that ship no `exports` map (Bun then takes their CJS `main`)
// blow up the moment ESM code imports three alongside them. Steer them to the
// `module` build, which is what every bundler already does. Bun applies this
// to `bun test`; plain `bun <file>` skips plugin resolution for static imports.
const CJS_MAIN_THREE_CONSUMERS = /^(@react-three\/fiber|@react-three\/drei|maath|meshline)$/

plugin({
  name: 'prefer-esm-three-consumers',
  setup(build) {
    build.onResolve({ filter: CJS_MAIN_THREE_CONSUMERS }, (args) => {
      const from = args.importer ? dirname(args.importer) : process.cwd()
      const manifestPath = Bun.resolveSync(`${args.path}/package.json`, from)
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { module?: string }
      return manifest.module ? { path: join(dirname(manifestPath), manifest.module) } : undefined
    })
  },
})
