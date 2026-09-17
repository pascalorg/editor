import { beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, SiteNode } from '../schema'
import useScene from './use-scene'

const siteId = 'site_north' as AnyNodeId

beforeEach(() => {
  useScene.getState().setReadOnly(false)
  useScene.getState().unloadScene()
  useScene.temporal.getState().clear()
})

describe('scene north direction persistence', () => {
  test('adds the default to a legacy site when it is loaded', () => {
    const legacySite = {
      object: 'node',
      id: siteId,
      type: 'site',
      parentId: null,
      children: [],
    } as unknown as AnyNode

    useScene.getState().setScene({ [siteId]: legacySite }, [siteId])

    expect(useScene.getState().nodes[siteId]).toMatchObject({ northDirectionDeg: 0 })
  })

  test('preserves a custom heading across JSON serialization and scene loading', () => {
    const site = SiteNode.parse({ id: siteId, type: 'site', northDirectionDeg: 37.5 })
    const wireSite = JSON.parse(JSON.stringify(site)) as AnyNode

    useScene.getState().setScene({ [siteId]: wireSite }, [siteId])

    expect(useScene.getState().nodes[siteId]).toMatchObject({ northDirectionDeg: 37.5 })
  })

  test('normalizes a non-finite legacy heading to the default', () => {
    const invalidSite = {
      object: 'node',
      id: siteId,
      type: 'site',
      parentId: null,
      children: [],
      northDirectionDeg: Number.NaN,
    } as unknown as AnyNode

    useScene.getState().setScene({ [siteId]: invalidSite }, [siteId])

    expect(useScene.getState().nodes[siteId]).toMatchObject({ northDirectionDeg: 0 })
  })
})
