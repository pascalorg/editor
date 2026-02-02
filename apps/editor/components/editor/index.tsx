'use client'

import { initSpatialGridSync, sceneRegistry, useScene } from '@pascal-app/core'
import { useGridEvents, useViewer, Viewer } from '@pascal-app/viewer'

import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { MathUtils, type Mesh } from 'three'

import { color, float, fract, fwidth, mix, positionLocal } from 'three/tsl'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { useKeyboard } from '@/hooks/use-keyboard'
import { ZoneSystem } from '../systems/zone/zone-system'
import { ToolManager } from '../tools/tool-manager'
import { ActionMenu } from '../ui/action-menu'
import { PanelManager } from '../ui/panels/panel-manager'
import { SidebarProvider } from '../ui/primitives/sidebar'
import { AppSidebar } from '../ui/sidebar/app-sidebar'
import { CustomCameraControls } from './custom-camera-controls'
import { ExportManager } from './export-manager'
import { SelectionManager } from './selection-manager'

useScene.getState().loadScene()
console.log('Loaded scene in editor')
initSpatialGridSync()

export default function Editor() {
  useKeyboard()

  return (
    <div className="w-full h-full">
      <ActionMenu />
      <PanelManager />

      <SidebarProvider className="fixed z-10">
        <AppSidebar />
      </SidebarProvider>
      <Viewer selectionManager="custom">
        <SelectionManager />
        <ExportManager />
        {/* Editor only system to toggle zone visibility */}
        <ZoneSystem />
        {/* <Stats /> */}
        <Grid cellColor="#666" sectionColor="#999" fadeDistance={30} />
        <ToolManager />
        <CustomCameraControls />
      </Viewer>
    </div>
  )
}


const Grid = ({
  cellSize = 0.5,
  cellThickness = 0.5,
  cellColor = '#888888',
  sectionSize = 1,
  sectionThickness = 1,
  sectionColor = '#000000',
  fadeDistance = 100,
  fadeStrength = 1,
}: {
  cellSize?: number
  cellThickness?: number
  cellColor?: string
  sectionSize?: number
  sectionThickness?: number
  sectionColor?: string
  fadeDistance?: number
  fadeStrength?: number
}) => {
  const material = useMemo(() => {
    // Use xy since plane geometry is in XY space (before rotation)
    const pos = positionLocal.xy

    // Grid line function using fwidth for anti-aliasing
    // Returns 1 on grid lines, 0 elsewhere
    const getGrid = (size: number, thickness: number) => {
      const r = pos.div(size)
      const fw = fwidth(r)
      // Distance to nearest grid line for each axis
      const grid = fract(r.sub(0.5)).sub(0.5).abs()
      // Anti-aliased step: divide by fwidth and clamp
      const lineX = float(1).sub(
        grid.x
          .div(fw.x)
          .add(1 - thickness)
          .min(1),
      )
      const lineY = float(1).sub(
        grid.y
          .div(fw.y)
          .add(1 - thickness)
          .min(1),
      )
      // Combine both axes - max gives us lines in both directions
      return lineX.max(lineY)
    }

    const g1 = getGrid(cellSize, cellThickness)
    const g2 = getGrid(sectionSize, sectionThickness)

    // Distance fade from center
    const dist = pos.length()
    const fade = float(1).sub(dist.div(fadeDistance).min(1)).pow(fadeStrength)

    // Mix colors based on section grid
    const gridColor = mix(
      color(cellColor),
      color(sectionColor),
      float(sectionThickness).mul(g2).min(1),
    )

    // Combined alpha
    const alpha = g1.add(g2).mul(fade)
    const finalAlpha = mix(alpha.mul(0.75), alpha, g2)

    return new MeshBasicNodeMaterial({
      transparent: true,
      colorNode: gridColor,
      opacityNode: finalAlpha,
      depthWrite: false,
    })
  }, [
    cellSize,
    cellThickness,
    cellColor,
    sectionSize,
    sectionThickness,
    sectionColor,
    fadeDistance,
    fadeStrength,
  ])

  const handlers = useGridEvents()
  const gridRef = useRef<Mesh>(null!)

  useFrame((_, delta) => {
    const currentLevelId = useViewer.getState().selection.levelId
    let targetY = 0
    if (currentLevelId) {
      const levelMesh = sceneRegistry.nodes.get(currentLevelId)
      if (levelMesh) {
        targetY = levelMesh.position.y
      }
    }
    gridRef.current.position.y = MathUtils.lerp(gridRef.current.position.y, targetY, 12 * delta)
  })

  return (
    <mesh rotation-x={-Math.PI / 2} material={material} {...handlers} ref={gridRef}>
      <planeGeometry args={[fadeDistance * 2, fadeDistance * 2]} />
    </mesh>
  )
}
