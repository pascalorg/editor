/**
 * The package version, for the server's handshake. Read from package.json
 * at runtime under Node (and Bun) without a static `node:fs` import, so the
 * server entry also bundles for the browser, where the editor runs it in-page.
 */
export const version =
  (typeof process !== 'undefined' && process.env?.PASCAL_MCP_VERSION) || readVersion()

function readVersion(): string {
  try {
    const fs = (
      globalThis as {
        process?: {
          getBuiltinModule?: (id: string) => { readFileSync: (p: URL, e: string) => string }
        }
      }
    ).process?.getBuiltinModule?.('node:fs')
    if (!fs) return '0.0.0'
    return (
      JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
        version: string
      }
    ).version
  } catch {
    return '0.0.0'
  }
}
