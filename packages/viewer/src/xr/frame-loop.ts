export type XRFrameLoopRenderer = {
  setAnimationLoop(callback: XRFrameRequestCallback | null): Promise<void> | void
  setPixelRatio(dpr: number): void
  setSize(width: number, height: number, updateStyle?: boolean): void
  xr: {
    enabled: boolean
    isPresenting: boolean
  }
}

type XRViewport = {
  dpr: number
  height: number
  width: number
}

type R3FXRConnection = {
  disconnect(): void
}

type XRRenderDriverRenderer = {
  render(scene: unknown, camera: unknown): void
  xr: {
    cameraAutoUpdate: boolean
    getCamera(): unknown
    updateCamera(camera: unknown): void
  }
}

export function shouldPauseFrameLimiterForXR(paused: boolean, session?: XRSession) {
  return paused || session != null
}

export function shouldMountPostProcessingRenderDriver(immersiveXR: boolean) {
  return !immersiveXR
}

export function renderImmersiveXRFrame(
  renderer: XRRenderDriverRenderer,
  scene: unknown,
  camera: unknown,
) {
  renderer.xr.updateCamera(camera)
  const cameraAutoUpdate = renderer.xr.cameraAutoUpdate
  renderer.xr.cameraAutoUpdate = false
  try {
    renderer.render(scene, renderer.xr.getCamera())
  } finally {
    renderer.xr.cameraAutoUpdate = cameraAutoUpdate
  }
}

export async function takeOverXRFrameLoop(
  renderer: XRFrameLoopRenderer,
  r3fXR: R3FXRConnection | null,
  renderFrame: XRFrameRequestCallback,
  viewport: XRViewport,
) {
  // R3F 9.6 still drives the legacy WebGL XR manager. Three's unified
  // renderer owns its XR loop instead, so the viewer supplies R3F's frame
  // callback through the renderer and disconnects the incompatible listener.
  r3fXR?.disconnect()
  renderer.setPixelRatio(viewport.dpr)
  renderer.setSize(viewport.width, viewport.height, false)
  renderer.xr.enabled = true
  await renderer.setAnimationLoop(renderFrame)

  return () => {
    if (renderer.xr.isPresenting) return
    renderer.xr.enabled = false
    void renderer.setAnimationLoop(null)
  }
}

export function stopXRFrameLoop(renderer: XRFrameLoopRenderer) {
  renderer.xr.enabled = false
  void renderer.setAnimationLoop(null)
}
