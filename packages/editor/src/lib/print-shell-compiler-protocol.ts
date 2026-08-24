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

export type ManifoldWorkerRequest = {
  id: number
  meshes: ManifoldMeshData[]
}

export type ManifoldWorkerResponse = ManifoldCompileOutput & { id: number }
