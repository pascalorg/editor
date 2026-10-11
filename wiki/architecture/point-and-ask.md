# Point and ask

The mode in which a person points at something in the 3D view and asks the agent about it: "make this window wider", "what is wrong here?". The finger names the element, the words say what, and the answer lands where they pointed, under a pin that keeps its promise. It lives in `packages/editor` (`src/components/point-ask`, `src/lib/point-ask`, `src/store/use-point-ask.ts`) with a small boundary in `packages/core` (`point-context.ts`, `lib/point-ask.ts`) and one slot in the viewer (`pointedIds`).

## The boundary: no chat in the editor

The open-source editor has no chat. Point and ask is offered only while a host has called `registerPointAskHandler(handler)` (core): the toolbar button and the C key do not exist otherwise (`useHasPointAskHandler`). The handler takes a `PointAskSubmit` (`askId`, the person's `text`, a `PointContext`, and `from`, the bubble text's screen rect) and answers `{ ok: true }` or `{ ok: false, code, message }`; a missing or throwing handler comes back as a reason, never a dropped ask. Everything after the hand-off comes back on the typed bus:

| Event | From | Meaning |
|---|---|---|
| `point-ask:status` | host to pin | `queued`, `working` (+ the live `sentence`), `asking` (+ `question`), `ended` (`outcome`, `asked`, `wroteScene`, `answer?`, `error?`) |
| `point-ask:pin` | pin to host | `hover` / `leave` / `open`: the host lights or scrolls to the ask's turn |

The host also sets `setPointAskBusy` (the bubble's button says Queue) and `setPointAskPlayful` ("Playful touches": the ripple, the flashes, the shutter sound).

## `PointContext`

One shape for every surface (core `agent-operations/point-context.ts`, types only): `kind: 'scene-point'`, `askId`, `capturedAt` (the press, not the send), `gesture` (`click` | `multi` | `region`), the `level`, every pointed `target` (id, type, name, `levelId`, `zoneId?`, `parentId?`, the `hit` point/normal/face, a world `box`, a `size` in metres), a region's `inRegion { ids, more }` and `region` (0-1 fractions), the `camera` (position, target, fov, aspect, projection), and the crop in `image`. Ids are authoritative; the picture is evidence; sizes come from `size`, "a picture is not a measure". `buildPointContext` (`lib/point-ask/build-context.ts`) builds it from the scene.

## The mode

- **Enter.** The C key (a tap latches, a hold points while held; the mode starts on key-down and key-up decides, under 200 ms latches) or the toolbar button beside Select. C belongs to a tool while one is armed or a gesture is under way. The button is disabled in the 2D plan and the walkthrough.
- **The scope.** The mode holds the `pointing` interaction scope for its whole life: selection (`selectionEnabled` is false), handles and the floating menu step back. An armed tool is put aside and returns when the mode leaves. Another interaction taking the scope, a view change or the walkthrough ends the mode.
- **Esc** unwinds one layer at a time: the pin card, the bubble, the mode.

## Hover and pick

`resolvePointPick` (`lib/point-ask/pick.ts`, pure) uses the editor's own predicate, so the hover shows what the click sends: a wall, floor or ceiling picks its room first (the room already in the bubble lets its surfaces pick); openings, items, stairs and columns pick directly; a roof picks its segment; **Alt** goes one level deeper at once; an **exterior** face picks the wall, because from outside "this" means the facade. The mode reads the viewer's node events (only the innermost kind's event, then `stopPropagation`: a pointer move is also emitted for the level, the building and the site). The hover outline is the viewer's `point` hover style (`hoverHighlightMode: 'point'`); a chat chip hover uses `useViewer.setPointedIds`, a separate slot so a collaborator's highlight is never overwritten.

## Press, click, region

Pointer-down is taken at the window's capture phase on the canvas (so box-select and the node events never see it) and starts the crop capture; pointer-up within 6 px opens the bubble (a press that lands before any hover was read raycasts the scene at its own position and goes through the same pick, which is also how a touch names what it taps); beyond 6 px it is a **region**: a rectangle with its live size in metres, a shutter flash on release, the elements inside ranked by screen area, and a bubble on its edge. A region is a view, not a selection: it has no targets. While the rectangle is dragged, the elements it would take (the top 12 by screen area, throttled, their boxes taken once at the start) are outlined in the point style.

## The bubble

320 px glass, anchored to the click point, beside the target and never over it (`placeBubble`: right, left, below, above; a big target is avoided by a 48 px disc around the click; the side is kept until it has been invalid for 150 ms, then it glides; off screen it docks at the edge). It follows the camera 1:1 each frame. Context chips (hover outlines the element, × removes it), the crop thumbnail ("No picture" when the capture failed), a growing field, Dictate where the browser has speech recognition, three suggestions chosen locally by kind (`suggestionsFor`), no model call. Enter sends; the bubble folds into the pin on the same frame; if the host refuses, the bubble returns with the words and the reason.

## The pin

A 24 px glass disc planted at the click, stored in the first target's own frame so it rides along when the element moves. `reducePin` (pure) turns the host's statuses and the scene's commits (`subscribeSceneCommits`, `changedNodeIds` intersected with the targets and their subtrees) into `sent`, `queued`, `working`, `needs-input`, `done`, `answered`, `no-change`, `error` or `undone`. The card (hover or focus, and once by itself for 4 s) offers **Keep**, **Undo** (steps back through the history steps the turn wrote; "You've changed the scene since" before undoing past hand edits), **Redo** while nothing else was done, **Hold to compare** (the crop from the press against one taken when the turn ended), and the reason in words on an error. A settled pin retires 8 s after it was last in the person's way. A pin whose element is out of view (or behind the camera) gives way to an **edge marker** on the viewport's edge that points at it and says what is happening there ("2 changes over here"); a click flies the camera to what the ask is about (`sceneViewPose`).

## Motion

Every value is in `lib/point-ask/choreography.ts`, from the chat direction's tokens: the default spring (damping 1.0, response 0.35 s), the outline corners travelling on a 0.16 s spring, the bubble growing from the click (scale 0.92 to 1, opacity and blur together), closing in 150 ms, the pin dropping 8 px with a squash and one ring ripple, the check stroke in 240 ms. Reduced motion turns each move into a cross-fade; "Playful touches" off removes the flash, the ripple and the sounds, never the information.

## Testing

The pure modules (`spring`, `placement`, `pick`, `pin-machine`, `suggestions`, `describe-target`, `build-context`, `region`) are unit tested. In development `window.__pascalPointAskTest` (`register`, `status`, `scene`, `store`, `emitter`) lets a spec play a fake chat with no model: `e2e/community/point-and-ask.spec.ts` in the private repo.
