import { forwardRef } from 'react'
import type { Mesh } from 'three'

interface CursorSphereProps extends Omit<JSX.IntrinsicElements['mesh'], 'ref'> {
  color?: string
  depthWrite?: boolean
}

export const CursorSphere = forwardRef<Mesh, CursorSphereProps>(function CursorSphere(
  { color = '#f1c066',  ...props },
  ref,
) {
  return (
    <mesh ref={ref} {...props} renderOrder={2}>
      <sphereGeometry args={[0.1, 16, 16]} />
      <meshBasicMaterial color={color} depthTest={false} depthWrite={true} />
    </mesh>
  )
})
