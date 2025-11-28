import { Sky } from '@react-three/drei'
import { memo } from 'react'
import { useShallow } from 'zustand/shallow'
import { useEditor } from '@/hooks/use-editor'
import type { EnvironmentNode } from '@/lib/scenegraph/schema'

type EnvironmentRendererProps = {}

export const EnvironmentRenderer = memo(() => {
  const { latitude, longitude } = useEditor(
    useShallow((state) => {
      const environment = state.scene.root.environment
      return {
        latitude: environment.latitude,
        longitude: environment.longitude,
        altitude: environment.altitude,
      }
    }),
  )
  return <Sky azimuth={longitude} inclination={latitude} />
})
