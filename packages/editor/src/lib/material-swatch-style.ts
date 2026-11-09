import type { MaterialSwatch } from '@pascal-app/core'
import type { CSSProperties } from 'react'

/**
 * The CSS that paints a material swatch: the image over its colour, and a tinted
 * albedo multiplied by the colour, as the 3D material tints its map.
 */
export function materialSwatchStyle({
  color,
  imageUrl,
  tinted,
}: Pick<MaterialSwatch, 'color' | 'imageUrl'> & { tinted?: boolean }): CSSProperties {
  return {
    backgroundColor: color,
    ...(imageUrl
      ? {
          backgroundImage: `url(${JSON.stringify(imageUrl)})`,
          backgroundPosition: 'center',
          backgroundSize: 'cover',
          ...(tinted ? { backgroundBlendMode: 'multiply' } : {}),
        }
      : {}),
  }
}
