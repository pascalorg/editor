import { afterEach, beforeEach } from 'bun:test'
import { nodeRegistry } from './src/registry/registry'

// bun runs every test file of this package in one process, in filesystem
// order, which differs between machines and shifts whenever a file is added.
// A test that registers a stub kind (or `_reset()`s) and does not restore
// leaks it into whichever files happen to run next: a stub `wall` with a
// one-field schema made `verify_scene` accept malformed walls on CI only.
// Preload hooks wrap every test's own hooks, so this undoes any registry
// change made by a test or its `beforeEach`. File-scope registrations (top
// level, `beforeAll`) still need their own `_snapshot()` / `afterAll`.
let restoreRegistry = () => {}

beforeEach(() => {
  restoreRegistry = nodeRegistry._snapshot()
})

afterEach(() => {
  restoreRegistry()
})
