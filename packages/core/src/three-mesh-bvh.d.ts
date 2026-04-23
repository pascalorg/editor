import * as THREE from 'three';

declare module 'three' {
  interface BufferGeometry {
    computeBoundsTree(options?: {
      lazyGeneration?: boolean;
      maxLeafSize?: number;
      maxDepth?: number;
      verbose?: boolean;
    }): void;
    disposeBoundsTree(): void;
    boundsTree: any;
  }
}

declare module 'three-mesh-bvh' {
  export function computeBoundsTree(
    this: THREE.BufferGeometry,
    options?: {
      lazyGeneration?: boolean;
      maxLeafSize?: number;
      maxDepth?: number;
      verbose?: boolean;
    }
  ): void;
  export function disposeBoundsTree(this: THREE.BufferGeometry): void;
  export function acceleratedRaycast(
    this: THREE.Mesh | THREE.Line | THREE.Points,
    raycaster: THREE.Raycaster,
    intersects: THREE.Intersection[]
  ): void;
}
