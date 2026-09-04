import ash from './assets/ash.webp'
import aspen from './assets/aspen.webp'
import bush from './assets/bush.webp'
import daisy from './assets/daisy.webp'
import fescue from './assets/fescue.webp'
import lavender from './assets/lavender.webp'
import meadow from './assets/meadow.webp'
import natureIcon from './assets/nature-icon.webp'
import oak from './assets/oak.webp'
import pine from './assets/pine.webp'
import reed from './assets/reed.webp'
import trellis from './assets/trellis.webp'
import tulip from './assets/tulip.webp'
import type { FlowerPreset } from './flower-schema'
import type { GrassPreset } from './grass-schema'
import type { TreePreset } from './schema'

/**
 * Bundled preset artwork. The webp live in `./assets` and travel with the
 * package — no CDN, no per-app `public/` mirroring. Both consumers are Next, so
 * `transpilePackages` runs these imports through the image pipeline and `.src`
 * is the hashed, cached URL. The panel renders each as an `<img src>`.
 */
const url = (asset: { src: string }): string => asset.src

export const TREE_ART: Record<TreePreset, string> = {
  oak: url(oak),
  pine: url(pine),
  aspen: url(aspen),
  ash: url(ash),
  bush: url(bush),
  trellis: url(trellis),
}

export const FLOWER_ART: Record<FlowerPreset, string> = {
  daisy: url(daisy),
  tulip: url(tulip),
  lavender: url(lavender),
}

export const GRASS_ART: Record<GrassPreset, string> = {
  meadow: url(meadow),
  fescue: url(fescue),
  reed: url(reed),
}

/** The Nature panel / section icon. */
export const NATURE_ICON = url(natureIcon)
