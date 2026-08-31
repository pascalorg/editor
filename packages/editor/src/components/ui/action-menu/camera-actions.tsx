'use client'

import { emitter } from '@pascal-app/core'
import Image from 'next/image'
import useEditor from '../../../store/use-editor'
import { ActionButton } from './action-button'

export function CameraActions({ hideOrbit = false }: { hideOrbit?: boolean }) {
  // Orbit stays useful in 2D-only (it spins the synced floorplan view), but
  // top view only tilts the hidden 3D camera — pointless without the canvas.
  const is2dOnly = useEditor((s) => s.viewMode === '2d')

  const goToTopView = () => {
    emitter.emit('camera-controls:top-view')
  }

  const orbitCW = () => {
    emitter.emit('camera-controls:orbit-cw')
  }

  const orbitCCW = () => {
    emitter.emit('camera-controls:orbit-ccw')
  }

  return (
    <div className="flex items-center gap-1">
      {!hideOrbit && (
        <>
          {/* Orbit CCW */}
          <ActionButton
            className="group hover:bg-white/5"
            label="Orbit Left"
            onClick={orbitCCW}
            size="icon"
            variant="ghost"
          >
            <Image
              alt="Orbit Left"
              className="h-[28px] w-[28px] -scale-x-100 object-contain opacity-70 transition-opacity group-hover:opacity-100"
              height={28}
              src="/icons/rotate.webp"
              width={28}
            />
          </ActionButton>

          {/* Orbit CW */}
          <ActionButton
            className="group hover:bg-white/5"
            label="Orbit Right"
            onClick={orbitCW}
            size="icon"
            variant="ghost"
          >
            <Image
              alt="Orbit Right"
              className="h-[28px] w-[28px] object-contain opacity-70 transition-opacity group-hover:opacity-100"
              height={28}
              src="/icons/rotate.webp"
              width={28}
            />
          </ActionButton>
        </>
      )}

      {/* Top View */}
      {!is2dOnly && (
        <ActionButton
          className="group hover:bg-white/5"
          label="Top View"
          onClick={goToTopView}
          size="icon"
          variant="ghost"
        >
          <Image
            alt="Top View"
            className="h-[28px] w-[28px] object-contain opacity-70 transition-opacity group-hover:opacity-100"
            height={28}
            src="/icons/topview.webp"
            width={28}
          />
        </ActionButton>
      )}
    </div>
  )
}
