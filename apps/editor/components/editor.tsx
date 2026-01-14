"use client";

import { Environment, OrbitControls } from "@react-three/drei";
import { Canvas, ThreeToJSXElements } from "@react-three/fiber";

import { extend } from "@react-three/fiber";
import { color, sin, time } from "three/tsl";
import * as THREE from "three/webgpu";

declare module "@react-three/fiber" {
  interface ThreeElements extends ThreeToJSXElements<typeof THREE> {}
}

extend(THREE as any);

export default function Editor() {
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
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardNodeMaterial colorNode={color("pink").mul(sin(time))} />
      </mesh>
    </Canvas>
  );
}
