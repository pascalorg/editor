"use client";

import { sceneRegistry } from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import { CameraControls, CameraControlsImpl } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import { Vector3 } from "three";

export const CustomCameraControls = () => {
  const controls = useRef<CameraControlsImpl>(null!);
  const currentLevelId = useViewer((state) => state.currentLevelId);

  useEffect(() => {
    let targetY = 0;
    if (currentLevelId) {
      const levelMesh = sceneRegistry.nodes.get(currentLevelId);
      if (levelMesh) {
        targetY = levelMesh.position.y;
      }
    }
    const currentTarget = new Vector3();
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

  return <CameraControls ref={controls} mouseButtons={mouseButtons} />;
};
