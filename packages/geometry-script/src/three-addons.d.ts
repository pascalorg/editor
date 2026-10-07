// three r186 ships LoftGeometry; @types/three is pinned to 0.184 (tsgo OOM on 0.185+).
declare module 'three/examples/jsm/geometries/LoftGeometry.js' {
  import { BufferGeometry, type Vector3 } from 'three'
  export class LoftGeometry extends BufferGeometry {
    constructor(
      sections?: Vector3[][],
      options?: { closed?: boolean; capStart?: boolean; capEnd?: boolean },
    )
  }
}
