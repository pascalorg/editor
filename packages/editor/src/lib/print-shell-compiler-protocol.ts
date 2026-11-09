import type { PrintShellCompileDiagnostic } from './print-shell-compiler-baseline'

export type ManifoldMeshData = {
  nodeId: string
  positions: Float32Array
  indices: Uint32Array
}

export type ManifoldCompileOutput =
  | {
      status: 'compiled'
      positions: Float32Array
      indices: Uint32Array
      diagnostics: PrintShellCompileDiagnostic[]
      durationMs: number
    }
  | {
      status: 'blocked'
      positions: null
      indices: null
      diagnostics: PrintShellCompileDiagnostic[]
      durationMs: number
    }

export type ManifoldRuntimeOptions = {
  /** URL of the manifold-3d emscripten glue module. Defaults to the pinned CDN copy. */
  moduleUrl?: string
  /** URL of manifold.wasm. Defaults to resolving relative to the glue module. */
  wasmUrl?: string
}

export type ManifoldWorkerRequest = {
  id: number
  meshes: ManifoldMeshData[]
  runtime?: ManifoldRuntimeOptions
}

export type ManifoldWorkerResponse = ManifoldCompileOutput & { id: number }
