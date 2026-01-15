"use client";

import {
  emitter,
  ItemNode,
  sceneRegistry,
  useScene,
  WallNode,
} from "@pascal-app/core";
import { Viewer } from "@pascal-app/viewer";
import { Stats } from "@react-three/drei";
import { useEffect, useRef } from "react";
import { Mesh } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";

export default function Editor() {
  return (
    <div className="w-full h-full bg-pink-50">
      <LevelModeSwitcher />
      <Viewer>
        <Selector />
        <Stats />
      </Viewer>
    </div>
  );
}

const Selector = () => {
  const selectedItemId = useRef<ItemNode["id"]>(null);
  const itemSelectedAt = useRef<number>(0);
  useEffect(() => {
    emitter.on("item:click", (event) => {
      if (Date.now() - itemSelectedAt.current < 50) {
        return;
      }
      itemSelectedAt.current = Date.now();
      if (selectedItemId.current === event.node.id) {
        selectedItemId.current = null;
        console.log("Deselected item:", event.node.id);
        return;
      }
      selectedItemId.current = event.node.id;
      const itemMesh = sceneRegistry.nodes.get(event.node.id);
      if (!itemMesh) return;
      itemMesh.traverse((child) => {
        if ((child as Mesh).isMesh) {
          (child as Mesh).material = new MeshBasicNodeMaterial({
            color: "yellow",
          });
        }
      });

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
        event.position[2]
      );
      useScene.getState().dirtyNodes.add(wallNode.id);
      console.log(
        "Wall move event:",
        wallNode.id,
        "Point  position:",
        event.position
      );
    });
  }, []);

  return null;
};

const LevelModeSwitcher = () => {
  const setLevelMode = useScene((state) => state.setLevelMode);
  const levelMode = useScene((state) => state.levelMode);

  return (
    <div className="absolute top-4 left-4 z-10 flex gap-2">
      <button
        className={`px-4 py-2 rounded ${
          levelMode === "exploded" ? "bg-blue-500 text-white" : "bg-white"
        }`}
        onClick={() => setLevelMode("exploded")}
      >
        Exploded
      </button>
      <button
        className={`px-4 py-2 rounded ${
          levelMode === "stacked" ? "bg-blue-500 text-white" : "bg-white"
        }`}
        onClick={() => setLevelMode("stacked")}
      >
        Stacked
      </button>
    </div>
  );
};
