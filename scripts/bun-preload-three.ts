import { resolveSync } from 'bun'

// three r186's CommonJS entry is `require('./three.module.js')`. Bun cannot
// require() an ES module that is still loading, and the R3F ecosystem (fiber,
// drei, maath, meshline, troika) ships CJS mains that require("three") while
// our sources import it as ESM — so a test file that imports both races and
// dies with "require() async module is unsupported". Evaluating three first
// turns the later require() into a cache hit. Resolve from the package under
// test, not from this file: with the isolated linker each package has its own
// link and this directory would walk up to a different copy. Packages that do
// not depend on three have nothing to pre-evaluate.
process.noDeprecation = true
let threePath: string | null = null
try {
  threePath = resolveSync('three', process.cwd())
} catch {}
if (threePath) await import(threePath)
