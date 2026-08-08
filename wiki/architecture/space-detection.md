# Space Detection

*Commit and replication contract for wall-driven room reconciliation.*

Applies to: `packages/core/src/lib/space-detection.ts`, `packages/core/src/store/**`, and collaboration consumers of `SceneCommit`.

Space detection derives room state from wall geometry. Reconciliation updates wall side classifications, creates or updates automatic slabs and ceilings, and updates their level's `children`. Those derived writes are part of the wall edit that triggered them, not a later background operation.

## Local commit boundary

`initSpaceDetectionSync` must remain a synchronous scene-store subscriber. A local wall mutation and all reconciliation it triggers must finish before zundo emits the mutation's `SceneCommit` snapshot.

Reconciliation pauses scene history while applying derived writes. This keeps the triggering edit and its generated state in one undo step, while the outer tracked mutation still captures the final reconciled graph in `SceneCommit.current`. The emitted snapshot must therefore contain:

- the triggering wall edit;
- reconciled `frontSide` and `backSide` values;
- generated or updated automatic slabs and ceilings; and
- the corresponding level `children` updates.

Do not schedule reconciliation from `subscribeSceneCommits`. Commit listeners run after the snapshot boundary. Because reconciliation writes are history-paused, moving the work there would neither amend the emitted snapshot nor produce a second local commit, leaving collaboration consumers unable to transmit the generated state.

## Host patch consumption

The originating client is the only client that reconciles a local wall edit and mints IDs for generated room surfaces. Collaboration transports the resulting before/current difference, including the generated nodes and parent updates.

Receiving clients apply that transmitted graph as a host patch. Host application is history-paused and may run while the scene is read-only, so space detection must not regenerate the room locally. The receiver consumes the originator's slab and ceiling IDs and records no local undo entry or local commit for the host change.

This two-sided contract prevents peers from independently minting different IDs for the same room:

1. Local wall edit → synchronous reconciliation → one complete local commit and one undo step.
2. Host patch → apply the transmitted generated state → no local reconciliation or local history entry.

Changes to space-detection scheduling, history pausing, scene commit delivery, or host patch application must preserve both sides of this contract.
