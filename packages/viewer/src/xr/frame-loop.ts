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

type XRUnionCamera = {
  cameras?: { layers?: { mask: number } }[]
  layers?: { mask: number }
  parent?: unknown | null
}

type XRBaseCamera = {
  parent?: unknown | null
}

type R3FFrameState = {
  internal: { priority: number }
}

export function advanceXRFrameWithoutDesktopRender(state: R3FFrameState, advanceFrame: () => void) {
  const renderPriority = state.internal.priority
  state.internal.priority = renderPriority + 1
  try {
    advanceFrame()
  } finally {
    state.internal.priority = renderPriority
  }
}

export function unifyXRStereoCameraLayers(camera: XRUnionCamera) {
  const mask = camera.layers?.mask
  if (mask === undefined) return
  // Three reserves layers 1 and 2 for left/right-eye visibility and removes
  // one from each sub-camera. Pascal uses those layers for overlays and zones,
  // so direct immersive presentation must render the union in both eyes.
  for (const subCamera of camera.cameras ?? []) {
    if (subCamera.layers) subCamera.layers.mask = mask
  }
}

export function shouldPauseFrameLimiterForXR(paused: boolean, session?: XRSession) {
  return paused || session != null
}

export function ownsXRFrameLoopBinding(activeBinding: symbol | null, binding: symbol) {
  return activeBinding === binding
}

export function shouldMountPostProcessingRenderDriver(immersiveXR: boolean) {
  return !immersiveXR
}

export function renderImmersiveXRFrame(
  renderer: XRRenderDriverRenderer,
  scene: unknown,
  camera: unknown,
) {
  const xrCamera = renderer.xr.getCamera() as XRUnionCamera
  const baseCamera = camera as XRBaseCamera
  const originalParent = baseCamera.parent

  // Three derives the stereo eye matrices from the parent of the application
  // camera passed to updateCamera(). During our renderer-owned XR loop that is
  // the preserved desktop camera, while <XROrigin> parents the XR ArrayCamera.
  // Borrow the ArrayCamera's origin only for the update so tracked inputs and
  // both eyes are evaluated in the same world space.
  if (xrCamera.parent != null) baseCamera.parent = xrCamera.parent
  try {
    renderer.xr.updateCamera(camera)
  } finally {
    baseCamera.parent = originalParent
  }
  unifyXRStereoCameraLayers(xrCamera)
  const cameraAutoUpdate = renderer.xr.cameraAutoUpdate
  renderer.xr.cameraAutoUpdate = false
  try {
    // Pass the application's base camera. With cameraAutoUpdate disabled the
    // renderer's XR path substitutes the already-updated stereo camera itself;
    // passing that ArrayCamera back as the base camera corrupts the second eye.
    renderer.render(scene, camera)
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
