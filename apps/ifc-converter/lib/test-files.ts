export interface TestFile {
  name: string
  /** Dictionary key — resolved by the UI via useTranslations(). */
  labelKey: string
  /** File size as a raw number + unit (kept as-is; "MB" stays untranslated). */
  detail: string
  /** Dictionary key — resolved by the UI via useTranslations(). */
  descriptionKey: string
  /**
   * Served from `examplesBaseUrl` instead of the repo's `public/` folder.
   * The large IFC samples (tens of MB each) aren't committed to keep the
   * open-source repo lean; they're hosted externally and fetched at
   * runtime. Marked entries only appear once a base URL is configured.
   */
  remote?: boolean
  /** Dictionary key for a caution shown on the example card (e.g.
   * heavy models that can tax the browser when rendered). */
  warningKey?: string
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
    labelKey: 'ifcConverter.examples.01.label',
    detail: '1.2 MB',
    descriptionKey: 'ifcConverter.examples.01.description',
  },
  {
    name: '02-schependomlaan.ifc',
    labelKey: 'ifcConverter.examples.02.label',
    detail: '47 MB',
    descriptionKey: 'ifcConverter.examples.02.description',
    remote: true,
    warningKey: 'ifcConverter.examples.heavy',
  },
  {
    name: '03-rac-sample-project.ifc',
    labelKey: 'ifcConverter.examples.03.label',
    detail: '43 MB',
    descriptionKey: 'ifcConverter.examples.03.description',
    remote: true,
  },
  {
    name: '04-ifc-open-house.ifc',
    labelKey: 'ifcConverter.examples.04.label',
    detail: '111 KB',
    descriptionKey: 'ifcConverter.examples.04.description',
  },
  {
    name: '05-paris-ground-floor.ifc',
    labelKey: 'ifcConverter.examples.05.label',
    detail: '3.9 MB',
    descriptionKey: 'ifcConverter.examples.05.description',
  },
  {
    name: '06-sample-castle.ifc',
    labelKey: 'ifcConverter.examples.06.label',
    detail: '47 MB',
    descriptionKey: 'ifcConverter.examples.06.description',
    remote: true,
    warningKey: 'ifcConverter.examples.heavy',
  },
  {
    name: '07-revit-architectural.ifc',
    labelKey: 'ifcConverter.examples.07.label',
    detail: '13 MB',
    descriptionKey: 'ifcConverter.examples.07.description',
    remote: true,
  },
  {
    name: '08-revit-mep.ifc',
    labelKey: 'ifcConverter.examples.08.label',
    detail: '28 MB',
    descriptionKey: 'ifcConverter.examples.08.description',
    remote: true,
  },
  {
    name: '09-revit-structural.ifc',
    labelKey: 'ifcConverter.examples.09.label',
    detail: '11 MB',
    descriptionKey: 'ifcConverter.examples.09.description',
    remote: true,
  },
  {
    name: '10-sample-house.ifc',
    labelKey: 'ifcConverter.examples.10.label',
    detail: '2.2 MB',
    descriptionKey: 'ifcConverter.examples.10.description',
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