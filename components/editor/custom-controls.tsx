'use client'

import { useEditor } from '@/hooks/use-editor'
import { CameraControls, CameraControlsImpl } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'

type CustomControlsProps = {
  tileSize: number
}


export function CustomControls({ tileSize }: CustomControlsProps) {
  const controlMode = useEditor((state) => state.controlMode);
  const controls = useThree((state) => state.controls);

  useEffect(() => {
    if (!controls) return;

    (controls as CameraControlsImpl).setLookAt(30, 30, 30, 0, 0, 0, false);
    (controls as CameraControlsImpl).setLookAt(10, 10, 10, 0, 0, 0, true);
  }, [controls]);

  return (
    <CameraControls
      minPolarAngle={0}
      maxPolarAngle={Math.PI / 2 - 0.1}
      minDistance={10}
      maxDistance={50}
    mouseButtons={controlMode === 'select' ?  {
      left: CameraControlsImpl.ACTION.ROTATE,
      middle: CameraControlsImpl.ACTION.SCREEN_PAN,
      right: CameraControlsImpl.ACTION.ROTATE,
      wheel: CameraControlsImpl.ACTION.DOLLY,
    } : {
      left: CameraControlsImpl.ACTION.NONE,
      middle: CameraControlsImpl.ACTION.SCREEN_PAN,
      right: CameraControlsImpl.ACTION.ROTATE,
      wheel: CameraControlsImpl.ACTION.DOLLY,
    }} makeDefault/>
  )
}