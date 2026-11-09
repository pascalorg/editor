import { type Expr, parseRecipe, type Recipe } from './recipe'

const add = (...args: Expr[]): Expr => ({ op: 'add', args })
const sub = (...args: Expr[]): Expr => ({ op: 'sub', args })
const mul = (...args: Expr[]): Expr => ({ op: 'mul', args })
const div = (...args: Expr[]): Expr => ({ op: 'div', args })
const p = (
  id: string,
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  extra: Partial<Recipe['parameters'][number]> = {},
): Recipe['parameters'][number] => ({
  id,
  label,
  default: value,
  min,
  max,
  step,
  unit: 'm',
  ...extra,
})
export const shelfRecipe = parseRecipe({
  version: 1,
  name: 'Everyday shelf',
  description: 'An open timber bookcase with adjustable shelves and a contrasting back.',
  parameters: [
    p('width', 'Width', 1.2, 0.6, 2.4, 0.05, { axis: 'x' }),
    p('height', 'Height', 1.8, 0.8, 2.5, 0.05, { axis: 'y' }),
    p('depth', 'Depth', 0.4, 0.25, 0.7, 0.025, { axis: 'z' }),
    p('rows', 'Shelves', 4, 2, 7, 1, { unit: 'count', part: 'shelves' }),
    p('thickness', 'Board thickness', 0.03, 0.015, 0.06, 0.005, { part: 'frame' }),
  ],
  slots: [
    { id: 'frame', label: 'Frame', color: '#b58a60' },
    { id: 'shelves', label: 'Shelves', color: '#d5b38d' },
    { id: 'back', label: 'Back', color: '#495b50' },
  ],
  parts: [
    {
      id: 'frame',
      label: 'Frame',
      count: 2,
      shapes: [
        {
          id: 'side',
          primitive: 'box',
          slot: 'frame',
          size: ['thickness', 'height', 'depth'],
          position: [mul(sub('index', 0.5), sub('width', 'thickness')), div('height', 2), 0],
        },
      ],
    },
    {
      id: 'shelves',
      label: 'Shelves',
      count: 'rows',
      shapes: [
        {
          id: 'board',
          primitive: 'box',
          slot: 'shelves',
          size: [sub('width', mul(2, 'thickness')), 'thickness', 'depth'],
          position: [
            0,
            add(div('thickness', 2), mul('index', div(sub('height', 'thickness'), sub('rows', 1)))),
            0,
          ],
          support: true,
        },
      ],
    },
    {
      id: 'back',
      label: 'Back panel',
      count: 1,
      shapes: [
        {
          id: 'panel',
          primitive: 'box',
          slot: 'back',
          size: [sub('width', mul(2, 'thickness')), 'height', 0.012],
          position: [0, div('height', 2), add(div('depth', -2), 0.006)],
        },
      ],
    },
  ],
  constraints: [],
})
export const bedRecipe = parseRecipe({
  version: 1,
  name: 'Quiet bed',
  description: 'An upholstered bed with a timber frame and independently adjustable pillows.',
  parameters: [
    p('width', 'Width', 1.6, 1, 2.2, 0.05, { axis: 'x' }),
    p('length', 'Length', 2.1, 1.8, 2.5, 0.05, { axis: 'z' }),
    p('headboard_height', 'Headboard height', 1.1, 0.75, 1.5, 0.05, {
      axis: 'y',
      part: 'headboard',
    }),
    p('frame_height', 'Frame height', 0.3, 0.2, 0.5, 0.025, { part: 'frame' }),
    p('pillows', 'Pillow count', 2, 1, 3, 1, { unit: 'count', part: 'pillows' }),
    p('pillow_depth', 'Pillow depth', 0.38, 0.25, 0.55, 0.025, { part: 'pillows' }),
  ],
  slots: [
    { id: 'wood', label: 'Frame', color: '#875d42' },
    { id: 'fabric', label: 'Headboard', color: '#a8a08f' },
    { id: 'linen', label: 'Bedding', color: '#e8dfce' },
    { id: 'pillows', label: 'Pillows', color: '#a3b5a8' },
  ],
  parts: [
    {
      id: 'frame',
      label: 'Bed frame',
      count: 1,
      shapes: [
        {
          id: 'base',
          primitive: 'roundedBox',
          slot: 'wood',
          size: ['width', 'frame_height', 'length'],
          position: [0, div('frame_height', 2), 0],
          radius: 0.035,
        },
      ],
    },
    {
      id: 'mattress',
      label: 'Mattress',
      count: 1,
      shapes: [
        {
          id: 'mattress',
          primitive: 'roundedBox',
          slot: 'linen',
          size: [sub('width', 0.08), 0.22, sub('length', 0.12)],
          position: [0, add('frame_height', 0.11), 0.03],
          radius: 0.08,
          support: true,
        },
      ],
    },
    {
      id: 'headboard',
      label: 'Headboard',
      count: 1,
      shapes: [
        {
          id: 'panel',
          primitive: 'roundedBox',
          slot: 'fabric',
          size: [add('width', 0.04), 'headboard_height', 0.09],
          position: [0, div('headboard_height', 2), div('length', -2)],
          radius: 0.035,
        },
      ],
    },
    {
      id: 'pillows',
      label: 'Pillows',
      count: 'pillows',
      shapes: [
        {
          id: 'pillow',
          primitive: 'roundedBox',
          slot: 'pillows',
          size: [sub(div(sub('width', 0.16), 'pillows'), 0.04), 0.15, 'pillow_depth'],
          position: [
            mul(sub(add('index', 0.5), div('pillows', 2)), div(sub('width', 0.16), 'pillows')),
            add('frame_height', 0.295),
            add(div('length', -2), div('pillow_depth', 2), 0.16),
          ],
          radius: 0.065,
        },
      ],
    },
  ],
  constraints: [],
})
export const radiatorRecipe = parseRecipe({
  version: 1,
  name: 'Wall radiator',
  description:
    'A wall-mounted panel radiator with adjustable width, height and fins. The valve stays outside the nominal width.',
  classification: {
    category: 'radiator',
    functionTags: ['heating'],
    tags: ['radiator', 'wall-mounted'],
  },
  mounting: { attachTo: 'wall-side', reference: 'back' },
  parameters: [
    p('width', 'Panel width', 1.2, 0.6, 2, 0.05, { axis: 'x' }),
    p('height', 'Panel height', 0.6, 0.3, 0.9, 0.05, { axis: 'y' }),
    p('depth', 'Panel depth', 0.1, 0.06, 0.18, 0.01, { axis: 'z' }),
    p('fins', 'Fins', 12, 4, 24, 1, { unit: 'count', part: 'panel' }),
  ],
  slots: [
    { id: 'body', label: 'Painted metal', color: '#eeeae2' },
    { id: 'valve', label: 'Valve', color: '#a5adb5' },
  ],
  surfaces: [
    {
      id: 'back',
      label: 'Wall mounting face',
      position: [0, div('height', 2), div('depth', -2)],
      rotation: [-Math.PI / 2, 0, 0],
      size: ['width', 'height'],
    },
  ],
  parts: [
    {
      id: 'panel',
      label: 'Radiator fins',
      count: 'fins',
      shapes: [
        {
          id: 'fin',
          primitive: 'roundedBox',
          slot: 'body',
          size: [sub(div('width', 'fins'), 0.008), 'height', 'depth'],
          position: [
            sub(mul(add('index', 0.5), div('width', 'fins')), div('width', 2)),
            div('height', 2),
            0,
          ],
          radius: 0.006,
        },
      ],
    },
    {
      id: 'pipes',
      label: 'Manifolds',
      count: 2,
      shapes: [
        {
          id: 'pipe',
          primitive: 'cylinder',
          slot: 'body',
          size: [0.035, 'width', 0.035],
          position: [0, add(0.055, mul('index', sub('height', 0.11))), 0],
          rotation: [0, 0, Math.PI / 2],
        },
      ],
    },
    {
      id: 'valve',
      label: 'Valve',
      count: 1,
      shapes: [
        {
          id: 'knob',
          primitive: 'cylinder',
          slot: 'valve',
          size: [0.06, 0.08, 0.06],
          position: [add(div('width', 2), 0.04), 0.08, 0],
          rotation: [0, 0, Math.PI / 2],
        },
      ],
    },
  ],
  constraints: [],
})
export const counterRecipe = parseRecipe({
  version: 1,
  name: 'Kitchen counter',
  description:
    'A floor-supported counter with a splashback and a named worktop for real items. Nearby walls do not host it.',
  classification: { category: 'counter', functionTags: ['kitchen'], tags: ['counter', 'worktop'] },
  parameters: [
    p('width', 'Width', 1.6, 0.6, 2.8, 0.05, { axis: 'x' }),
    p('height', 'Worktop height', 0.9, 0.7, 1.1, 0.025, { axis: 'y' }),
    p('depth', 'Depth', 0.65, 0.35, 0.9, 0.025, { axis: 'z' }),
    p('splashback', 'Splashback height', 0.2, 0.05, 0.4, 0.025, { part: 'splashback' }),
  ],
  slots: [
    { id: 'cabinet', label: 'Cabinet', color: '#668579' },
    { id: 'stone', label: 'Worktop and splashback', color: '#ded8cb' },
  ],
  surfaces: [
    {
      id: 'worktop',
      label: 'Worktop',
      position: [0, 'height', 0.025],
      size: [sub('width', 0.04), sub('depth', 0.09)],
    },
  ],
  parts: [
    {
      id: 'cabinet',
      label: 'Cabinet',
      count: 1,
      shapes: [
        {
          id: 'body',
          primitive: 'box',
          slot: 'cabinet',
          size: [sub('width', 0.04), sub('height', 0.04), sub('depth', 0.04)],
          position: [0, div(sub('height', 0.04), 2), 0],
        },
      ],
    },
    {
      id: 'worktop',
      label: 'Worktop',
      count: 1,
      shapes: [
        {
          id: 'top',
          primitive: 'box',
          slot: 'stone',
          size: ['width', 0.04, 'depth'],
          position: [0, sub('height', 0.02), 0],
        },
      ],
    },
    {
      id: 'splashback',
      label: 'Splashback',
      count: 1,
      shapes: [
        {
          id: 'back',
          primitive: 'box',
          slot: 'stone',
          size: ['width', 'splashback', 0.025],
          position: [0, add('height', div('splashback', 2)), add(div('depth', -2), 0.0125)],
        },
      ],
    },
  ],
  constraints: [],
})
export const experimentBriefs = [
  {
    id: 'shelf_open',
    prompt:
      'Create a freestanding open oak bookcase, 1.2 m wide and 1.8 m tall, with adjustable width, height, depth and shelf count. Expose frame and shelf material slots and shelf support surfaces.',
  },
  {
    id: 'shelf_asymmetric',
    prompt:
      'Create an asymmetric low bookcase with a wide open compartment on the left and a narrow stack of shelves on the right. Expose overall width, height, depth and right shelf count. Use contrasting frame and back colors.',
  },
  {
    id: 'bed_timber',
    prompt:
      'Create a timber platform bed with a mattress, a headboard and two pillows. Expose bed width, length, headboard height, pillow count and pillow size. Pillows must remain above the mattress when resized. Separate frame, bedding and pillow material slots.',
  },
  {
    id: 'bed_upholstered',
    prompt:
      'Create an upholstered bed with a tall rounded headboard, a low base, mattress and three pillows. Expose bed width, length, headboard height and pillow count. Include independently adjustable pillow depth and separate material slots.',
  },
  {
    id: 'bench',
    prompt:
      'Create a park bench with a slatted timber seat, backrest and two metal supports. Expose width, seat height, depth and slat count. Changing width must preserve support thickness. Separate timber and metal slots.',
  },
  {
    id: 'divider',
    prompt:
      'Create a freestanding room divider with repeated vertical timber slats on a base. Expose width, height, depth and slat count. Keep every slat above the ground and evenly distributed when resized. Separate slat and base slots.',
  },
] as const
