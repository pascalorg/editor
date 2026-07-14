/**
 * Test-only boundary helper. Tests construct partial or deliberately-invalid
 * stubs that the compiler can't structurally verify against the target type
 * (e.g. a minimal node stub fed to code that expects a full `AnyNode`, or an
 * out-of-range value fed to a runtime validator). Routing them through this
 * single `unknown`-typed helper keeps the coercion in one named place instead
 * of scattering `as unknown as T` casts across every test file.
 */
export function coerce<T>(value: unknown): T {
  return value as T
}
