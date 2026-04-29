#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const STORAGE_KEY = 'pascal-editor-scene'
const MASTER_GROUP_ID = 'light.pascal_master_bedroom_lights_group'
const FAN_ID = 'fan.pascal_master_bedroom_fan'
const TV_ID = 'media_player.family_room_tv'
const TV_COLLECTION_ID = `collection_ha_render_check_${TV_ID.replace(/[^a-z0-9_-]/gi, '_')}`
const LIGHT_IDS = [
  'light.pascal_master_bedroom_recessed_light_1',
  'light.pascal_master_bedroom_recessed_light_2',
  'light.pascal_master_bedroom_recessed_light_3',
  'light.pascal_master_bedroom_recessed_light_4',
]
const MASTER_COLLECTION_ID = 'collection_ha_light_pascal_master_bedroom_lights_group'
const MASTER_BINDING_ID = 'ha-binding_render_check_master'
const traceStartedAt = Date.now()
const traceEnabled = process.env.PASCAL_HA_PILL_TRACE === '1'

function trace(message) {
  if (traceEnabled) {
    console.error(`[${((Date.now() - traceStartedAt) / 1000).toFixed(1)}s] ${message}`)
  }
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) {
      continue
    }

    const key = arg.slice(2)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      args[key] = true
      continue
    }

    args[key] = value
    index += 1
  }
  return args
}

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean)

  const browserPath = candidates.find((candidate) => existsSync(candidate))
  if (!browserPath) {
    throw new Error('Chrome or Edge was not found for the rendered browser check.')
  }
  return browserPath
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close(() => {
        if (typeof port === 'number') {
          resolve(port)
        } else {
          reject(new Error('Failed to allocate a free debugging port.'))
        }
      })
    })
  })
}

async function fetchJson(url, timeoutMs = 10_000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal })
    const text = await response.text()
    let payload = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = text
    }

    if (!response.ok) {
      throw new Error(`${url} returned ${response.status}: ${text.slice(0, 400)}`)
    }
    return payload
  } finally {
    clearTimeout(timeout)
  }
}

async function waitFor(predicate, { intervalMs = 150, message, timeoutMs }) {
  const deadline = Date.now() + timeoutMs
  let lastError = null

  while (Date.now() < deadline) {
    try {
      const value = await predicate()
      if (value) {
        return value
      }
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(`${message ?? 'Timed out waiting for condition'}${lastError ? `: ${lastError.message}` : ''}`)
}

class CdpClient {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()
    this.exceptions = []
  }

  async open() {
    this.socket = new WebSocket(this.webSocketUrl)
    this.socket.addEventListener('message', (event) => this.handleMessage(event))

    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
  }

  handleMessage(event) {
    const message = JSON.parse(event.data)

    if (message.id && this.pending.has(message.id)) {
      const { reject, resolve } = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (message.error) {
        reject(new Error(message.error.message ?? JSON.stringify(message.error)))
      } else {
        resolve(message.result)
      }
      return
    }

    if (message.method === 'Runtime.exceptionThrown') {
      const exception = message.params?.exceptionDetails
      this.exceptions.push(exception?.text ?? exception?.exception?.description ?? 'Runtime exception')
    }

    const key = `${message.sessionId ?? ''}:${message.method}`
    const listeners = this.listeners.get(key)
    if (listeners) {
      for (const listener of listeners) {
        listener(message.params ?? {})
      }
    }
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId
    this.nextId += 1

    const message = { id, method, params }
    if (sessionId) {
      message.sessionId = sessionId
    }

    return new Promise((resolve, reject) => {
      this.pending.set(id, { reject, resolve })
      this.socket.send(JSON.stringify(message))
    })
  }

  async waitForEvent(method, sessionId, timeoutMs) {
    const key = `${sessionId ?? ''}:${method}`
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const listeners = this.listeners.get(key) ?? []
        this.listeners.set(
          key,
          listeners.filter((listener) => listener !== onEvent),
        )
        reject(new Error(`Timed out waiting for ${method}`))
      }, timeoutMs)

      const onEvent = (params) => {
        clearTimeout(timeout)
        const listeners = this.listeners.get(key) ?? []
        this.listeners.set(
          key,
          listeners.filter((listener) => listener !== onEvent),
        )
        resolve(params)
      }

      this.listeners.set(key, [...(this.listeners.get(key) ?? []), onEvent])
    })
  }

  close() {
    try {
      this.socket?.close()
    } catch {}
  }
}

function toBindingResource(resource) {
  const memberEntityIds = Array.isArray(resource.memberEntityIds) ? resource.memberEntityIds : []
  return {
    actions: Array.isArray(resource.actions) ? resource.actions : [],
    capabilities: Array.isArray(resource.capabilities) ? resource.capabilities : [],
    defaultActionKey:
      typeof resource.defaultActionKey === 'string' ? resource.defaultActionKey : null,
    entityId: typeof resource.entityId === 'string' ? resource.entityId : resource.id,
    id: resource.id,
    ...(resource.isGroup === true || memberEntityIds.length > 0
      ? {
          isGroup: true,
          memberEntityIds,
        }
      : {}),
    kind: resource.kind ?? 'entity',
    label: resource.label ?? resource.id,
  }
}

async function buildSeedScene(baseUrl) {
  const [layout, importPayload] = await Promise.all([
    fetchJson(`${baseUrl}/api/default-layout`, 15_000),
    fetchJson(`${baseUrl}/api/home-assistant/import-resources`, 15_000),
  ])
  const resources = Array.isArray(importPayload.resources) ? importPayload.resources : []
  const resourcesById = new Map(resources.map((resource) => [resource.id, resource]))
  const requiredIds = [MASTER_GROUP_ID, FAN_ID, TV_ID, ...LIGHT_IDS]
  const missingIds = requiredIds.filter((id) => !resourcesById.has(id))
  if (missingIds.length > 0) {
    throw new Error(
      `Missing HA resources needed by rendered persistence check: ${missingIds.join(', ')}`,
    )
  }

  const collectionId = MASTER_COLLECTION_ID
  const bindingId = MASTER_BINDING_ID
  const bindingResources = [
    resourcesById.get(MASTER_GROUP_ID),
    ...LIGHT_IDS.map((id) => resourcesById.get(id)),
    resourcesById.get(FAN_ID),
  ].map(toBindingResource)
  const scene = structuredClone(layout)
  const itemAsset =
    Object.values(scene.nodes ?? {}).find((node) => node?.type === 'item' && node.asset)?.asset ??
    {
      category: 'fixture',
      dimensions: [0.4, 0.1, 0.4],
      id: 'ha-render-check-fixture',
      name: 'HA render check fixture',
      offset: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      src: '/models/placeholder.glb',
      thumbnail: '',
    }
  const levelNode = Object.values(scene.nodes ?? {}).find((node) => node?.type === 'level')
  const levelId = levelNode?.id ?? null
  const boundResourceIds = [...LIGHT_IDS, FAN_ID, TV_ID]
  const boundItemIds = new Map(
    boundResourceIds.map((resourceId, index) => [
      resourceId,
      `item_ha_render_check_${index + 1}_${resourceId.replace(/[^a-z0-9_-]/gi, '_')}`,
    ]),
  )
  const boundCollectionIds = new Map(
    boundResourceIds.map((resourceId) => [
      resourceId,
      `collection_ha_render_check_${resourceId.replace(/[^a-z0-9_-]/gi, '_')}`,
    ]),
  )
  const boundBindingIds = new Map(
    boundResourceIds.map((resourceId) => [
      resourceId,
      `ha-binding_render_check_${resourceId.replace(/[^a-z0-9_-]/gi, '_')}`,
    ]),
  )
  const nextNodes = { ...(scene.nodes ?? {}) }
  const nextCollections = { ...(scene.collections ?? {}) }
  const nextRootNodeIds = [...(scene.rootNodeIds ?? [])]

  function cloneItemAsset(resourceId) {
    const resource = resourcesById.get(resourceId)
    const domain = resource?.domain ?? resourceId.split('.')[0] ?? 'entity'
    return {
      ...itemAsset,
      category: domain,
      id: `ha-render-check-${resourceId.replace(/[^a-z0-9_-]/gi, '-')}`,
      interactive: {
        controls: [
          {
            default: false,
            kind: 'toggle',
            label: 'Power',
          },
        ],
        effects: [],
      },
      name: resource?.label ?? resourceId,
    }
  }

  for (const [index, resourceId] of boundResourceIds.entries()) {
    const itemId = boundItemIds.get(resourceId)
    const boundCollectionId = boundCollectionIds.get(resourceId)
    const boundBindingId = boundBindingIds.get(resourceId)
    const boundResource = resourcesById.get(resourceId)
    if (!(itemId && boundCollectionId && boundBindingId && boundResource)) {
      continue
    }

    nextNodes[itemId] = {
      asset: cloneItemAsset(resourceId),
      children: [],
      collectionIds: [boundCollectionId],
      id: itemId,
      metadata: {},
      object: 'node',
      parentId: levelId,
      position: [-2 + index * 0.8, 3.5, index % 2 === 0 ? -0.5 : 0.5],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      type: 'item',
      visible: true,
    }
    nextCollections[boundCollectionId] = {
      controlNodeId: itemId,
      id: boundCollectionId,
      name: boundResource.label ?? resourceId,
      nodeIds: [itemId],
    }
    nextNodes[boundBindingId] = {
      aggregation: 'single',
      collectionId: boundCollectionId,
      id: boundBindingId,
      metadata: {},
      name: boundResource.label ?? resourceId,
      object: 'node',
      parentId: null,
      presentation: {
        label: boundResource.label ?? resourceId,
        ...(resourceId === TV_ID ? { rtsScreenPosition: { x: 0.68, y: 0.55 } } : {}),
      },
      primaryResourceId: resourceId,
      resources: [toBindingResource(boundResource)],
      type: 'home-assistant-binding',
      visible: true,
    }
    nextRootNodeIds.push(boundBindingId)
  }

  if (levelId && levelNode) {
    nextNodes[levelId] = {
      ...levelNode,
      children: Array.from(
        new Set([
          ...(Array.isArray(levelNode.children) ? levelNode.children : []),
          ...boundItemIds.values(),
        ]),
      ),
    }
  }

  scene.collections = {
    ...nextCollections,
    [collectionId]: {
      id: collectionId,
      name: 'Master',
      nodeIds: [],
    },
  }
  scene.nodes = {
    ...nextNodes,
    [bindingId]: {
      aggregation: 'all',
      collectionId,
      id: bindingId,
      metadata: {},
      name: 'Master',
      object: 'node',
      parentId: null,
      presentation: {
        label: 'Master',
        rtsRoomControls: {
          groups: [
            {
              memberResourceIds: [...LIGHT_IDS, FAN_ID],
            },
          ],
          mode: 'ha-derived',
        },
        rtsScreenPosition: { x: 0.48, y: 0.55 },
      },
      primaryResourceId: MASTER_GROUP_ID,
      resources: bindingResources,
      type: null,
      visible: true,
    },
  }
  scene.rootNodeIds = Array.from(new Set([...nextRootNodeIds, bindingId]))

  return {
    bindingId,
    collectionId,
    scene,
    tvCollectionId: TV_COLLECTION_ID,
    seededResourceIds: bindingResources.map((resource) => resource.id),
  }
}

function getStorageId(baseUrl) {
  return {
    isLocalStorage: true,
    securityOrigin: new URL(baseUrl).origin,
  }
}

async function writeSeedScene(client, sessionId, baseUrl, seed) {
  await client.send(
    'DOMStorage.setDOMStorageItem',
    {
      key: STORAGE_KEY,
      storageId: getStorageId(baseUrl),
      value: JSON.stringify(seed.scene),
    },
    sessionId,
  )

  return {
    baseUrl: new URL(baseUrl).origin,
    seededBindingId: seed.bindingId,
    seededResourceIds: seed.seededResourceIds,
  }
}

async function readPersistedState(client, sessionId, baseUrl) {
  const result = await client.send(
    'DOMStorage.getDOMStorageItems',
    {
      storageId: getStorageId(baseUrl),
    },
    sessionId,
  )
  const raw = result.entries?.find(([key]) => key === STORAGE_KEY)?.[1]
  if (!raw) {
    throw new Error('No persisted editor scene was found in browser localStorage.')
  }

  const scene = JSON.parse(raw)
  const bindingEntries = Object.entries(scene.nodes ?? {}).filter(
    ([, node]) =>
      node?.type === 'home-assistant-binding' && node.collectionId === MASTER_COLLECTION_ID,
  )
  const [bindingId, binding] =
    bindingEntries.find(([, node]) => node.presentation?.rtsRoomControls?.mode === 'user-managed') ??
    bindingEntries.at(-1) ??
    [MASTER_BINDING_ID, scene.nodes?.[MASTER_BINDING_ID]]
  if (!binding) {
    throw new Error(`Persisted binding for ${MASTER_COLLECTION_ID} was not found after reload.`)
  }

  const roomControls = binding.presentation?.rtsRoomControls ?? {}
  return {
    bindingId,
    collectionId: binding.collectionId,
    excludedResourceIds: roomControls.excludedResourceIds ?? [],
    groups: (roomControls.groups ?? []).map((group) => group.memberResourceIds ?? []),
    mode: roomControls.mode ?? null,
    resources: (binding.resources ?? []).map((resource) => resource.id),
  }
}

function assertPersistedState(state) {
  const flatGroups = state.groups.flat()
  const missingLights = LIGHT_IDS.filter((id) => !flatGroups.includes(id))
  const failures = []

  if (state.mode !== 'user-managed') {
    failures.push(`mode is ${state.mode}, expected user-managed`)
  }
  if (missingLights.length > 0) {
    failures.push(`missing light controls: ${missingLights.join(', ')}`)
  }
  if (!flatGroups.includes(TV_ID)) {
    failures.push(`added TV control ${TV_ID} was not preserved`)
  }
  if (flatGroups.includes(FAN_ID)) {
    failures.push(`removed fan control ${FAN_ID} reappeared in pill groups`)
  }
  if (!state.excludedResourceIds.includes(FAN_ID)) {
    failures.push(`removed fan ${FAN_ID} is not preserved as excluded`)
  }
  if (!state.resources.includes(TV_ID)) {
    failures.push(`added TV resource ${TV_ID} was not preserved on binding`)
  }
  if (state.resources.includes(FAN_ID)) {
    failures.push(`removed fan resource ${FAN_ID} reappeared on binding`)
  }
  if (state.groups.length !== 2) {
    failures.push(`group split count is ${state.groups.length}, expected 2`)
  }

  if (failures.length > 0) {
    throw new Error(`HA pill persistence check failed: ${failures.join('; ')}`)
  }
}

async function waitForPersistedState(client, sessionId, baseUrl, timeoutMs) {
  let lastState = null
  let lastError = null
  return waitFor(
    async () => {
      try {
        const state = await readPersistedState(client, sessionId, baseUrl)
        lastState = state
        assertPersistedState(state)
        return state
      } catch (error) {
        lastError = error
        return null
      }
    },
    {
      intervalMs: 500,
      message: `Timed out waiting for persisted HA pill state to settle${
        lastState ? `; last state: ${JSON.stringify(lastState)}` : ''
      }${lastError instanceof Error ? `; last error: ${lastError.message}` : ''}`,
      timeoutMs,
    },
  )
}

async function navigateAndWaitForLoad(client, sessionId, url, timeoutMs) {
  const load = client
    .waitForEvent('Page.loadEventFired', sessionId, Math.min(timeoutMs, 5_000))
    .catch(() => null)
  await client.send('Page.navigate', { url }, sessionId)
  await load
}

async function getDocumentRoot(client, sessionId) {
  const { root } = await client.send(
    'DOM.getDocument',
    {
      depth: -1,
      pierce: true,
    },
    sessionId,
  )
  return root.nodeId
}

async function getElementCenter(client, sessionId, selector, timeoutMs = 10_000) {
  return waitFor(
    async () => {
      const rect = await evaluateJson(
        client,
        sessionId,
        `
          const element = document.querySelector(${JSON.stringify(selector)});
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return {
            bottom: rect.bottom,
            display: style.display,
            height: rect.height,
            left: rect.left,
            opacity: style.opacity,
            pointerEvents: style.pointerEvents,
            right: rect.right,
            top: rect.top,
            visibility: style.visibility,
            width: rect.width,
          };
        `,
      )
      if (!rect) {
        return null
      }
      if (
        rect.display === 'none' ||
        rect.visibility === 'hidden' ||
        rect.pointerEvents === 'none' ||
        Number(rect.opacity) <= 0.01
      ) {
        return null
      }

      const { bottom, left, right, top } = rect
      if (right - left < 8 || bottom - top < 8) {
        return null
      }

      return {
        bottom,
        left,
        right,
        top,
        x: (left + right) / 2,
        y: (top + bottom) / 2,
      }
    },
    {
      intervalMs: 250,
      message: `Timed out waiting for ${selector}`,
      timeoutMs,
    },
  )
}

async function evaluateJson(client, sessionId, expression) {
  const result = await client.send(
    'Runtime.evaluate',
    {
      expression: `JSON.stringify((() => { ${expression} })())`,
      returnByValue: true,
    },
    sessionId,
  )
  const raw = result.result?.value
  return raw ? JSON.parse(raw) : null
}

async function traceRenderedRoomControls(client, sessionId, label) {
  if (!traceEnabled) {
    return
  }

  const snapshot = await evaluateJson(
    client,
    sessionId,
    `
      return {
        bodyText: document.body?.innerText?.slice(0, 600) ?? '',
        controls: Array.from(document.querySelectorAll('[data-room-control-collection-id]')).map((element) => ({
          ariaExpanded: element.querySelector('[aria-expanded]')?.getAttribute('aria-expanded') ?? null,
          collectionId: element.getAttribute('data-room-control-collection-id'),
          text: element.textContent?.trim().slice(0, 200) ?? '',
          groups: Array.from(element.querySelectorAll('[data-room-control-group-id]')).map((group) => ({
            groupId: group.getAttribute('data-room-control-group-id'),
            text: group.textContent?.trim().slice(0, 120) ?? '',
            members: Array.from(group.querySelectorAll('[data-room-control-group-member-id]')).map((member) =>
              member.getAttribute('data-room-control-group-member-id'),
            ),
          })),
        })),
        storedSceneHasMaster: (() => {
          try {
            const raw = localStorage.getItem('${STORAGE_KEY}');
            const scene = raw ? JSON.parse(raw) : null;
            return Boolean(scene?.nodes?.['${MASTER_BINDING_ID}']);
          } catch {
            return false;
          }
        })(),
        storedMaster: (() => {
          try {
            const raw = localStorage.getItem('${STORAGE_KEY}');
            const scene = raw ? JSON.parse(raw) : null;
            const binding = scene?.nodes?.['${MASTER_BINDING_ID}'];
            return binding
              ? {
                  collectionId: binding.collectionId ?? null,
                  resources: binding.resources?.map((resource) => resource.id) ?? [],
                  roomControls: binding.presentation?.rtsRoomControls ?? null,
                  type: binding.type ?? null,
                }
              : null;
          } catch {
            return null;
          }
        })(),
        storedSceneHasMasterCollection: (() => {
          try {
            const raw = localStorage.getItem('${STORAGE_KEY}');
            const scene = raw ? JSON.parse(raw) : null;
            return Boolean(scene?.collections?.['${MASTER_COLLECTION_ID}']);
          } catch {
            return false;
          }
        })(),
        storedMasterCollection: (() => {
          try {
            const raw = localStorage.getItem('${STORAGE_KEY}');
            const scene = raw ? JSON.parse(raw) : null;
            const collection = scene?.collections?.['${MASTER_COLLECTION_ID}'];
            return collection
              ? {
                  controlNodeId: collection.controlNodeId ?? null,
                  nodeIds: collection.nodeIds ?? [],
                }
              : null;
          } catch {
            return null;
          }
        })(),
        masterCollectionBindings: (() => {
          try {
            const raw = localStorage.getItem('${STORAGE_KEY}');
            const scene = raw ? JSON.parse(raw) : null;
            return Object.entries(scene?.nodes ?? {})
              .filter(([, node]) => node?.type === 'home-assistant-binding' && node.collectionId === '${MASTER_COLLECTION_ID}')
              .map(([id, node]) => ({
                collectionId: node.collectionId ?? null,
                id,
                resources: node.resources?.map((resource) => resource.id) ?? [],
                roomControls: node.presentation?.rtsRoomControls ?? null,
                type: node.type ?? null,
              }));
          } catch {
            return [];
          }
        })(),
        hookDebug: window.__haPillHookDebug ?? [],
      }
    `,
  )
  trace(`${label}: ${JSON.stringify(snapshot)}`)
}

async function installRenderedDebugHooks(client, sessionId) {
  if (!traceEnabled) {
    return
  }

  await client.send(
    'Runtime.evaluate',
    {
      expression: `
        (() => {
          if (window.__haPillHookDebugInstalled) return;
          window.__haPillHookDebugInstalled = true;
          window.__haPillHookDebug = [];
          const push = (event) => {
            window.__haPillHookDebug.push({ at: Date.now(), ...event });
            if (window.__haPillHookDebug.length > 50) window.__haPillHookDebug.shift();
          };
          const summarizeScene = (scene) => {
            const binding = scene?.nodes?.['${MASTER_BINDING_ID}'];
            return binding
              ? {
                  resources: binding.resources?.map((resource) => resource.id) ?? [],
                  roomControls: binding.presentation?.rtsRoomControls ?? null,
                }
              : null;
          };
          window.addEventListener('pascal:scene-immediate-save', (event) =>
            push({ detailSummary: summarizeScene(event.detail), type: 'immediate-save-event' })
          );
          const originalSetItem = Storage.prototype.setItem;
          Storage.prototype.setItem = function(key, value) {
            if (key === '${STORAGE_KEY}') {
              let summary = null;
              try {
                const scene = JSON.parse(value);
                summary = summarizeScene(scene);
              } catch {}
              push({ key, summary, type: 'localStorage.setItem' });
            }
            return originalSetItem.apply(this, arguments);
          };
        })()
      `,
    },
    sessionId,
  )
}

async function dispatchMouse(client, sessionId, type, point, extra = {}) {
  await client.send(
    'Input.dispatchMouseEvent',
    {
      button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: 1,
      type,
      x: point.x,
      y: point.y,
      ...extra,
    },
    sessionId,
  )
}

async function clickPoint(client, sessionId, point, clickCount = 1) {
  await dispatchMouse(client, sessionId, 'mousePressed', point, { clickCount })
  await dispatchMouse(client, sessionId, 'mouseReleased', point, { clickCount })
}

async function doubleClickPoint(client, sessionId, point) {
  await clickPoint(client, sessionId, point, 1)
  await new Promise((resolve) => setTimeout(resolve, 80))
  await clickPoint(client, sessionId, point, 2)
}

async function longPressPoint(client, sessionId, point, holdMs = 1_500) {
  await dispatchMouse(client, sessionId, 'mousePressed', point)
  await new Promise((resolve) => setTimeout(resolve, holdMs))
  await dispatchMouse(client, sessionId, 'mouseReleased', point)
}

async function dragPoint(client, sessionId, from, to) {
  await dispatchMouse(client, sessionId, 'mousePressed', from)
  const steps = 10
  for (let index = 1; index <= steps; index += 1) {
    await dispatchMouse(client, sessionId, 'mouseMoved', {
      x: from.x + ((to.x - from.x) * index) / steps,
      y: from.y + ((to.y - from.y) * index) / steps,
    })
    await new Promise((resolve) => setTimeout(resolve, 35))
  }
  await dispatchMouse(client, sessionId, 'mouseReleased', to)
}

async function performRenderedPillMutation(client, sessionId, seed, timeoutMs) {
  await client.send('DOM.enable', {}, sessionId)
  await client.send('Input.setIgnoreInputEvents', { ignore: false }, sessionId).catch(() => null)

  const masterSelector = `[data-room-control-collection-id="${seed.collectionId}"]`
  const tvSelector = `[data-room-control-collection-id="${seed.tvCollectionId}"]`
  const masterClosedButtonSelector = `${masterSelector} button[aria-expanded="false"]`
  await traceRenderedRoomControls(client, sessionId, 'before rendered mutation')
  const masterPanel = await getElementCenter(client, sessionId, masterClosedButtonSelector, timeoutMs)
  trace(`master click target: ${JSON.stringify(masterPanel)}`)
  const clickTarget = await evaluateJson(
    client,
    sessionId,
    `
      const element = document.elementFromPoint(${JSON.stringify(masterPanel.x)}, ${JSON.stringify(masterPanel.y)});
      return {
        tagName: element?.tagName ?? null,
        ariaExpanded: element?.closest?.('[aria-expanded]')?.getAttribute('aria-expanded') ?? null,
        collectionId: element?.closest?.('[data-room-control-collection-id]')?.getAttribute('data-room-control-collection-id') ?? null,
        text: element?.textContent?.trim().slice(0, 120) ?? null,
      }
    `,
  )
  trace(`master elementFromPoint: ${JSON.stringify(clickTarget)}`)

  await doubleClickPoint(client, sessionId, masterPanel)
  await new Promise((resolve) => setTimeout(resolve, 300))
  await traceRenderedRoomControls(client, sessionId, 'after opening master')

  const mergedGroup = await getElementCenter(
    client,
    sessionId,
    `${masterSelector} [data-room-control-group-id*="${FAN_ID}"]`,
    timeoutMs,
  )
  await longPressPoint(client, sessionId, mergedGroup)
  await new Promise((resolve) => setTimeout(resolve, 300))
  await traceRenderedRoomControls(client, sessionId, 'after entering master edit')

  const fanMemberSelector = `${masterSelector} [data-room-control-group-member-id*="${FAN_ID}"]`
  let fanMember = null
  for (let attempt = 0; attempt < 3 && !fanMember; attempt += 1) {
    const editableMergedGroup = await getElementCenter(
      client,
      sessionId,
      `${masterSelector} [data-room-control-group-id*="${FAN_ID}"]`,
      timeoutMs,
    )
    await longPressPoint(client, sessionId, editableMergedGroup)
    await new Promise((resolve) => setTimeout(resolve, 600))
    fanMember = await getElementCenter(client, sessionId, fanMemberSelector, 5_000).catch(() => null)
  }
  if (!fanMember) {
    fanMember = await getElementCenter(client, sessionId, fanMemberSelector, timeoutMs)
  }
  await traceRenderedRoomControls(client, sessionId, 'after expanding master group')
  await dragPoint(client, sessionId, fanMember, {
    x: masterPanel.right + 120,
    y: masterPanel.bottom + 120,
  })
  await new Promise((resolve) => setTimeout(resolve, 800))
  await traceRenderedRoomControls(client, sessionId, 'after dragging fan out')

  const tvPanel = await getElementCenter(client, sessionId, tvSelector, timeoutMs)
  const masterDropTarget = await getElementCenter(client, sessionId, masterSelector, timeoutMs)
  await dragPoint(client, sessionId, tvPanel, masterDropTarget)
  await new Promise((resolve) => setTimeout(resolve, 1_200))
  await traceRenderedRoomControls(client, sessionId, 'after dragging tv in')
}

async function verifyRenderedPillAfterReload(client, sessionId, seed, timeoutMs) {
  const masterSelector = `[data-room-control-collection-id="${seed.collectionId}"]`
  const masterClosedButtonSelector = `${masterSelector} button[aria-expanded="false"]`
  const masterPanel = await getElementCenter(client, sessionId, masterClosedButtonSelector, timeoutMs)
  const clickTarget = await evaluateJson(
    client,
    sessionId,
    `
      const element = document.elementFromPoint(${JSON.stringify(masterPanel.x)}, ${JSON.stringify(masterPanel.y)});
      return {
        ariaExpanded: element?.closest?.('[aria-expanded]')?.getAttribute('aria-expanded') ?? null,
        collectionId: element?.closest?.('[data-room-control-collection-id]')?.getAttribute('data-room-control-collection-id') ?? null,
      }
    `,
  )
  if (clickTarget?.collectionId !== seed.collectionId) {
    throw new Error(
      `Post-reload visual check targeted ${clickTarget?.collectionId ?? 'nothing'}, expected ${seed.collectionId}.`,
    )
  }

  await doubleClickPoint(client, sessionId, masterPanel)
  const lightGroupSelector = `${masterSelector} [data-room-control-group-id*="${LIGHT_IDS[0]}"][data-room-control-group-id*="${LIGHT_IDS[3]}"]`
  const tvGroupSelector = `${masterSelector} [data-room-control-group-id*="${TV_ID}"]`
  await getElementCenter(client, sessionId, lightGroupSelector, timeoutMs)
  await getElementCenter(client, sessionId, tvGroupSelector, timeoutMs)

  const renderedState = await evaluateJson(
    client,
    sessionId,
    `
      const master = document.querySelector(${JSON.stringify(masterSelector)});
      const expanded = master?.querySelector('[aria-expanded]')?.getAttribute('aria-expanded') ?? null;
      const groups = Array.from(master?.querySelectorAll('[data-room-control-group-id]') ?? []).map((group) => ({
        groupId: group.getAttribute('data-room-control-group-id'),
        text: group.textContent?.trim() ?? '',
        visible: Boolean(group.offsetWidth || group.offsetHeight || group.getClientRects().length),
      }));
      return { expanded, groups };
    `,
  )

  const visibleGroups = renderedState.groups.filter((group) => group.visible)
  const visibleGroupIds = visibleGroups.map((group) => group.groupId ?? '')
  const joinedGroupIds = visibleGroupIds.join('\n')
  const missingLights = LIGHT_IDS.filter((id) => !joinedGroupIds.includes(id))
  const failures = []
  if (renderedState.expanded !== 'true') {
    failures.push(`Master aria-expanded is ${renderedState.expanded}, expected true`)
  }
  if (visibleGroups.length !== 2) {
    failures.push(`visible group count is ${visibleGroups.length}, expected 2`)
  }
  if (missingLights.length > 0) {
    failures.push(`missing visible light members: ${missingLights.join(', ')}`)
  }
  if (!joinedGroupIds.includes(TV_ID)) {
    failures.push(`missing visible TV member ${TV_ID}`)
  }
  if (joinedGroupIds.includes(FAN_ID)) {
    failures.push(`fan member ${FAN_ID} is still visible after reload`)
  }
  if (failures.length > 0) {
    throw new Error(`Post-reload rendered pill state failed: ${failures.join('; ')}`)
  }

  trace(`post-reload rendered state: ${JSON.stringify(renderedState)}`)
  return renderedState
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = String(args.url ?? process.env.PASCAL_EDITOR_URL ?? 'http://localhost:3002').replace(
    /\/$/,
    '',
  )
  const timeoutMs = Number(args.timeout ?? process.env.PASCAL_HA_PILL_CHECK_TIMEOUT_MS ?? 60_000)
  const browserPath = findBrowser()

  trace('checking app health')
  await fetchJson(`${baseUrl}/api/health`, 5_000)
  trace('building seed scene')
  const seed = await buildSeedScene(baseUrl)

  const debugPort = await getFreePort()
  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'ha-pill-render-check-'))
  const browser = spawn(
    browserPath,
    [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profileDir}`,
      '--headless=new',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-gpu',
      '--disable-popup-blocking',
      '--disable-sync',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1440,1000',
      'about:blank',
    ],
    {
      stdio: 'ignore',
      windowsHide: true,
    },
  )

  let client
  try {
    trace('waiting for browser debugging endpoint')
    const version = await waitFor(() => fetchJson(`http://127.0.0.1:${debugPort}/json/version`, 2_000), {
      message: 'Timed out waiting for browser debugging endpoint',
      timeoutMs: Math.min(timeoutMs, 15_000),
    })

    trace('connecting CDP')
    client = new CdpClient(version.webSocketDebuggerUrl)
    await client.open()
    const { targetId: storageTargetId } = await client.send('Target.createTarget', {
      url: 'about:blank',
    })
    const { sessionId: storageSessionId } = await client.send('Target.attachToTarget', {
      flatten: true,
      targetId: storageTargetId,
    })
    await client.send('Page.enable', {}, storageSessionId)
    await client.send('DOMStorage.enable', {}, storageSessionId)
    trace('opening storage origin')
    await navigateAndWaitForLoad(client, storageSessionId, `${baseUrl}/api/health`, timeoutMs)
    trace('seeding localStorage')
    const seedResult = await writeSeedScene(client, storageSessionId, baseUrl, seed)

    const { targetId: appTargetId } = await client.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId: appSessionId } = await client.send('Target.attachToTarget', {
      flatten: true,
      targetId: appTargetId,
    })
    await client.send('Page.enable', {}, appSessionId)
    await client.send('Runtime.enable', {}, appSessionId)

    trace('opening rendered editor')
    await navigateAndWaitForLoad(client, appSessionId, baseUrl, timeoutMs)
    await installRenderedDebugHooks(client, appSessionId)
    await new Promise((resolve) => setTimeout(resolve, 2_500))
    trace('mutating pill through rendered UI')
    await performRenderedPillMutation(client, appSessionId, seed, Math.min(timeoutMs, 20_000))

    const reloadLoad = client
      .waitForEvent('Page.loadEventFired', appSessionId, Math.min(timeoutMs, 5_000))
      .catch(() => null)
    await client.send('Page.reload', { ignoreCache: true }, appSessionId)
    await reloadLoad
    await new Promise((resolve) => setTimeout(resolve, 2_500))
    await traceRenderedRoomControls(client, appSessionId, 'after reload')
    const renderedAfterReload = await verifyRenderedPillAfterReload(
      client,
      appSessionId,
      seed,
      Math.min(timeoutMs, 20_000),
    )
    trace('checking persisted state after reload')
    const state = await waitForPersistedState(
      client,
      storageSessionId,
      baseUrl,
      Math.min(timeoutMs, 20_000),
    )
    if (client.exceptions.length > 0) {
      throw new Error(`Browser runtime exceptions were reported: ${client.exceptions.join('; ')}`)
    }

    console.log(
      JSON.stringify({
        baseUrl,
        ok: true,
        persisted: state,
        renderedAfterReload,
        seeded: seedResult,
      }),
    )
  } finally {
    try {
      await Promise.race([
        client?.send('Browser.close'),
        new Promise((resolve) => setTimeout(resolve, 1_000)),
      ])
    } catch {}
    client?.close()

    if (!browser.killed) {
      browser.kill()
    }

    await rm(profileDir, { force: true, recursive: true }).catch(() => {})
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
