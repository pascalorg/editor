'use client'

import { useSceneStore } from '@/lib/scenegraph/store' // Adjust path as needed

export function useSceneGraph() {
  const { scene, init, load, addNode, updateNode, flatList, getById, getByIdTyped } =
    useSceneStore()

  return {
    scene,
    init,
    load,
    addNode,
    updateNode,
    getFlatList: flatList,
    getNodeById: getById,
    getNodeByIdTyped,
  }
}

// Example usage in a component:
// import { useSceneGraph } from '@/hooks/use-scenegraph';
//
// const { addNode, getNodeByIdTyped } = useSceneGraph();
//
// const level = getNodeByIdTyped('level_xxxx', 'level');
// if (level) {
//   addNode(level.id, 'level', 'wall', { name: 'Wall_1', thickness: 0.2, height: 3 });
//   // addNode(level.id, 'level', 'building', { name: 'Building_2' }); // TS error: 'building' not allowed for 'level'
// }
