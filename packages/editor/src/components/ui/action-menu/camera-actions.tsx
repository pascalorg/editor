'use client'

import { emitter } from '@pascal-app/core'
import Image from 'next/image'
import { t } from '../../../i18n'
import { ActionButton } from './action-button'

export function CameraActions({ hideOrbit = false }: { hideOrbit?: boolean }) {
  const goToTopView = () => {
    emitter.emit('camera-controls:top-view')
  }

  const orbitCW = () => {
    emitter.emit('camera-controls:orbit-cw')
  }

  const orbitCCW = () => {
    emitter.emit('camera-controls:orbit-ccw')
  }

  const orbitLeft = t('actionMenu.orbitLeft', 'Orbit Left')
  const orbitRight = t('actionMenu.orbitRight', 'Orbit Right')
  const topView = t('actionMenu.topView', 'Top View')

  return (
    <div className="flex items-center gap-1">
      {!hideOrbit && (
        <>
          <ActionButton
            className="group hover:bg-white/5"
            label={orbitLeft}
            onClick={orbitCCW}
            size="icon"
            variant="ghost"
          >
            <Image
              alt={orbitLeft}
              className="h-[28px] w-[28px] -scale-x-100 object-contain opacity-70 transition-opacity group-hover:opacity-100"
              height={28}
              src="/icons/rotate.webp"
              width={28}
            />
          </ActionButton>

          <ActionButton
            className="group hover:bg-white/5"
            label={orbitRight}
            onClick={orbitCW}
            size="icon"
            variant="ghost"
          >
            <Image
              alt={orbitRight}
              className="h-[28px] w-[28px] object-contain opacity-70 transition-opacity group-hover:opacity-100"
              height={28}
              src="/icons/rotate.webp"
              width={28}
            />
          </ActionButton>
        </>
      )}

      <ActionButton
        className="group hover:bg-white/5"
        label={topView}
        onClick={goToTopView}
        size="icon"
        variant="ghost"
      >
        <Image
          alt={topView}
          className="h-[28px] w-[28px] object-contain opacity-70 transition-opacity group-hover:opacity-100"
          height={28}
          src="/icons/topview.webp"
          width={28}
        />
      </ActionButton>
    </div>
  )
}
