/** three's WebGLRenderer needs WebGL 2. */
export function hasWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}
