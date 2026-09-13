/**
 * @pascal-app/plugin-lot — the lot drops in.
 *
 * An address (or one of PlanCrafters' preset lots) becomes the scene's site:
 * the recorded parcel ring, APN, county and zoning from the public GIS
 * layer; the streets around it from OpenStreetMap; the street-facing front
 * edge; north up; planning-default setbacks when the site has none. Other
 * plugins read the site node from there — Generate places the house on the
 * envelope facing the street, Bones sizes to the state, Sheets draws the
 * site plan and the cover.
 *
 * The plugin declares no node kinds; it is a panel + the shared address box.
 * The engine lives in `@pascal-app/editor` (`dropInLot`) so the Site
 * inspector's "Find parcel" runs the same code.
 */
import type { Plugin } from '@pascal-app/core'
import type { EditorHostPanel } from '@pascal-app/editor'

const LOT_ICON = {
  kind: 'url',
  // a lot outline with a pin — inline so the package needs no asset pipeline
  src:
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M10 22l14-8 30 6-6 30-32 4z" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/><path d="M34 44c-6-7-9-11-9-15a9 9 0 0 1 18 0c0 4-3 8-9 15z" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="34" cy="29" r="3" fill="currentColor"/></svg>`,
    ),
} as const

export const lotPlugin = {
  id: 'pascal:lot',
  apiVersion: 1,
  nodes: [],
} satisfies Plugin

export const lotHostPanel = {
  id: 'pascal:lot:panel',
  label: 'Lot',
  icon: LOT_ICON,
  component: () => import('./panel'),
  pluginId: lotPlugin.id,
  description:
    'Drop a real parcel in from an address or a preset lot: the GIS ring, APN and zoning, the streets around it, the street-facing front edge and the default setbacks — ready for Generate.',
  creator: { name: 'Pascal', url: 'https://pascal.app' },
  defaultInstalled: true,
} satisfies EditorHostPanel

export { currentDropInInput, LotAddressBox, runDropIn } from './address-box'
export { PRESET_LOTS, type PresetLot, type PresetTerrain, presetDropInInput } from './presets'
export { type Suggestion, useLot } from './store'
