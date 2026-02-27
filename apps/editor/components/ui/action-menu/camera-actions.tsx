'use client'

import { emitter } from '@pascal-app/core'
import Image from 'next/image'
import { ActionButton } from "./action-button";

export function CameraActions() {
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
      {/* Orbit CCW */}
      <ActionButton
        label="Orbit Left"
        className="group hover:bg-white/5"
        onClick={orbitCCW}
        size="icon"
        variant="ghost"
      >
        <Image
          alt="Orbit Left"
          className="h-[28px] w-[28px] object-contain opacity-70 transition-opacity group-hover:opacity-100 -scale-x-100"
          height={28}
          src="/icons/rotate.png"
          width={28}
        />
      </ActionButton>

      {/* Orbit CW */}
      <ActionButton
        label="Orbit Right"
        className="group hover:bg-white/5"
        onClick={orbitCW}
        size="icon"
        variant="ghost"
      >
        <Image
          alt="Orbit Right"
          className="h-[28px] w-[28px] object-contain opacity-70 transition-opacity group-hover:opacity-100"
          height={28}
          src="/icons/rotate.png"
          width={28}
        />
      </ActionButton>

      {/* Top View */}
      <ActionButton
        label="Top View"
        className="group hover:bg-white/5"
        onClick={goToTopView}
        size="icon"
        variant="ghost"
      >
        <Image
          alt="Top View"
          className="h-[28px] w-[28px] object-contain opacity-70 transition-opacity group-hover:opacity-100"
          height={28}
          src="/icons/topview.png"
          width={28}
        />
      </ActionButton>
    </div>
  )
}
