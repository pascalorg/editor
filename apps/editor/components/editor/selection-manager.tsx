import {
  emitter,
  initSpatialGridSync,
  ItemNode,
  sceneRegistry,
  useRegistry,
  useScene,
  WallNode,
} from "@pascal-app/core";
import { useGridEvents, useViewer, Viewer } from "@pascal-app/viewer";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Color, MathUtils, Mesh, Object3D, Vector3 } from "three";

import {
  color,
  float,
  fract,
  fwidth,
  mix,
  oscSine,
  pass,
  positionLocal,
  time,
  uniform,
} from "three/tsl";
import { MeshBasicNodeMaterial, PostProcessing } from "three/webgpu";
import { ActionMenu } from "../ui/action-menu";
import { ToolManager } from "../tools/tool-manager";
import { AppSidebar } from "../ui/sidebar/app-sidebar";
import { SidebarProvider } from "../ui/primitives/sidebar";
import { CustomCameraControls } from "./custom-camera-controls";

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
