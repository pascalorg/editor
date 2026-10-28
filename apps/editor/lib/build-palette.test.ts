import { expect, test } from 'bun:test'
import { registerNode } from '@pascal-app/core'
import { beamDefinition, columnDefinition, footingDefinition } from '@pascal-app/nodes'
import { collectBuildTypes } from './build-palette'

// The palette lists the kinds that bring a plan tool: the footing had none, so it was missing.
test('the Build palette lists the footing under Advanced', () => {
  registerNode(footingDefinition)
  expect(collectBuildTypes('default').find((type) => type.kind === 'footing')).toMatchObject({
    label: { message: 'Footing' },
    section: 'advanced',
  })
})

// The beam brings its plan tool; the post is the column tool armed with a framing post.
test('the Build palette lists Beam, and Post beside Column, under Advanced', () => {
  registerNode(beamDefinition)
  registerNode(columnDefinition)
  const types = collectBuildTypes('default')
  expect(types.find((type) => type.kind === 'beam')).toMatchObject({
    label: { message: 'Beam' },
    section: 'advanced',
    iconSrc: '/icons/beam.svg',
  })
  const ids = types.map((type) => type.id)
  expect(types.find((type) => type.id === 'post')).toMatchObject({
    kind: 'column',
    section: 'advanced',
  })
  expect(ids.indexOf('post')).toBe(ids.indexOf('column') + 1)
})
