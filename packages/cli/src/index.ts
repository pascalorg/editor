export { collectInfo, type DiagnosticCheck, runDoctor } from './diagnostics.js'
export {
  activateEditorRuntime,
  type EditorState,
  type EditorStatus,
  ensurePascalDirectories,
  getEditorStatus,
  type RuntimeActivationResult,
  restartEditor,
  type StopEditorOptions,
  startEditor,
  stopEditor,
} from './editor-process.js'
export { CliError } from './errors.js'
export {
  ensureMcpService,
  getMcpServiceStatus,
  type McpServiceState,
  type McpServiceStatus,
  stopMcpService,
} from './mcp-service.js'
export { type PascalPaths, resolvePascalPaths } from './paths.js'
export {
  type ActiveRuntime,
  installBundledRuntime,
  type RuntimeManifest,
  readActiveRuntime,
  readRuntimeManifest,
} from './runtime.js'
export {
  ensureWebRuntime,
  type RuntimeSource,
  readRuntimeSource,
  verifyArchiveDigest,
} from './runtime-download.js'
export { version } from './version.js'
