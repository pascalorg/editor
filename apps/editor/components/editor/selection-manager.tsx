import {
  type BuildingNode,
  emitter,
  type GridEvent,
  type ItemEvent,
  type ItemNode,
  sceneRegistry,
  useScene,
  type WallEvent,
  type WallNode,
} from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import { useEffect, useRef } from "react";
import useEditor from "@/store/use-editor";

export const SelectionManager = () => {
  const selectedItemId = useRef<ItemNode["id"] | WallNode["id"]>(null);
  const itemSelectedAt = useRef<number>(0);
  const phase = useEditor((state) => state.phase);
  const mode = useEditor((state) => state.mode);
  useEffect(() => {
    if (mode !== "select") {
      return;
    }

    if (phase === "site") {
      const onBuildingEnter = (event: { node: BuildingNode }) => {
        const itemMesh = sceneRegistry.nodes.get(event.node.id);
        useViewer.getState().outliner.hoveredObjects.length = 0;
        useViewer.getState().outliner.hoveredObjects.push(itemMesh);
      };
      const onBuildingLeave = (event: { node: BuildingNode }) => {
        useViewer.getState().outliner.hoveredObjects.length = 0;
      };
      emitter.on("building:enter", onBuildingEnter);
      emitter.on("building:leave", onBuildingLeave);
      return () => {
        emitter.off("building:enter", onBuildingEnter);
        emitter.off("building:leave", onBuildingLeave);
      };
    }

    if (phase === "furnish") {
      const onItemEnter = (event: ItemEvent) => {
        const itemMesh = sceneRegistry.nodes.get(event.node.id);
        useViewer.getState().outliner.hoveredObjects.length = 0;
        useViewer.getState().outliner.hoveredObjects.push(itemMesh);
      };

      const onItemLeave = (event: ItemEvent) => {
        useViewer.getState().outliner.hoveredObjects.length = 0;
      };

      const onItemClick = (event: ItemEvent) => {
        event.stopPropagation();
        useViewer
          .getState()
          .outliner.selectedObjects.push(
            sceneRegistry.nodes.get(event.node.id),
          );
      };

      emitter.on("item:enter", onItemEnter);
      emitter.on("item:leave", onItemLeave);
      emitter.on("item:click", onItemClick);
      return () => {
        emitter.off("item:enter", onItemEnter);
        emitter.off("item:leave", onItemLeave);
        emitter.off("item:click", onItemClick);
      };
    }

    if (phase === "structure") {
      const onGridClick = (event: GridEvent) => {
        useViewer.getState().outliner.selectedObjects.length = 0;
      };
      const onWallEnter = (event: WallEvent) => {
        event.stopPropagation();
        const itemMesh = sceneRegistry.nodes.get(event.node.id);
        useViewer.getState().outliner.hoveredObjects.length = 0;
        useViewer.getState().outliner.hoveredObjects.push(itemMesh);
      };
      const onWallLeave = (event: WallEvent) => {
        useViewer.getState().outliner.hoveredObjects.length = 0;
      };

      const onWallClick = (event: WallEvent) => {
        event.stopPropagation();
        if (!event.nativeEvent.shiftKey) {
          useViewer.getState().outliner.selectedObjects.length = 0;
          useViewer
            .getState()
            .outliner.selectedObjects.push(
              sceneRegistry.nodes.get(event.node.id),
            );
        } else {
          // check if already selected
          const selectedObjects = useViewer.getState().outliner.selectedObjects;
          const wallMesh = sceneRegistry.nodes.get(event.node.id);
          const index = selectedObjects.indexOf(wallMesh);
          if (index > -1) {
            // already selected, deselect
            selectedObjects.splice(index, 1);
          } else {
            // not selected, add to selection
            selectedObjects.push(wallMesh);
          }
        }
      };
      emitter.on("grid:click", onGridClick);
      emitter.on("wall:enter", onWallEnter);
      emitter.on("wall:leave", onWallLeave);
      emitter.on("wall:click", onWallClick);
      return () => {
        emitter.off("wall:enter", onWallEnter);
        emitter.off("wall:leave", onWallLeave);
        emitter.off("wall:click", onWallClick);
        emitter.off("grid:click", onGridClick);
      };
    }

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
  }, [mode, phase]);

  return null;
};
