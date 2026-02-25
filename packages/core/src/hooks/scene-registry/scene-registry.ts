import { useLayoutEffect } from "react";
import type * as THREE from "three";

export const sceneRegistry = {
  // Master lookup: ID -> Object3D
  nodes: new Map<string, THREE.Object3D>(),

  // Categorized lookups: Type -> Set of IDs
  // Using a Set is faster for adding/deleting than an Array
  byType: {
    site: new Set<string>(),
    building: new Set<string>(),
    ceiling: new Set<string>(),
    level: new Set<string>(),
    wall: new Set<string>(),
    item: new Set<string>(),
    slab: new Set<string>(),
    zone: new Set<string>(),
    roof: new Set<string>(),
    scan: new Set<string>(),
    guide: new Set<string>(),
    window: new Set<string>(),
    door: new Set<string>(),
  },
};

export function useRegistry(
  id: string,
  type: keyof typeof sceneRegistry.byType,
  ref: React.RefObject<THREE.Object3D>,
) {
  useLayoutEffect(() => {
    const obj = ref.current;
    if (!obj) return;

    // 1. Add to master map
    sceneRegistry.nodes.set(id, obj);

    // 2. Add to type-specific set
    sceneRegistry.byType[type].add(id);

    // 4. Cleanup when component unmounts
    return () => {
      sceneRegistry.nodes.delete(id);
      sceneRegistry.byType[type].delete(id);
    };
  }, [id, type, ref]);
}
