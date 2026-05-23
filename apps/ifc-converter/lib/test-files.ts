export interface TestFile {
  name: string
  label: string
  detail: string
  description: string
  /**
   * Served from `examplesBaseUrl` instead of the repo's `public/` folder.
   * The large IFC samples (tens of MB each) aren't committed to keep the
   * open-source repo lean; they're hosted externally and fetched at
   * runtime. Marked entries only appear once a base URL is configured.
   */
  remote?: boolean
  /** Shown as a caution on the example card (e.g. heavy models that can
   * tax the browser when rendered). */
  warning?: string
}

// Host serving the large (remote) example IFCs by filename. The big
// samples (tens of MB) aren't committed to keep the repo lean — they
// live in a public, read-only Supabase Storage bucket. Overridable via
// env (NEXT_PUBLIC_ is inlined at build time by Next.js); set it to ''
// to hide the remote examples entirely.
const DEFAULT_EXAMPLES_BASE_URL =
  'https://byrpxoiotywskoojsrzd.supabase.co/storage/v1/object/public/ifc_examples'

export const examplesBaseUrl = (
  process.env.NEXT_PUBLIC_IFC_EXAMPLES_BASE_URL ?? DEFAULT_EXAMPLES_BASE_URL
).replace(/\/$/, '')

export const testFiles: TestFile[] = [
  {
    name: '01-duplex.ifc',
    label: 'Duplex Apartment',
    detail: '1.2 MB',
    description: 'Multi-level apartment from IFC Tools Project',
  },
  {
    name: '02-schependomlaan.ifc',
    label: 'Schependomlaan',
    detail: '47 MB',
    description: 'Dutch apartment complex (buildingSMART)',
    remote: true,
    warning: 'Very large — may slow down or crash the browser when rendered.',
  },
  {
    name: '03-rac-sample-project.ifc',
    label: 'RAC Sample Project',
    detail: '43 MB',
    description: 'Revit commercial office building',
    remote: true,
  },
  {
    name: '04-ifc-open-house.ifc',
    label: 'IFC Open House',
    detail: '111 KB',
    description: 'Small residential house (IFC4)',
  },
  {
    name: '05-paris-ground-floor.ifc',
    label: 'Paris Building',
    detail: '3.9 MB',
    description: '19 rue Marc Antoine Petit, Paris',
  },
  {
    name: '06-sample-castle.ifc',
    label: 'Sample Castle',
    detail: '47 MB',
    description: 'Historic architecture demo model',
    remote: true,
    warning: 'Very large — may slow down or crash the browser when rendered.',
  },
  {
    name: '07-revit-architectural.ifc',
    label: 'Revit Architectural',
    detail: '13 MB',
    description: 'Autodesk Revit Architecture model',
    remote: true,
  },
  {
    name: '08-revit-mep.ifc',
    label: 'Revit MEP',
    detail: '28 MB',
    description: 'Building systems from Revit MEP',
    remote: true,
  },
  {
    name: '09-revit-structural.ifc',
    label: 'Revit Structural',
    detail: '11 MB',
    description: 'Structural engineering from Revit',
    remote: true,
  },
  {
    name: '10-sample-house.ifc',
    label: 'Sample House',
    detail: '2.2 MB',
    description: 'Complete residential house model',
  },
]

/** Resolve where to fetch a given example from. */
export function exampleFileUrl(file: TestFile): string {
  return file.remote ? `${examplesBaseUrl}/${file.name}` : `/test-ifc-files/${file.name}`
}

/**
 * Examples to show in the picker: the committed local ones always, plus
 * the remote ones once a base URL is configured (so a fresh clone with
 * no env doesn't surface examples that would 404).
 */
export function availableTestFiles(): TestFile[] {
  if (examplesBaseUrl) return testFiles
  return testFiles.filter((f) => !f.remote)
}
