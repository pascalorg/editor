import { readFileSync } from 'node:fs'

export const version =
  process.env.PASCAL_MCP_VERSION ??
  (
    JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string
    }
  ).version
