import type { Camera, Object3D, WebGPURenderer } from 'three/webgpu'

/**
 * R3F types `state.gl` as `THREE.WebGLRenderer`, but this viewer always drives
 * a `WebGPURenderer` (created by the async `gl` factory in the `<Viewer>`).
 * The two renderer classes are unrelated in the type hierarchy, so the runtime
 * value never structurally overlaps R3F's declared type — a single `unknown`
 * bridge is unavoidable. Centralising it here keeps every WebGPU-specific
 * access (`backend.device.queue`, `setClearAlpha`, direct `render`) strongly
 * typed against `WebGPURendererLike` instead of scattering loose casts.
 */
export type WebGPUDeviceLike = {
  lost: Promise<{ reason?: string; message?: string }>
  label?: string
  features?: Set<string>
  queue?: { onSubmittedWorkDone?: () => Promise<void> }
  addEventListener?: (type: string, listener: EventListener) => void
  removeEventListener?: (type: string, listener: EventListener) => void
}

export type WebGPURendererLike = WebGPURenderer & {
  backend?: { device?: WebGPUDeviceLike }
  setClearAlpha?: (alpha: number) => void
  render(scene: Object3D, camera: Camera): void
}

/**
 * Narrow R3F's `gl` handle to the WebGPU renderer surface this viewer uses.
 * `renderer` is typed `unknown` so callers pass R3F's mistyped `gl` directly.
 */
export function asWebGPURenderer(renderer: unknown): WebGPURendererLike {
  return renderer as WebGPURendererLike
}
