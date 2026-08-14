import { MeshStandardMaterial } from 'three'

/** The beam's concrete body reads as a structural element, like a wall's core. */
let shared: MeshStandardMaterial | undefined

export function beamMaterial(): MeshStandardMaterial {
  shared ??= new MeshStandardMaterial({ color: '#9a9a94' })
  return shared
}
