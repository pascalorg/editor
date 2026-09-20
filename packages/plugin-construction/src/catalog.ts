export const CONSTRUCTION_PLUGIN_ID = 'pascal:construction'
export const CONSTRUCTION_PANEL_ID = 'pascal:construction:panel'

export const ELEMENT_CATEGORIES = [
  {
    id: 'site',
    label: 'Site & surroundings',
    description: 'The land and the connections around the house.',
    elements: [
      'Property boundary and terrain',
      'Site utilities and service entries',
      'Fences and outdoor context',
    ],
    note: 'A site record does not establish surveyed boundaries, zoning or utility availability.',
    kinds: ['site', 'fence', 'utility-line', 'utility-pole', 'service-point'],
  },
  {
    id: 'architecture',
    label: 'Spaces & building envelope',
    description: 'The layout, enclosure and openings of the house.',
    elements: ['Rooms and spaces', 'Walls, doors and windows', 'Roofs, ceilings and stairs'],
    note: 'Model geometry describes the design; hidden construction may still be unknown.',
    kinds: [
      'zone',
      'wall',
      'door',
      'window',
      'roof',
      'roof-segment',
      'ceiling',
      'stair',
      'skylight',
      'dormer',
      'chimney',
      'gutter',
    ],
  },
  {
    id: 'structure',
    label: 'Structure & framing',
    description: 'The members and assemblies that support the building.',
    elements: [
      'Slabs and foundation information',
      'Columns and framing members',
      'Framing settings and authored overrides',
    ],
    note: 'Settings are counted as records, not derived members. Sizes and assumptions require review.',
    kinds: ['slab', 'column', 'structural-grid', 'bones:lumber', 'bones:framing'],
  },
  {
    id: 'electrical',
    label: 'Electrical',
    description: 'Power distribution, service equipment and devices.',
    elements: [
      'Service entrance, meter and panel',
      'Switches, outlets and lighting',
      'Circuit and routing assumptions',
    ],
    note: 'A modeled device is not evidence of a complete or reviewed electrical design.',
    kinds: ['bones:device'],
  },
  {
    id: 'plumbing',
    label: 'Plumbing',
    description: 'Water supply, fixtures and drainage.',
    elements: [
      'Water entry and heating',
      'Pipes, fittings and traps',
      'Drain, waste and vent systems',
    ],
    note: 'Supply and drainage need their own inputs; visible pipes do not establish system completeness.',
    kinds: ['pipe-segment', 'pipe-fitting', 'pipe-trap'],
  },
  {
    id: 'hvac',
    label: 'Heating & cooling',
    description: 'Equipment and routes that serve the rooms.',
    elements: [
      'Heating and cooling equipment',
      'Ducts, terminals and fittings',
      'Refrigerant lines and controls',
    ],
    note: 'Equipment geometry does not establish calculated loads or suitable equipment sizing.',
    kinds: [
      'hvac-equipment',
      'duct-segment',
      'duct-fitting',
      'duct-terminal',
      'lineset',
      'liquid-line',
    ],
  },
  {
    id: 'fixtures',
    label: 'Fixtures & finishes',
    description: 'The objects and surfaces that complete the space.',
    elements: [
      'Placed furniture and fixtures',
      'Built-in items and shelving',
      'Finishes attached to model elements',
    ],
    note: 'The inventory lists placed records. Material slots and surface areas are not quantities in this release.',
    kinds: ['item', 'shelf', 'block'],
  },
  {
    id: 'references',
    label: 'Scans & reference models',
    description: 'Imported geometry and captured information used as context.',
    elements: ['Scans and captured meshes', 'Imported 3D reference models'],
    note: 'A mesh can be useful to view without containing the walls, spaces or system inputs needed for analysis.',
    kinds: ['scan', 'imported-mesh'],
  },
] as const

export type ElementCategoryId = (typeof ELEMENT_CATEGORIES)[number]['id']

export const OUTPUT_FAMILIES = [
  { id: 'documents', label: 'Documents', format: 'PDF' },
  { id: 'images', label: 'Images', format: 'PNG' },
  { id: 'renders', label: 'Renders', format: 'Image' },
  { id: 'objects', label: '3D objects', format: '3D' },
  { id: 'data', label: 'Schedules & data', format: 'CSV' },
] as const

export type OutputFamilyId = (typeof OUTPUT_FAMILIES)[number]['id']

export type ConstructionOutput = {
  id: string
  family: OutputFamilyId
  title: string
  description: string
  recipient: string
  includes: readonly string[]
  requires: readonly string[]
  availability: 'available' | 'planned'
  limitation: string
}

export const CONSTRUCTION_OUTPUTS: readonly ConstructionOutput[] = [
  {
    id: 'technical-review',
    family: 'documents',
    title: 'Technical review package',
    description: 'A focused drawing set for one construction question.',
    recipient: 'Builder and engineering partner',
    includes: [
      'Selected plans and sections',
      'Discipline assumptions',
      'Open questions and revision',
    ],
    requires: ['A model and review scope', 'Selected discipline inputs', 'Reviewed page selection'],
    availability: 'planned',
    limitation:
      'PDF generation is not connected to Construction yet. Generated content will need review.',
  },
  {
    id: 'pricing',
    family: 'documents',
    title: 'Pricing package',
    description: 'Give trades a clear scope and a consistent set of references.',
    recipient: 'Estimator and trade partners',
    includes: [
      'Dimensioned plans',
      'Relevant details and schedules',
      'Qualified quantities and exclusions',
    ],
    requires: ['A defined scope', 'Verified dimensions', 'Quantity sources and exclusions'],
    availability: 'planned',
    limitation:
      'This will describe quantities and scope; supplier prices and bids are outside this release.',
  },
  {
    id: 'client-review',
    family: 'documents',
    title: 'Client review package',
    description: 'Explain the design with a small, readable selection of views.',
    recipient: 'Homeowner and designer',
    includes: [
      'Project overview and floor plan',
      'Selected exterior views',
      'Open design decisions',
    ],
    requires: ['A model', 'Selected views', 'Project details'],
    availability: 'planned',
    limitation: 'Package generation will follow the technical review workflow.',
  },
  {
    id: 'submission',
    family: 'documents',
    title: 'Submission draft',
    description: 'Assemble the pages and references requested for a submission.',
    recipient: 'Responsible designer and permit reviewer',
    includes: [
      'Sheet index and project identity',
      'Selected discipline sheets',
      'References and unresolved items',
    ],
    requires: [
      'Applicable submission requirements',
      'Required model and site inputs',
      'Responsible author review',
    ],
    availability: 'planned',
    limitation: 'Generating pages will not establish permit readiness or professional approval.',
  },
  {
    id: 'drawing-images',
    family: 'images',
    title: 'Plans, sections & elevations',
    description: 'Individual technical views for conversations and presentations.',
    recipient: 'Project team and trade partners',
    includes: [
      'One selected view per image',
      'View title and model revision',
      'Relevant labels and dimensions',
    ],
    requires: ['A model', 'A view or section definition', 'Scale and visibility settings'],
    availability: 'planned',
    limitation: 'Image capture and revision tracking are not connected to this workspace yet.',
  },
  {
    id: 'renders',
    family: 'renders',
    title: 'Presentation renders',
    description: 'Images that communicate the intended appearance of the house.',
    recipient: 'Homeowner, designer and builder',
    includes: ['Selected camera views', 'Materials and appearance', 'Source model reference'],
    requires: ['A model', 'Saved cameras', 'A configured rendering workflow'],
    availability: 'planned',
    limitation:
      'Construction does not start render jobs yet. Presentation images are not technical drawings.',
  },
  {
    id: 'model-objects',
    family: 'objects',
    title: 'Model & system objects',
    description: 'Reusable 3D geometry for coordination and further work.',
    recipient: 'Designer and coordination team',
    includes: [
      'Selected model geometry',
      'Authored objects or accepted system output',
      'Units and source information',
    ],
    requires: ['A model', 'An explicit object selection', 'A supported export format'],
    availability: 'planned',
    limitation:
      'Export formats and editable-object support will be specified as engines are integrated.',
  },
  {
    id: 'quantities',
    family: 'data',
    title: 'Quantities & schedules',
    description: 'Measured construction information with its calculation basis.',
    recipient: 'Estimator and engineering partner',
    includes: [
      'Element or member schedule',
      'Units and calculation basis',
      'Assumptions and exclusions',
    ],
    requires: [
      'Supported model elements',
      'Discipline derivation where required',
      'A reviewed measurement basis',
    ],
    availability: 'planned',
    limitation:
      'Counting scene records is not a material takeoff. Quantities need separate verified calculations.',
  },
  {
    id: 'model-inventory',
    family: 'data',
    title: 'Model inventory',
    description: 'An exact list of recognized model records in the selected scope.',
    recipient: 'Builder, designer and engineering partner',
    includes: ['Record ID, name and type', 'Building element category', 'Building and level IDs'],
    requires: [
      'Recognized model records',
      'A building selection when the project contains several',
    ],
    availability: 'available',
    limitation:
      'This is an inventory of model records, not a quantity estimate, analysis or completeness check.',
  },
]

export const CONSTRUCTION_WORKFLOW = [
  {
    title: 'Understand the model',
    description: 'Identify the building, its elements and the information that is present.',
    result: 'A defined review scope',
  },
  {
    title: 'Review the construction',
    description:
      'Inspect one discipline, its inputs and its assumptions. Record what still needs review.',
    result: 'Construction questions and accepted inputs',
  },
  {
    title: 'Prepare the handoff',
    description:
      'Choose the recipient and the output. Keep the model revision and exclusions with it.',
    result: 'A focused package or artifact',
  },
] as const
