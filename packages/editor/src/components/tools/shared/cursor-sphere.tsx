import { Html } from '@react-three/drei'
import type { ThreeElements } from '@react-three/fiber'
import { forwardRef } from 'react'
import type { Group } from 'three'
import { furnishTools } from '../../../components/ui/action-menu/furnish-tools'
import { tools } from '../../../components/ui/action-menu/structure-tools'
import { EDITOR_LAYER } from '../../../lib/constants'
import useEditor from '../../../store/use-editor'

interface CursorSphereProps extends Omit<ThreeElements['group'], 'ref'> {
  color?: string
  depthWrite?: boolean
  showTooltip?: boolean
  height?: number
  /** Custom tooltip content — overrides the auto-detected build tool icon */
  tooltipContent?: React.ReactNode
}

export const CursorSphere = forwardRef<Group, CursorSphereProps>(function CursorSphere(
  { color = '#818cf8', showTooltip = true, height = 2.5, visible = true, tooltipContent, ...props },
  ref,
) {
  const tool = useEditor((s) => s.tool)
  const mode = useEditor((s) => s.mode)
  const catalogCategory = useEditor((s) => s.catalogCategory)
  const isFloorplanHovered = useEditor((s) => s.isFloorplanHovered)

  // Find the icon for the current tool
  let activeToolConfig = null
  if (mode === 'build' && tool) {
    if (tool === 'item' && catalogCategory) {
      activeToolConfig = furnishTools.find((t) => t.catalogCategory === catalogCategory)
    } else {
      activeToolConfig = tools.find((t) => t.id === tool)
    }
  }

  const isVisible = visible && !isFloorplanHovered

  return (
    <group ref={ref} {...props} visible={isVisible}>
      {/* Flat marker on the ground */}
      <group rotation={[-Math.PI / 2, 0, 0]}>
        {/* Center dot */}
        <mesh layers={EDITOR_LAYER} renderOrder={2}>
          <circleGeometry args={[0.06, 32]} />
          <meshBasicMaterial
            color={color}
            depthTest={false}
            depthWrite={false}
            opacity={0.9}
            transparent
          />
        </mesh>

        {/* Outer ring / glow */}
        <mesh layers={EDITOR_LAYER} renderOrder={2}>
          <circleGeometry args={[0.2, 32]} />
          <meshBasicMaterial
            color={color}
            depthTest={false}
            depthWrite={false}
            opacity={0.25}
            transparent
          />
        </mesh>
      </group>

      {/* Vertical line */}
      {height > 0 && (
        <mesh layers={EDITOR_LAYER} position={[0, height / 2, 0]} renderOrder={2}>
          <cylinderGeometry args={[0.01, 0.01, height, 8]} />
          <meshBasicMaterial
            color={color}
            depthTest={false}
            depthWrite={false}
            opacity={0.7}
            transparent
          />
        </mesh>
      )}

      {/* Tool Icon Tooltip at the top of the line */}
      {isVisible && showTooltip && (activeToolConfig || tooltipContent) && (
        <Html
          center
          position={[0, height > 0 ? height + 0.2 : 0.6, 0]}
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
          {tooltipContent || (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={activeToolConfig!.label}
              src={activeToolConfig!.iconSrc}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                filter: 'drop-shadow(0px 2px 4px rgba(0,0,0,0.5))',
              }}
            />
          )}
        </Html>
      )}
    </group>
  )
})
