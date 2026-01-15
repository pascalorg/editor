"use client";

import { Bvh, Environment, OrbitControls } from "@react-three/drei";
import { Canvas, ThreeToJSXElements } from "@react-three/fiber";

import { LevelSystem, WallSystem } from "@pascal-app/core";
import { extend } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import { SceneRenderer } from "../renderers/scene-renderer";

declare module "@react-three/fiber" {
  interface ThreeElements extends ThreeToJSXElements<typeof THREE> {}
}

extend(THREE as any);

interface ViewerProps {
  children?: React.ReactNode;
}

const Viewer: React.FC<ViewerProps> = ({ children }) => {
  return (
    <Canvas
      className={"bg-[#303035]"}
      gl={async (props) => {
        const renderer = new THREE.WebGPURenderer(props as any);
        await renderer.init();
        return renderer;
      }}
      shadows
      camera={{ position: [3, 3, 3], fov: 50 }}
    >
      <OrbitControls />
      <Environment preset="sunset" />
      <Bvh>
        <SceneRenderer />
      </Bvh>

      {/* Default Systems */}
      <LevelSystem />
      <WallSystem />

      {children}
    </Canvas>
  );
};

export default Viewer;
