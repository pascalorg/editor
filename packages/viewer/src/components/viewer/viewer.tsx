"use client";

import { Environment, OrbitControls } from "@react-three/drei";
import { Canvas, ThreeToJSXElements } from "@react-three/fiber";

import { extend } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import { SceneRenderer } from "../renderers/scene-renderer";

declare module "@react-three/fiber" {
  interface ThreeElements extends ThreeToJSXElements<typeof THREE> {}
}

extend(THREE as any);

interface ViewerProps {}

const Viewer: React.FC<ViewerProps> = () => {
  return (
    <Canvas
      className={"bg-[#303035]"}
      gl={async (props) => {
        const renderer = new THREE.WebGPURenderer(props as any);
        await renderer.init();
        return renderer;
      }}
      shadows
    >
      <OrbitControls />
      <Environment preset="sunset" />
      <SceneRenderer />
    </Canvas>
  );
};

export default Viewer;
