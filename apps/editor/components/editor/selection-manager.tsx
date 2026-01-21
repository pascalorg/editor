import {
  emitter,
  type ItemNode,
  sceneRegistry,
  useScene,
  type WallNode,
} from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";

import { useEffect, useRef } from "react";

export const SelectionManager = () => {
  const selectedItemId = useRef<ItemNode["id"] | WallNode["id"]>(null);
  const itemSelectedAt = useRef<number>(0);
  useEffect(() => {
    emitter.on("building:enter", (event) => {
      // console.log("Entered building:", event.node.id);
      const itemMesh = sceneRegistry.nodes.get(event.node.id);
      useViewer.getState().outliner.hoveredObjects.length = 0;
      useViewer.getState().outliner.hoveredObjects.push(itemMesh);
    });
    emitter.on("building:leave", (event) => {
      // console.log("Leaving building:", event.node.id);
      useViewer.getState().outliner.hoveredObjects.length = 0;
    });

    // emitter.on("item:click", (event) => {
    //   event.stopPropagation();
    //   if (Date.now() - itemSelectedAt.current < 50) {
    //     return;
    //   }
    //   itemSelectedAt.current = Date.now();
    //   if (selectedItemId.current === event.node.id) {
    //     selectedItemId.current = null;
    //     console.log("Deselected item:", event.node.id);
    //     selectedObjects.length = 0;
    //     return;
    //   }
    //   selectedItemId.current = event.node.id;
    //   const itemMesh = sceneRegistry.nodes.get(event.node.id);
    //   if (!itemMesh) return;
    //   selectedObjects.push(itemMesh);

    //   console.log("Selected item:", event.node.id);
    // });

    emitter.on("wall:click", (event) => {
      if (Date.now() - itemSelectedAt.current < 50) {
        return;
      }
      itemSelectedAt.current = Date.now();
      if (selectedItemId.current === event.node.id) {
        selectedItemId.current = null;
        console.log("Deselected item:", event.node.id);
        useViewer.getState().outliner.selectedObjects.length = 0;
        return;
      }
      selectedItemId.current = event.node.id;
      const itemMesh = sceneRegistry.nodes.get(event.node.id);
      if (!itemMesh) return;
      useViewer.getState().outliner.selectedObjects.push(itemMesh);

      console.log("Selected item:", event.node.id);
    });

    emitter.on("wall:move", (event) => {
      const wallNode = event.node as WallNode;

      if (wallNode.children.length === 0) return;
      const itemId = wallNode.children[0];
      if (!itemId) return;
      if (selectedItemId.current !== itemId) return;
      const itemNode = useScene.getState().nodes[itemId];
      const itemMesh = sceneRegistry.nodes.get(itemId);
      if (!itemNode || !itemMesh) return;

      itemMesh.position.set(
        event.position[0],
        event.position[1],
        event.position[2],
      );
      useScene.getState().dirtyNodes.add(wallNode.id);
      console.log(
        "Wall move event:",
        wallNode.id,
        "Point  position:",
        event.position,
      );
    });
  }, []);

  return null;
};
