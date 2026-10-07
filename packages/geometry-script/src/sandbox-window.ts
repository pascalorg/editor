// three's `typeof window` guard: a worker has no window. Imported before three.
const scope = globalThis as unknown as Record<string, unknown>
if (scope.window === undefined) scope.window = globalThis
