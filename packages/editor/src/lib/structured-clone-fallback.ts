/**
 * `@pascal-app/lingo` builds its unit registry at module-eval time, and
 * `registerKind` deep-copies each kind definition with `structuredClone`. On a
 * browser without that global (Chromium <98 — reported from Honor Browser 9.8
 * as `ReferenceError: structuredClone is not defined`) the throw happens while
 * the module graph is still evaluating, so a component-level guard can never
 * run in time and the whole editor bundle fails to load.
 *
 * This has to be imported for its side effect from the module that pulls lingo
 * in, so it is installed wherever `@pascal-app/editor` is loaded — the OSS app,
 * the hosted app, and any npm consumer. An app-level polyfill would only cover
 * the app that declares it.
 *
 * Scoped deliberately narrowly: the kind definitions lingo clones are plain
 * JSON (strings, numbers, arrays of those), so a JSON round-trip is sufficient
 * and avoids a dependency. This is NOT a spec-compliant `structuredClone` — it
 * has no support for Map/Set/Date/ArrayBuffer/cycles and throws a `TypeError`
 * rather than a `DataCloneError`. Anything needing real structured-clone
 * semantics must not rely on this shim.
 */
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = (<T>(value: T): T =>
    JSON.parse(JSON.stringify(value)) as T) as typeof structuredClone
}
