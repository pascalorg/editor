import type { ThreeElements } from '@react-three/fiber'
import { forwardRef } from 'react'
import type { Group } from 'three'
import { Html } from '@react-three/drei'
import useEditor from '@/store/use-editor'
import { tools } from '@/components/ui/action-menu/structure-tools'
import { furnishTools } from '@/components/ui/action-menu/furnish-tools'

interface CursorSphereProps extends Omit<ThreeElements['group'], 'ref'> {
  color?: string
  depthWrite?: boolean
  showTooltip?: boolean
  height?: number
}

export const CursorSphere = forwardRef<Group, CursorSphereProps>(function CursorSphere(
  { color = '#818cf8', showTooltip = true, height = 2.5, ...props },
  ref,
) {
  const tool = useEditor((s) => s.tool)
  const mode = useEditor((s) => s.mode)
  const catalogCategory = useEditor((s) => s.catalogCategory)

  // Find the icon for the current tool
  let activeToolConfig = null
  if (mode === 'build' && tool) {
    if (tool === 'item' && catalogCategory) {
      activeToolConfig = furnishTools.find((t) => t.catalogCategory === catalogCategory)
    } else {
      activeToolConfig = tools.find((t) => t.id === tool)
    }
  }

  return (
    <group ref={ref} {...props}>
      {/* Flat marker on the ground */}
      <group rotation={[-Math.PI / 2, 0, 0]}>
        {/* Center dot */}
        <mesh renderOrder={2}>
          <circleGeometry args={[0.06, 32]} />
          <meshBasicMaterial color={color} depthTest={false} depthWrite={false} transparent opacity={0.9} />
        </mesh>
        
        {/* Outer ring / glow */}
        <mesh renderOrder={2}>
          <circleGeometry args={[0.2, 32]} />
          <meshBasicMaterial color={color} depthTest={false} depthWrite={false} transparent opacity={0.25} />
        </mesh>
      </group>

      {/* Vertical line */}
      {height > 0 && (
        <mesh position={[0, height / 2, 0]} renderOrder={2}>
          <cylinderGeometry args={[0.01, 0.01, height, 8]} />
          <meshBasicMaterial color={color} depthTest={false} depthWrite={false} transparent opacity={0.7} />
        </mesh>
      )}

      {/* Tool Icon Tooltip at the top of the line */}
      {showTooltip && activeToolConfig && (
        <Html
          position={[0, height > 0 ? height + 0.2 : 0.6, 0]}
          center
          style={{
            pointerEvents: 'none',
            background: '#18181b', // zinc-900
            padding: '6px',
            borderRadius: '12px',
            border: '1px solid rgba(255,255,255,0.05)',
            boxShadow: '0 8px 16px -4px rgba(0, 0, 0, 0.3), 0 4px 8px -4px rgba(0, 0, 0, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '36px',
            height: '36px',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img 
            src={activeToolConfig.iconSrc} 
            alt={activeToolConfig.label} 
            style={{ 
              width: '100%', 
              height: '100%', 
              objectFit: 'contain',
              filter: 'drop-shadow(0px 2px 4px rgba(0,0,0,0.5))'
            }} 
          />
        </Html>
      )}
    </group>
  )
})
