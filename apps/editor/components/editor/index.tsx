"use client";

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
import { SelectionManager } from "./selection-manager";

initSpatialGridSync();
useScene.getState().loadScene();

export default function Editor() {
  return (
    <div className="w-full h-full">
      {/* <LevelModeSwitcher /> */}

      <TestUndo />
      <ActionMenu />

      <SidebarProvider className="fixed z-10">
        <AppSidebar />
      </SidebarProvider>
      <Viewer>
        <SelectionManager />
        {/* <Stats /> */}
        <Grid cellColor="#666" sectionColor="#999" fadeDistance={30} />
        <ToolManager />
        <CustomCameraControls />
      </Viewer>
    </div>
  );
}

const TestUndo = () => {
  const { undo, redo, futureStates, pastStates } = useScene.temporal.getState();

  return (
    <div className="absolute top-4 right-4 z-10 flex gap-2">
      <button
        className="px-4 py-2 rounded bg-white"
        onClick={() => {
          undo();
        }}
      >
        Undo
      </button>
      <button
        className="px-4 py-2 rounded bg-white"
        onClick={() => {
          redo();
        }}
      >
        Redo
      </button>
    </div>
  );
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
          .min(1),
      );
      const lineY = float(1).sub(
        grid.y
          .div(fw.y)
          .add(1 - thickness)
          .min(1),
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
      float(sectionThickness).mul(g2).min(1),
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
  const gridRef = useRef<Mesh>(null!);

  useFrame((_, delta) => {
    const currentLevelId = useViewer.getState().selection.levelId;
    let targetY = 0;
    if (currentLevelId) {
      const levelMesh = sceneRegistry.nodes.get(currentLevelId);
      if (levelMesh) {
        targetY = levelMesh.position.y;
      }
    }
    gridRef.current.position.y = MathUtils.lerp(
      gridRef.current.position.y,
      targetY,
      12 * delta,
    );
  });

  return (
    <mesh
      rotation-x={-Math.PI / 2}
      material={material}
      {...handlers}
      ref={gridRef}
    >
      <planeGeometry args={[fadeDistance * 2, fadeDistance * 2]} />
    </mesh>
  );
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
