'use client'

import type { ReactNode } from 'react'

export function FieldHint({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-[10px] leading-relaxed">{children}</p>
}

export function FieldExampleList({ items }: { items: string[] }) {
  return (
    <ul className="list-inside list-disc space-y-0.5 text-[10px] text-muted-foreground leading-relaxed">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

export function CatalogPlacementFieldGuide() {
  return (
    <details className="rounded-lg border border-border/60 bg-muted/15 px-2.5 py-2 text-xs">
      <summary className="cursor-pointer font-medium text-muted-foreground text-xs select-none">
        Field guide and numeric examples
      </summary>
      <div className="mt-2 space-y-3 border-border/40 border-t pt-2">
        <section className="space-y-1">
          <p className="font-medium text-[11px]">dimensions (width x height x depth, metres)</p>
          <FieldHint>
            Controls the red/green placement placeholder, placement checks, and collision checks.
            It does not scale the GLB model itself.
          </FieldHint>
          <FieldExampleList
            items={[
              '0.1 x 0.1 x 0.1 - about a 10 cm object',
              '0.9 x 2.1 x 0.12 - typical single-door opening',
              '1.0 x 1.0 x 1.0 - about a 1 m cube',
              'If the frame and model do not match, adjust dimensions instead of using scale.',
            ]}
          />
        </section>

        <section className="space-y-1">
          <p className="font-medium text-[11px]">scale (GLB visual scale)</p>
          <FieldHint>
            Changes only the visible model size. The red/green placement frame does not change.
          </FieldHint>
          <FieldExampleList
            items={[
              '1 - GLB already uses metres',
              '0.1 - file is about 10 times too large',
              '0.001 - millimetre CAD data',
              'Usually keep all three axes equal. Scale alone will not make placement valid.',
            ]}
          />
        </section>

        <section className="space-y-1">
          <p className="font-medium text-[11px]">offset (GLB translation, metres)</p>
          <FieldHint>
            Moves the model away from the placement point. The placement frame does not move. Use
            this for floor contact, wall-mounted parts, and similar fine tuning.
          </FieldHint>
          <FieldExampleList
            items={[
              '[0, 0, 0] - no extra movement',
              'y = 0.065 - move about 6.5 cm up',
              'y = -0.05 - move about 5 cm down if the model floats',
            ]}
          />
        </section>

        <section className="space-y-1">
          <p className="font-medium text-[11px]">rotation (radians)</p>
          <FieldHint>
            Rotates only the GLB. The frame does not rotate. pi is about 3.1416; 90 deg is about
            1.5708.
          </FieldHint>
          <FieldExampleList
            items={[
              '[0, 0, 0] - keep exported orientation',
              'x = -1.5708 - stand up Z-up CAD doors or wall parts',
              'z = 1.5708 - rotate a door sideways',
            ]}
          />
        </section>

        <section className="space-y-1">
          <p className="font-medium text-[11px]">attachTo (placement target)</p>
          <FieldExampleList
            items={[
              'blank - place on the floor',
              'wall - centered in wall thickness and occupies both sides',
              'wall-side - attached to one wall face',
              'ceiling - attached to the ceiling',
            ]}
          />
        </section>

        <section className="space-y-1 rounded-md bg-background/60 p-2">
          <p className="font-medium text-[11px]">Example: single door, millimetre GLB, wall side</p>
          <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[10px] text-muted-foreground leading-relaxed">
            {`dimensions: [0.9, 2.1, 0.12]
offset: [0, 0, 0]
rotation: [-1.5708, 0, 0]   // about -90 deg on X
scale: [0.001, 0.001, 0.001]
attachTo: 'wall-side'`}
          </pre>
          <FieldHint>
            Enter the model URL, run auto-fill, then tune these values. For wall objects, move the
            cursor over the wall face before placing.
          </FieldHint>
        </section>
      </div>
    </details>
  )
}

export const DIMENSIONS_HINT = (
  <>
    <FieldHint>
      Unit: metres. Controls the red/green frame and placement validity. It does not scale the GLB.
    </FieldHint>
    <FieldExampleList
      items={[
        '0.1 - about a 10 cm object',
        '1.0 - about a 1 m furniture object',
        '0.9 x 2.1 - typical door opening width and height',
      ]}
    />
  </>
)

export const SCALE_HINT = (
  <>
    <FieldHint>Scales only the visible GLB. Change the frame with dimensions.</FieldHint>
    <FieldExampleList items={['1 - metre-based GLB', '0.001 - millimetre CAD', '0.1 - file is 10 times too large']} />
  </>
)

export const OFFSET_HINT = (
  <>
    <FieldHint>
      Moves the model in metres. The frame does not move. Adjust y for floating models and z for
      wall-mounted models.
    </FieldHint>
    <FieldExampleList items={['0 - no movement', '0.065 - about 6.5 cm up']} />
  </>
)

export const ROTATION_HINT = (
  <>
    <FieldHint>Radians. Rotates only the model. 90 deg is about 1.5708.</FieldHint>
    <FieldExampleList items={['0 - no rotation', '-1.5708 - stand up a Z-up CAD model on X']} />
  </>
)

export function AttachToHint({ attachTo }: { attachTo: '' | 'wall' | 'wall-side' | 'ceiling' }) {
  if (attachTo === 'wall') {
    return (
      <FieldHint>
        Centered in the wall thickness and occupied on both sides. For asymmetric door GLBs, a
        handle may only be visible on one side. Consider offset, cutout settings, or wall-side.
      </FieldHint>
    )
  }
  if (attachTo === 'wall-side') {
    return (
      <FieldHint>
        Attached to one wall face. Best for single doors, wall lamps, and shelves. Place it by
        hovering over the wall face.
      </FieldHint>
    )
  }
  if (attachTo === 'ceiling') {
    return <FieldHint>Hangs below the ceiling. Place it by hovering over the ceiling.</FieldHint>
  }
  if (attachTo === '') {
    return <FieldHint>Placed on the floor. The cursor is on the floor and the frame sits on it.</FieldHint>
  }
  return (
    <FieldHint>
      Floor: click the floor. wall / wall-side: click a wall face. See the field guide above.
    </FieldHint>
  )
}
