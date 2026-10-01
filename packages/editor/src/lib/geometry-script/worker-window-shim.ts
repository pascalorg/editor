// Turbopack compiles worker modules as browser code and folds three's
// `typeof window !== 'undefined'` guard to true, so `window` must exist before
// three evaluates. Imported first by the worker.
const scope = globalThis as { window?: unknown }
if (scope.window === undefined) scope.window = globalThis
