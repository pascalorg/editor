/**
 * Configuration is read as `DIGITALTWIN_<NAME>`, falling back to the older
 * `PASCAL_<NAME>` so existing deployments keep working. Empty or whitespace
 * values count as unset — control panels often save a blank field rather than
 * omitting the variable.
 */
export function readEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  for (const key of [`DIGITALTWIN_${name}`, `PASCAL_${name}`]) {
    const value = env[key]?.trim()
    if (value) return value
  }
  return undefined
}
