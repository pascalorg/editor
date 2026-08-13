'use client'

import Image from 'next/image'

export interface CameraControlsProps {
  onRotate: (degrees: number) => void
  onTopView: () => void
}

const BUTTON = 'flex h-[38px] w-[38px] items-center justify-center hover:bg-[var(--surface)]'

export function CameraControls({ onRotate, onTopView }: CameraControlsProps) {
  return (
    <div className="absolute right-4 bottom-4 z-20 flex items-stretch border-2 border-[var(--rule-strong)] bg-[var(--ground)]">
      <button
        className={`${BUTTON} border-[var(--rule)] border-r`}
        onClick={() => onRotate(-45)}
        title="Sola döndür"
        type="button"
      >
        <Image
          alt="Sola döndür"
          className="h-6 w-6 object-contain opacity-70"
          height={24}
          src="/icons/rotate.webp"
          style={{ transform: 'scaleX(-1)' }}
          width={24}
        />
      </button>
      <button
        className={`${BUTTON} border-[var(--rule)] border-r`}
        onClick={() => onRotate(45)}
        title="Sağa döndür"
        type="button"
      >
        <Image
          alt="Sağa döndür"
          className="h-6 w-6 object-contain opacity-70"
          height={24}
          src="/icons/rotate.webp"
          width={24}
        />
      </button>
      <button className={BUTTON} onClick={onTopView} title="Üstten görünüm" type="button">
        <Image
          alt="Üstten görünüm"
          className="h-6 w-6 object-contain opacity-70"
          height={24}
          src="/icons/topview.webp"
          width={24}
        />
      </button>
    </div>
  )
}
