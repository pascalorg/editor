"use client";

import {
  emitter,
  ItemNode,
  sceneRegistry,
  useScene,
  WallNode,
} from "@pascal-app/core";
import { useGridEvents, useNodeEvents, useViewer, Viewer } from "@pascal-app/viewer";
import { Stats } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Color, Object3D } from "three";
import { outline } from "three/addons/tsl/display/OutlineNode.js";
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
import { ActionMenu } from "./ui/action-menu";
import { WallEditor } from "./editors/wall/wall-editor";

const selectedObjects: Object3D[] = [];

export default function Editor() {
  return (
    <div className="w-full h-full bg-pink-50">
      {/* <LevelModeSwitcher /> */}

      <ActionMenu />
      <Viewer>
        <DraftSelector />
        <Stats />
        <Grid cellColor="#666" sectionColor="#999" fadeDistance={30} />
        <Passes />
        <WallEditor />
      </Viewer>
    </div>
  );
}

export const Passes = ({}) => {
  const { gl: renderer, scene, camera } = useThree();
  const postProcessingRef = useRef(null);

  useEffect(() => {
    if (!renderer || !scene || !camera) {
      return;
    }

    const scenePass = pass(scene, camera);

    // Get texture nodes
    const outputPass = scenePass.getTextureNode("output");

    const edgeStrength = uniform(3.0);
    const edgeGlow = uniform(0.0);
    const edgeThickness = uniform(1.0);
    const pulsePeriod = uniform(0);
    const visibleEdgeColor = uniform(new Color(0xffffff));
    const hiddenEdgeColor = uniform(new Color(0x4e3636));

    const outlinePass = outline(scene, camera, {
      selectedObjects,
      edgeGlow,
      edgeThickness,
    });
    const { visibleEdge, hiddenEdge } = outlinePass;

    const period = time.div(pulsePeriod).mul(2);
    const osc = oscSine(period).mul(0.5).add(0.5); // osc [ 0.5, 1.0 ]

    const outlineColor = visibleEdge
      .mul(visibleEdgeColor)
      .add(hiddenEdge.mul(hiddenEdgeColor))
      .mul(edgeStrength);
    const outlinePulse = pulsePeriod
      .greaterThan(0)
      .select(outlineColor.mul(osc), outlineColor);

    // Setup post-processing
    const postProcessing = new PostProcessing(renderer);

    postProcessing.outputNode = outlinePulse.add(scenePass);
    postProcessingRef.current = postProcessing;

    return () => {
      postProcessingRef.current = null;
    };
  }, [renderer, scene, camera]);

  useFrame(() => {
    if (postProcessingRef.current) {
      postProcessingRef.current.render();
    }
  }, 1);

  return null;
};

const Grid = ({
  cellSize = 0.5,
  cellThickness = 0.5,
  cellColor = "#888888",
  sectionSize = 1,
  sectionThickness = 1,
  sectionColor = "#000000",
  fadeDistance = 100,
  fadeStrength = 1,
}: {
  cellSize?: number;
  cellThickness?: number;
  cellColor?: string;
  sectionSize?: number;
  sectionThickness?: number;
  sectionColor?: string;
  fadeDistance?: number;
  fadeStrength?: number;
}) => {
  const material = useMemo(() => {
    // Use xy since plane geometry is in XY space (before rotation)
    const pos = positionLocal.xy;

    // Grid line function using fwidth for anti-aliasing
    // Returns 1 on grid lines, 0 elsewhere
    const getGrid = (size: number, thickness: number) => {
      const r = pos.div(size);
      const fw = fwidth(r);
      // Distance to nearest grid line for each axis
      const grid = fract(r.sub(0.5)).sub(0.5).abs();
      // Anti-aliased step: divide by fwidth and clamp
      const lineX = float(1).sub(
        grid.x
          .div(fw.x)
          .add(1 - thickness)
          .min(1)
      );
      const lineY = float(1).sub(
        grid.y
          .div(fw.y)
          .add(1 - thickness)
          .min(1)
      );
      // Combine both axes - max gives us lines in both directions
      return lineX.max(lineY);
    };

    const g1 = getGrid(cellSize, cellThickness);
    const g2 = getGrid(sectionSize, sectionThickness);

    // Distance fade from center
    const dist = pos.length();
    const fade = float(1).sub(dist.div(fadeDistance).min(1)).pow(fadeStrength);

    // Mix colors based on section grid
    const gridColor = mix(
      color(cellColor),
      color(sectionColor),
      float(sectionThickness).mul(g2).min(1)
    );

    // Combined alpha
    const alpha = g1.add(g2).mul(fade);
    const finalAlpha = mix(alpha.mul(0.75), alpha, g2);

    return new MeshBasicNodeMaterial({
      transparent: true,
      colorNode: gridColor,
      opacityNode: finalAlpha,
      depthWrite: false,
    });
  }, [
    cellSize,
    cellThickness,
    cellColor,
    sectionSize,
    sectionThickness,
    sectionColor,
    fadeDistance,
    fadeStrength,
  ]);

  const handlers = useGridEvents();

  return (
    <mesh rotation-x={-Math.PI / 2} material={material} {...handlers}>
      <planeGeometry args={[fadeDistance * 2, fadeDistance * 2]} />
    </mesh>
  );
};

const DraftSelector = () => {
  const selectedItemId = useRef<ItemNode["id"] | WallNode["id"]>(null);
  const itemSelectedAt = useRef<number>(0);
  useEffect(() => {
    emitter.on('building:enter', (event) => {
      console.log('Entered building:', event.node.id);
      const itemMesh = sceneRegistry.nodes.get(event.node.id);
      selectedObjects.length = 0;
      selectedObjects.push(itemMesh);
    });
    emitter.on('building:leave', (event) => {
      console.log('Leaving building:', event.node.id);
      selectedObjects.length = 0;
    });


    emitter.on("item:click", (event) => {
      event.stopPropagation();
      if (Date.now() - itemSelectedAt.current < 50) {
        return;
      }
      itemSelectedAt.current = Date.now();
      if (selectedItemId.current === event.node.id) {
        selectedItemId.current = null;
        console.log("Deselected item:", event.node.id);
        selectedObjects.length = 0;
        return;
      }
      selectedItemId.current = event.node.id;
      const itemMesh = sceneRegistry.nodes.get(event.node.id);
      if (!itemMesh) return;
      selectedObjects.push(itemMesh);

      console.log("Selected item:", event.node.id);
    });

    emitter.on("wall:click", (event) => {
      if (Date.now() - itemSelectedAt.current < 50) {
        return;
      }
      itemSelectedAt.current = Date.now();
      if (selectedItemId.current === event.node.id) {
        selectedItemId.current = null;
        console.log("Deselected item:", event.node.id);
        selectedObjects.length = 0;
        return;
      }
      selectedItemId.current = event.node.id;
      const itemMesh = sceneRegistry.nodes.get(event.node.id);
      if (!itemMesh) return;
      selectedObjects.push(itemMesh);

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
  const setLevelMode = useViewer((state) => state.setLevelMode);
  const levelMode = useViewer((state) => state.levelMode);

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
