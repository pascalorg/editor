#!/usr/bin/env node

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const args = new Map()
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index]
  const value = process.argv[index + 1]
  if (key?.startsWith('--')) {
    args.set(key.slice(2), value)
    index += 1
  }
}

const fixturePath = args.get('fixture') ?? process.env.PASCAL_SMART_HOME_RENDER_FIXTURE
const appUrl = args.get('url') ?? process.env.PASCAL_SMART_HOME_RENDER_URL ?? 'http://localhost:3002/'
const screenshotPath =
  args.get('screenshot') ?? path.resolve(process.cwd(), 'tmp-smart-home-rendered-gui.png')

if (!fixturePath) {
  throw new Error(
    'Missing fixture. Pass --fixture <scene-or-lovelace-json> or PASCAL_SMART_HOME_RENDER_FIXTURE.',
  )
}

function resolveChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean)

  const resolved = candidates.find((candidate) => fs.existsSync(candidate))
  if (!resolved) {
    throw new Error('Chrome or Edge was not found. Set CHROME_PATH to run rendered GUI tests.')
  }
  return resolved
}

function loadSceneGraph(inputPath) {
  const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
  const graph = payload?.scene?.scene ?? payload?.scene ?? payload
  if (!graph?.nodes || !graph?.rootNodeIds) {
    throw new Error(`Fixture does not contain a Pascal scene graph: ${inputPath}`)
  }
  return graph
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function retry(fn, timeoutMs = 10_000) {
  const start = Date.now()
  let lastError
  while (Date.now() - start < timeoutMs) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      await wait(200)
    }
  }
  throw lastError
}

async function getJson(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`${response.status} ${url}`)
  }
  return response.json()
}

async function connectChrome(port) {
  await retry(() => getJson(`http://127.0.0.1:${port}/json/version`))
  const targets = await getJson(`http://127.0.0.1:${port}/json`)
  const target = targets.find((entry) => entry.type === 'page') ?? targets[0]
  if (!target?.webSocketDebuggerUrl) {
    throw new Error('Chrome did not expose a page websocket target.')
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })

  let id = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (!message.id || !pending.has(message.id)) {
      return
    }
    const callbacks = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) {
      callbacks.reject(new Error(JSON.stringify(message.error)))
      return
    }
    callbacks.resolve(message.result)
  }

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      id += 1
      pending.set(id, { reject, resolve })
      ws.send(JSON.stringify({ id, method, params }))
    })

  return { send, ws }
}

async function main() {
  const sceneGraph = loadSceneGraph(fixturePath)
  const chromePath = resolveChromePath()
  const port = 9400 + Math.floor(Math.random() * 400)
  const profile = path.join(os.tmpdir(), `pascal-smart-home-render-${Date.now()}`)
  const chrome = spawn(
    chromePath,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--disable-default-apps',
      '--window-size=1280,900',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  try {
    const { send, ws } = await connectChrome(port)
    const evaluate = async (expression) =>
      (
        await send('Runtime.evaluate', {
          awaitPromise: true,
          expression,
          returnByValue: true,
        })
      ).result.value
    const click = async ({ x, y }) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await send('Input.dispatchMouseEvent', {
        button: 'left',
        clickCount: 1,
        type: 'mousePressed',
        x,
        y,
      })
      await send('Input.dispatchMouseEvent', {
        button: 'left',
        clickCount: 1,
        type: 'mouseReleased',
        x,
        y,
      })
    }
    const drag = async (from, to) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y })
      await send('Input.dispatchMouseEvent', {
        button: 'left',
        clickCount: 1,
        type: 'mousePressed',
        x: from.x,
        y: from.y,
      })
      await wait(250)
      const steps = 18
      for (let index = 1; index <= steps; index += 1) {
        const ratio = index / steps
        await send('Input.dispatchMouseEvent', {
          button: 'left',
          buttons: 1,
          type: 'mouseMoved',
          x: from.x + (to.x - from.x) * ratio,
          y: from.y + (to.y - from.y) * ratio,
        })
        await wait(30)
      }
      await send('Input.dispatchMouseEvent', {
        button: 'left',
        clickCount: 1,
        type: 'mouseReleased',
        x: to.x,
        y: to.y,
      })
    }
    const centerOf = async (expression, label) => {
      const point = await evaluate(`(() => {
        const element = ${expression};
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`)
      if (!point) {
        throw new Error(`Could not find ${label}.`)
      }
      return point
    }

    await send('Runtime.enable')
    await send('Page.enable')
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `localStorage.setItem('pascal-editor-scene', ${JSON.stringify(
        JSON.stringify(sceneGraph),
      )});`,
    })
    await send('Page.navigate', { url: appUrl })
    await wait(9_000)

    await click(
      await centerOf(
        `[...document.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === 'Open smart home panel')`,
        'Open smart home panel button',
      ),
    )
    await wait(700)
    const panelState = await retry(async () => {
      const state = await evaluate(`(() => {
        const buttons = [...document.querySelectorAll('button')];
        const hasGroupsSection = buttons.some((button) => (button.innerText || '').trim() === 'Groups');
        const hasProviderRow = buttons.some((button) => (button.innerText || '').trim() === 'Home Assistant');
        const hasLinkedProvider = buttons.some((button) =>
          button.getAttribute('aria-label') === 'Log out of Home Assistant'
        );
        return { hasGroupsSection, hasLinkedProvider, hasProviderRow };
      })()`)
      if (!state.hasGroupsSection && !(state.hasProviderRow && state.hasLinkedProvider)) {
        throw new Error('Home Assistant provider is not linked in the smart-home panel yet.')
      }
      return state
    }, 15_000)
    if (panelState.hasProviderRow && panelState.hasLinkedProvider && !panelState.hasGroupsSection) {
      await click(
        await centerOf(
          `[...document.querySelectorAll('button')].find((button) => (button.innerText || '').trim() === 'Home Assistant')`,
          'Home Assistant provider row',
        ),
      )
      await retry(async () => {
        const hasGroupsSection = await evaluate(`(() =>
          [...document.querySelectorAll('button')].some((button) =>
            (button.innerText || '').trim() === 'Groups'
          )
        )()`)
        if (!hasGroupsSection) {
          throw new Error('Home Assistant Groups section is not available yet.')
        }
        return true
      }, 15_000)
    }
    const groupsAlreadyOpen = await evaluate(`(() =>
      [...document.querySelectorAll('button')].some((button) =>
        /^Show actions for /.test(button.getAttribute('aria-label') || '')
      )
    )()`)
    if (!groupsAlreadyOpen) {
      await click(
        await centerOf(
          `[...document.querySelectorAll('button')].find((button) => (button.innerText || '').trim() === 'Groups')`,
          'Groups section',
        ),
      )
      await wait(600)
    }

    const result = await evaluate(`(() => {
      const buttons = [...document.querySelectorAll('button')].map((button) => ({
        aria: button.getAttribute('aria-label'),
        disabled: button.disabled,
        text: (button.innerText || button.getAttribute('aria-label') || '').trim(),
      }));
      const renderedToggles = buttons
        .map((button) => button.aria || button.text)
        .filter((label) => /^Toggle /.test(label));
      const renderedDisabledGroupLabels = buttons
        .filter((button) => / is not linked to a controllable device$/.test(button.aria || ''))
        .map((button) => (button.aria || '').replace(/ is not linked to a controllable device$/, ''));
      const panelActionGroupLabels = buttons
        .map((button) => button.aria || '')
        .filter((label) => /^Show actions for /.test(label))
        .map((label) => label.replace(/^Show actions for /, ''));
      const noDirectActionLabels = buttons
        .map((button) => button.aria || '')
        .filter((label) => / has no direct action$/.test(label));
      const groupsText = document.body.innerText;
      return {
        noDirectActionLabels,
        panelActionGroupLabels,
        renderedDisabledGroupLabels,
        renderedToggles,
        hasDiningGroup: /\\bDining\\b/.test(groupsText),
        hasKitchenGroup: /\\bKitchen\\b/.test(groupsText),
        hasMasterGroup: /\\bMaster\\b/.test(groupsText),
        mbrMemberOverlayCount: renderedToggles.filter((label) => /^Toggle MbrL/.test(label)).length,
      };
    })()`)

    const failures = []
    if (!result.hasDiningGroup) failures.push('Dining group is missing from the rendered panel.')
    if (!result.hasKitchenGroup) failures.push('Kitchen group is missing from the rendered panel.')
    if (!result.hasMasterGroup) failures.push('Master group is missing from the rendered panel.')
    if (result.mbrMemberOverlayCount > 0) {
      failures.push('Group member resources rendered as duplicate MbrL overlay buttons.')
    }
    if (result.noDirectActionLabels.length > 0) {
      failures.push(
        `Device buttons rendered as disabled no-direct-action controls: ${result.noDirectActionLabels.join(', ')}`,
      )
    }
    for (const label of result.renderedDisabledGroupLabels) {
      if (!result.panelActionGroupLabels.includes(label)) {
        failures.push(`Rendered disabled group "${label}" is missing from the Groups panel.`)
      }
    }

    if (failures.length > 0) {
      throw new Error(failures.join('\n'))
    }

    let disabledGroupDropChecked = false
    const disabledPascalGroupTarget = await evaluate(`(() => Boolean(
      [...document.querySelectorAll('button')].find((button) =>
        button.getAttribute('aria-label') === 'Pascal group is not linked to a controllable device'
      )
    ))()`)
    if (disabledPascalGroupTarget) {
      const sourcePoint = await centerOf(
        `[...document.querySelectorAll('button')].find((button) =>
          button.getAttribute('aria-label') === 'Toggle Ceiling Lamp' ||
          button.getAttribute('aria-label') === 'Open Ceiling Lamp controls' ||
          button.getAttribute('aria-label') === 'Toggle Recessed Light' ||
          button.getAttribute('aria-label') === 'Open Recessed Light controls'
        )`,
        'enabled source device button',
      )
      const targetPoint = await centerOf(
        `[...document.querySelectorAll('button')].find((button) =>
          button.getAttribute('aria-label') === 'Pascal group is not linked to a controllable device'
        )`,
        'disabled Pascal group pill',
      )
      await drag(sourcePoint, targetPoint)
      await wait(1_500)
      const postDrop = await evaluate(`(() => {
        const buttons = [...document.querySelectorAll('button')].map((button) => ({
          aria: button.getAttribute('aria-label'),
          disabled: button.disabled,
          text: (button.innerText || button.getAttribute('aria-label') || '').trim(),
        }));
        const bodyText = document.body.innerText || '';
        const expandedPascalGroup = buttons.some((button) =>
          button.aria === 'Close Pascal group controls'
        );
        const copiedDeviceVisible = buttons.some((button) =>
          /^(Move|Toggle|Open) (Ceiling Lamp|Recessed Light|DinL|MbrL)/.test(button.aria || '')
        );
        return {
          stillDisabled: buttons.some((button) =>
            button.aria === 'Pascal group is not linked to a controllable device'
          ),
          enabledPascal: buttons.some((button) =>
            button.aria === 'Toggle Pascal group' ||
            button.aria === 'Open Pascal group controls'
          ) || (expandedPascalGroup && copiedDeviceVisible && bodyText.includes('Pascal group')),
        };
      })()`)

      if (postDrop.stillDisabled || !postDrop.enabledPascal) {
        const failureScreenshot = await send('Page.captureScreenshot', { format: 'png' })
        fs.writeFileSync(screenshotPath, Buffer.from(failureScreenshot.data, 'base64'))
        throw new Error('Dragging an enabled device onto the disabled Pascal group did not enable it.')
      }
      disabledGroupDropChecked = true
    }

    const screenshot = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'))

    console.log(
      JSON.stringify(
        {
          disabledGroupDropChecked,
          renderedToggleCount: result.renderedToggles.length,
          disabledGroupsChecked: result.renderedDisabledGroupLabels,
          panelGroupsChecked: result.panelActionGroupLabels,
          screenshotPath,
          status: 'passed',
        },
        null,
        2,
      ),
    )
    ws.close()
  } finally {
    chrome.kill()
  }
}

main().catch((error) => {
  console.error(error.stack || error.message)
  process.exit(1)
})
