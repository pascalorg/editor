import { DoubleSide, MeshBasicMaterial } from 'three'

export class PointerRingMaterial extends MeshBasicMaterial {
  constructor() {
    super({
      transparent: true,
      toneMapped: false,
      depthWrite: false,
      side: DoubleSide,
    })
  }
}
