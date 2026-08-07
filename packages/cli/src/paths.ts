import os from 'node:os'
import path from 'node:path'

export interface PascalPaths {
  root: string
  runtime: string
  data: string
  plugins: string
  run: string
  logs: string
  state: string
  currentRuntime: string
  pluginLock: string
  database: string
  editorLog: string
  mcpToken: string
}

export function resolvePascalPaths(environment: NodeJS.ProcessEnv = process.env): PascalPaths {
  const root = path.resolve(environment.PASCAL_HOME || path.join(os.homedir(), '.pascal'))
  return {
    root,
    runtime: path.join(root, 'runtime'),
    data: path.join(root, 'data'),
    plugins: path.join(root, 'plugins'),
    run: path.join(root, 'run'),
    logs: path.join(root, 'logs'),
    state: path.join(root, 'run/editor.json'),
    currentRuntime: path.join(root, 'run/current-runtime.json'),
    pluginLock: path.join(root, 'pascal.plugins.lock'),
    database: path.join(root, 'data/pascal.db'),
    editorLog: path.join(root, 'logs/editor.log'),
    mcpToken: path.join(root, 'run/mcp-token'),
  }
}
