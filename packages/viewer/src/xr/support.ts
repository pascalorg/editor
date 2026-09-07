export type ImmersiveVRSupport = 'supported' | 'unsupported'

export async function getImmersiveVRSupport(): Promise<ImmersiveVRSupport> {
  if (typeof navigator === 'undefined' || !navigator.xr) return 'unsupported'

  try {
    return (await navigator.xr.isSessionSupported('immersive-vr')) ? 'supported' : 'unsupported'
  } catch {
    return 'unsupported'
  }
}
