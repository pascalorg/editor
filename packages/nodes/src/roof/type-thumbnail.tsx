import type { RoofType } from '@pascal-app/core'

export function RoofTypeThumbnail({ type }: { type: RoofType }) {
  return (
    <img
      alt=""
      src={`/icons/roof-types/${type}.webp`}
      width={56}
      height={56}
      className="h-14 w-14 object-contain grayscale transition-[filter] duration-150 [button:hover_&]:grayscale-0 [button:focus-visible_&]:grayscale-0"
      draggable={false}
    />
  )
}
