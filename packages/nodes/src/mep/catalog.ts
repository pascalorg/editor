/**
 * Typed MEP families catalog — reference data for the UI picker and MCP
 * tool-call suggestions. Each entry maps to a node kind + defaults that
 * produce a sensible first placement without further configuration.
 */

export type MepFamily = {
  id: string
  label: string
  kind: string
  defaults: Record<string, unknown>
  section: 'hvac' | 'plumbing' | 'electrical'
}

export const MEP_CATALOG: MepFamily[] = [
  // ── HVAC ──────────────────────────────────────────────────────────────
  {
    id: 'round-duct',
    label: 'Round Duct',
    kind: 'duct-segment',
    defaults: { diameter: 0.3, ductMaterial: 'galvanized' },
    section: 'hvac',
  },
  {
    id: 'supply-register',
    label: 'Supply Register',
    kind: 'duct-terminal',
    defaults: { terminalType: 'supply' },
    section: 'hvac',
  },
  {
    id: 'hvac-unit',
    label: 'HVAC Unit',
    kind: 'hvac-equipment',
    defaults: {},
    section: 'hvac',
  },

  // ── Plumbing ──────────────────────────────────────────────────────────
  {
    id: 'cold-water-line',
    label: 'Cold Water Line',
    kind: 'water-line',
    defaults: { system: 'cold-water', diameter: 0.75, pipeMaterial: 'pex' },
    section: 'plumbing',
  },
  {
    id: 'hot-water-line',
    label: 'Hot Water Line',
    kind: 'water-line',
    defaults: { system: 'hot-water', diameter: 0.75, pipeMaterial: 'pex' },
    section: 'plumbing',
  },
  {
    id: 'dwv-pipe',
    label: 'DWV Pipe',
    kind: 'pipe-segment',
    defaults: { diameter: 3, pipeMaterial: 'pvc', system: 'waste' },
    section: 'plumbing',
  },
  {
    id: 'trap',
    label: 'P-Trap',
    kind: 'pipe-trap',
    defaults: { diameter: 2, pipeMaterial: 'pvc' },
    section: 'plumbing',
  },

  // ── Electrical ────────────────────────────────────────────────────────
  {
    id: 'outlet-127v',
    label: 'Outlet 127V',
    kind: 'electrical-device',
    defaults: { deviceType: 'outlet', voltage: 127, mounting: 'wall' },
    section: 'electrical',
  },
  {
    id: 'outlet-220v',
    label: 'Outlet 220V',
    kind: 'electrical-device',
    defaults: { deviceType: 'outlet', voltage: 220, mounting: 'wall' },
    section: 'electrical',
  },
  {
    id: 'switch-simple',
    label: 'Switch',
    kind: 'electrical-device',
    defaults: { deviceType: 'switch', voltage: 127, mounting: 'wall' },
    section: 'electrical',
  },
  {
    id: 'ceiling-light',
    label: 'Ceiling Light',
    kind: 'electrical-device',
    defaults: { deviceType: 'light', voltage: 127, mounting: 'ceiling' },
    section: 'electrical',
  },
  {
    id: 'junction-box',
    label: 'Junction Box',
    kind: 'electrical-device',
    defaults: { deviceType: 'junction-box', voltage: 127, mounting: 'wall' },
    section: 'electrical',
  },
  {
    id: 'distribution-panel',
    label: 'Distribution Panel',
    kind: 'electrical-device',
    defaults: { deviceType: 'panel', voltage: 127, mounting: 'wall' },
    section: 'electrical',
  },
  {
    id: 'power-conduit',
    label: 'Power Conduit',
    kind: 'electrical-conduit',
    defaults: { system: 'power', diameter: 0.75, conduitMaterial: 'emt' },
    section: 'electrical',
  },
  {
    id: 'lighting-conduit',
    label: 'Lighting Conduit',
    kind: 'electrical-conduit',
    defaults: { system: 'lighting', diameter: 0.5, conduitMaterial: 'emt' },
    section: 'electrical',
  },
  {
    id: 'data-conduit',
    label: 'Data Conduit',
    kind: 'electrical-conduit',
    defaults: { system: 'data', diameter: 0.5, conduitMaterial: 'pvc' },
    section: 'electrical',
  },
]
