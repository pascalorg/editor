'use client'

import { useEditor } from '@/hooks/use-editor'
import { CameraControls, CameraControlsImpl } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'



export function CustomControls() {
  const controlMode = useEditor((state) => state.controlMode);
  const setMovingCamera = useEditor((state) => state.setMovingCamera);
  const controls = useThree((state) => state.controls);
  const controlsRef = useRef<CameraControlsImpl>(null);

  useEffect(() => {
    if (!controls) return;

    (controls as CameraControlsImpl).setLookAt(30, 30, 30, 0, 0, 0, false);
    (controls as CameraControlsImpl).setLookAt(10, 10, 10, 0, 0, 0, true);
  }, [controls]);

  // Configure mouse buttons based on control mode
  const mouseButtons = useMemo(() => {
    // In select mode, left-click can pan the camera
    if (controlMode === 'select') {
      return {
        left: CameraControlsImpl.ACTION.TRUCK,
        middle: CameraControlsImpl.ACTION.SCREEN_PAN,
        right: CameraControlsImpl.ACTION.ROTATE,
        wheel: CameraControlsImpl.ACTION.DOLLY,
      };
    }

    // In delete, build, and guide modes, disable left-click for camera
    // (reserved for mode-specific actions)
    return {
      left: CameraControlsImpl.ACTION.NONE,
      middle: CameraControlsImpl.ACTION.SCREEN_PAN,
      right: CameraControlsImpl.ACTION.ROTATE,
      wheel: CameraControlsImpl.ACTION.DOLLY,
    };
  }, [controlMode]);

  return (
    <CameraControls
      ref={controlsRef}
      minPolarAngle={0}
      maxPolarAngle={Math.PI / 2 - 0.1}
      minDistance={10}
      maxDistance={50}
      mouseButtons={mouseButtons}
      onStart={() => setMovingCamera(true)}
      onEnd={() => setMovingCamera(false)}
      makeDefault
    />
  )
}