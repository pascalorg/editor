"use client";

import {
  type CameraControlEvent,
  emitter,
  sceneRegistry,
  useScene,
} from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import { CameraControls, CameraControlsImpl } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import { Vector3 } from "three";

const currentTarget = new Vector3();

export const CustomCameraControls = () => {
  const controls = useRef<CameraControlsImpl>(null!);
  const currentLevelId = useViewer((state) => state.selection.levelId);
  const firstLoad = useRef(true);

  useEffect(() => {
    let targetY = 0;
    if (currentLevelId) {
      const levelMesh = sceneRegistry.nodes.get(currentLevelId);
      if (levelMesh) {
        targetY = levelMesh.position.y;
      }
    }
    if (firstLoad.current) {
      firstLoad.current = false;
      (controls.current as CameraControlsImpl).setLookAt(
        20,
        20,
        20,
        0,
        0,
        0,
        true,
      );
    }
    (controls.current as CameraControlsImpl).getTarget(currentTarget);
    (controls.current as CameraControlsImpl).moveTo(
      currentTarget.x,
      targetY,
      currentTarget.z,
      true,
    );
  }, [currentLevelId]);

  // Configure mouse buttons based on control mode and camera mode
  const mouseButtons = useMemo(() => {
    // Use ZOOM for orthographic camera, DOLLY for perspective camera
    // const wheelAction =
    //   cameraMode === 'orthographic'
    //     ? CameraControlsImpl.ACTION.ZOOM
    //     : CameraControlsImpl.ACTION.DOLLY
    const wheelAction = CameraControlsImpl.ACTION.DOLLY;

    return {
      left: CameraControlsImpl.ACTION.NONE,
      middle: CameraControlsImpl.ACTION.SCREEN_PAN,
      right: CameraControlsImpl.ACTION.ROTATE,
      wheel: wheelAction,
    };
  }, []);

  useEffect(() => {
    const handleNodeCapture = ({ nodeId }: CameraControlEvent) => {
      if (!controls.current) return;

      const position = new Vector3();
      const target = new Vector3();
      controls.current.getPosition(position);
      controls.current.getTarget(target);

      const state = useScene.getState();

      state.updateNode(nodeId, {
        camera: {
          position: [position.x, position.y, position.z],
          target: [target.x, target.y, target.z],
          mode: useViewer.getState().cameraMode,
        },
      });
    };
    const handleNodeView = ({ nodeId }: CameraControlEvent) => {
      if (!controls.current) return;

      const node = useScene.getState().nodes[nodeId];
      if (!node || !node.camera) return;
      const { position, target } = node.camera;

      controls.current.setLookAt(
        position[0],
        position[1],
        position[2],
        target[0],
        target[1],
        target[2],
        true,
      );
    };

    emitter.on("camera-controls:capture", handleNodeCapture);
    emitter.on("camera-controls:view", handleNodeView);

    return () => {
      emitter.off("camera-controls:capture", handleNodeCapture);
      emitter.off("camera-controls:view", handleNodeView);
    };
  }, []);

  return <CameraControls ref={controls} mouseButtons={mouseButtons} />;
};
