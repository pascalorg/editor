import { compileManifoldMeshData } from './print-shell-compiler-manifold-core'
import type { ManifoldWorkerRequest, ManifoldWorkerResponse } from './print-shell-compiler-protocol'

const workerScope = self as unknown as {
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<ManifoldWorkerRequest>) => void,
  ) => void
  postMessage: (response: ManifoldWorkerResponse, transfer: Transferable[]) => void
}

workerScope.addEventListener('message', async (event) => {
  const output = await compileManifoldMeshData(event.data.meshes)
  const response: ManifoldWorkerResponse = { id: event.data.id, ...output }
  const transfer: Transferable[] = []
  if (response.status === 'compiled') {
    transfer.push(response.positions.buffer as ArrayBuffer, response.indices.buffer as ArrayBuffer)
  }
  workerScope.postMessage(response, transfer)
})
