# Construction animation

What the construction reveal (see [systems](systems.md), "Construction reveal") adds on top of staging a build phase by phase: the weight of a landing, the events a host listens to, the roof that lifts out of the way of the furniture, the build played in reverse for an undo, and Follow Pascal, the camera that follows the build. The engine is `packages/viewer/src/systems/construction-reveal`; Follow Pascal is in `packages/editor` (`src/lib/follow-pascal*.ts`, `src/components/editor/follow-pascal.tsx`, `src/store/use-follow-pascal.ts`).

## One rhythm: the reveal says what it is doing

`subscribeRevealEvents(listener)` (viewer) reports everything the reveal does, on the reveal's own clock (`atMs`, the frame clock the reveal steps on). A step card, a sound and the camera listen here, so they share one rhythm.

| Event | Fields | Meaning |
|---|---|---|
| `start` / `land` / `settle` | `phase`, `levelId`, `nodeIds`, `source`, `instant`, `atMs` | One (phase, level) group of the build: its first node begins; its first node makes contact (a drop's impact: the frame a sound belongs on); its last node is at rest |
| `node-start` | `id`, `phase`, `levelId`, `style`, `source`, `atMs` | One node begins to move |
| `finale` | `id`, `phase`, `levelId`, `source`, `atMs` | The last piece of the build has arrived; when a roof lifted for the furniture, when it seats again |
| `complete` | `nodeCount`, `durationMs`, `source`, `instant`, `atMs` | Nothing is left to reveal |
| `retract-start` / `retract-end` | `phase`, `levelId`, `nodeIds`, `source: null`, `atMs` | One group of the build played in reverse begins to go; has gone |

**Edits.** An agent commit that moves furniture already in the scene (another `position`, `rotation` or parent) says it in the same words with `changed: true` on `start`/`land`/`settle`, `node-start` (`style: 'glide'`) and `complete`: one group per (phase, level), then one `complete`. A piece standing in the same level before and after, moved more than 2 cm or 0.02 rad, glides (`setGlidePose` in `reveal-pose.ts`): it holds at its old place from the moment the commit lands, then travels to the new one on a critically damped spring (response 0.7 s, a 5 cm hop half way), starting a beat after the previous piece (80 ms, spread capped at 1.2 s). `node-start` and the group's `start` are said when it begins to move, `land` when the first piece is home, `settle` when the last is; `instant` is false. A piece that cannot glide (another parent, or a hair's move), reduced motion, the animation off, the canvas paused: shown at once and said at once (`instant: true`, start, node-start, land, settle, complete together). The root keeps its own transform (the renderer writes the new place whenever it likes); the pose reads it, so nothing flashes. A glide counts as revealing (`isNodeRevealing`), so a batch hands the piece back to its own meshes. The roof lifts for the move as it does for furniture and is let go of a beat after the last piece is home. Moves wait for the reveal to be quiet (no group open, nothing waiting or moving in), so a build's group is never closed early; selecting a piece, an undo, a load or a capture puts it home at once. A piece still waiting for its turn is not said to have moved; the person's own edits say nothing. A host that counts a `complete` as the end of a build can tell the two apart by `changed`.

`start` and `node-start` are said when a node first moves (its pose is set that frame), not when the reveal lets it in: a node waiting for its first build is not seen to move, and a card or the camera must not run ahead of it. `source` is the commit's `author` (`'agent'`). `instant` is true when the host showed the group at once (animation off, reduced motion, the read-only viewer, an export, a level nobody sees) or the reveal was cut short; start, land and settle then come together, in that order. A build shown at once has no `finale`; `complete` is always said, with `instant: true`. `complete` can fire more than once in a turn (once per quiet stretch): the host picks the one that ends its turn. `subscribeRevealPhases` (one event per group start) is unchanged.

## Weight

- **A drop accelerates** (gravity, slow off the hook, fastest at the impact) over `DROP_FALL` of its duration, then lands: a squash that follows through (a small overshoot past rest) and is still, and exactly at rest, at the end.
- **A roof piece leads**: it lifts a hair (`lead`, 5% of its height, 20 cm of 4 m) before it falls, so the eye is told where it is about to drop from.
- **The finale is heavier**: the last piece of a plan to arrive (`planReveal` marks it) lands with 1.7x the squash, hop and dust.
- **Dust** sells contact: rising walls puff along their base, landings puff around their foot, scaled by the drop's height and weight.
  It draws in the scene pass (walls in front hide it). three blends only a pass's `output`; the normal and diffuse attachments are overwritten wherever a draw covers, so a transparent sprite stamped its whole quad there and the ink drew its edges. The scene pass (`scenePassMrt`) blends those attachments by the material, and the dust material writes alpha 0 to them (`createDustMaterial`).
- Sound, one per phase and level, belongs on the `land` event, not on `start`.

## The roof lifts out of the way of the furniture

A kind may declare `capabilities.reveal.clears: { for: 'furnishing', height: 2.4 }` (the roof does). When a group of that phase starts in the same building, the node lifts `height` metres (a critically damped spring) as a ghost, so the furniture dropping in is seen. Shared materials are cached by their catalog entry, so a ghost never writes to them: each mesh wears clones (`setGhost`/`clearGhost`) while it is up, casts no shadow while faint, and gets its own materials back after.

It stays up 10 s after the last piece of the phase (a model's turn between writes takes seconds; a roof that bobs down and up between them is a distraction), and comes down earlier when the host calls `seatLiftedNow()` because its turn is over. The finale is the seat. Only the `full` and `framing` levels lift. A capture, a load or an undo seats it at once.

## The build in reverse: `retractNodes`

`retractNodes(ids): Promise<{ retracted, skipped, instant }>` plays what was built backwards, for an undo. The host calls it with the ids the undo is about to remove (descendants are added: a wall takes its openings; an assembled roof goes whole), awaits it, then removes them from the scene at once.

- **Order.** The last phase goes first (furniture, roof, openings, walls, the slab); the last piece to arrive first within a phase; quicker than the build (`RETRACT_TIMING`: 0.62 of its pace, each style's own duration) and within 2.4 s however many pieces, by pulling the starts closer, never by skipping one (`planRetract`).
- **Poses** (`retractPoseAt`). Whatever grew shrinks the way it grew, slowly at first and faster as it goes (a wall sinks into the ground, an opening closes through its wall). Whatever fell in lifts away and fades, quick off the mark. At the end it is gone: scale at its smallest, opacity 0.
- **Held gone.** The nodes stay hidden until they leave the scene (or 2 s pass, then they come back whole), so no frame shows them whole between the promise resolving and the removal. An undo's history restore ends other reveals at once but keeps retracted nodes hidden for the same reason. Pass only what the undo removes: a node that stays would sink and then come back.
- **The roof.** Furniture going from under a seated roof lifts the roof first (a lead of 450 ms), as it did for the build; a roof going with the furniture under it goes first, so the furniture is seen leaving; a roof already up carries on from where it is, with no second finish.
- **Batches.** A node going out counts as revealing (`isNodeRevealing`: waiting, moving in, going out, held gone). The wall batch and the node batch (items, doors, windows, slabs, ceilings, columns) hand such a node back to its own meshes, so the pose is what is drawn, and keep it out until the host takes it away; a level is not sewn again under the play. A merged mesh draws its members whole, whatever pose their own meshes are given.
- **Instant.** With no reveal running, the animation off or motion reduced it resolves at once with `instant: true` and nothing retracted; ids not in the scene, not mounted, on a hidden level or already going come back in `skipped`.
- **Events.** `retract-start` and `retract-end` per group; a capture, a load or the reveal stopping ends the reverse play and resolves what waits on it.

## Follow Pascal

The viewport's toolbar toggle (on by default, persisted as `pascal-follow-pascal`): while a build plays, the camera eases to what the current step is working on, at the distance its scale needs, reusing `view_scene`'s bounds (`sceneViewBounds`, `sceneViewFacing`).

- **Targets** (`follow-pascal-targets.ts`, from the reveal's events): a floor, whole, when its slabs and walls start; each opening close up, square to its wall, from outside; each piece of furniture from above, looking down through the lifted roof (the eye clears it); the roof from the group that assembles it; the whole house when the furniture has landed and at the finale (not after furniture the agent only moved: the camera stays on it). An undo's `retract-start` is followed group by group, and a piece the agent moved is framed like one it placed.
- **Moves** (`follow-pascal.ts`). Orbit space (the point looked at, a distance, an azimuth and an elevation per kind of target), so the horizon stays level; six critically damped springs (response 1.1 s) take the nearest way round; a target holds at least 1.5 s; what lands within 0.35 s of the first is framed with it as one group. The poses go out as `camera-controls:apply-pose`.
- **The person wins.** Any of `camera-controls:interaction-start | view | focus | top-view | orbit-cw | orbit-ccw | fit-scene` pauses it and shows a "Resume following" pill while a build is on; resuming flies back to what it last looked at; the next build takes the camera again. A host that moves the camera itself calls `useFollowPascal.getState().pause()` first (`apply-pose` is Follow Pascal's own move, so it is not a signal).
- **Reduced motion** cuts: the canvas dips and comes back as a cross-fade; in an orthographic view or the walkthrough it does nothing.

## The first draw of a kind, and the first mount

The first node of each kind (and, for catalog items, each model) not yet on screen mounts up front when a commit arrives: hidden (a pose at its smallest), never culled, so it draws and builds before anything moves. The plan waits until each has been built and drawn and the frames are steady again (at most 2.5 s of the clock, and not at all when only the 2D plan shows or the animation is off). The dust draws one invisible sprite; a roof that will lift for the furniture draws once as the ghost it becomes (`LIFT_WARM_OPACITY`), and a lift holds still for the ghost's first draw. An opening is left for its turn: mounting it would cut its wall early. `useRevealWaiting` (what the 2D plan reads) is true for a node mounted up front; `useRevealPending` (what mounts the 3D node) is not.

What this moves is the cost of a kind's first mount, a React and three object creation, a model's parse and a geometry build: on the same scripted build, frames over 50 ms while something moves went from 325-400 ms at worst to about 130 ms. It is not shader compilation: a CPU profile of every long frame spends 0-13 ms in three's shader and pipeline build; the rest is React's development build, zod schema construction in the agent's write, and CSG. Pre-building the shaders from a hidden template was tried and does not help (the real shaders differ from a stand-in by their texture maps and the rest of each kind's material state).

## Costs

A roof assembling from its segments merged its CSG shell once per segment that mounted (hundreds of ms each); the shell merged when the roof arrived already has them, so a segment of an assembling roof re-queues the merge only when something the shell is made of has changed (`RoofSystem`). First-use pipeline compiles (the first walls, the first ghost) stall a frame or two whether or not the build is animated.

## Tests

Pose and plan arithmetic (`reveal-pose`, `reveal-schedule`, `follow-pascal`, `follow-pascal-targets`) are pure and tested without a canvas; the driver is tested with the viewer's test renderer (`construction-reveal.test.tsx`: events, lift, retract); the roof's single merge in `packages/nodes/src/roof/assembly-reveal.test.tsx`. A build is judged on the real GPU: headless software rendering draws about five frames a second.
