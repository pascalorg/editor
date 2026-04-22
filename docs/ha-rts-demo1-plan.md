# HA + RTS Demo 1 Plan

## Purpose

This document defines the **first real end-to-end milestone** for the Home Assistant + RTS work.

It is intentionally narrow.

The goal is not to prove the whole migration. The goal is to prove the smallest believable slice of the final product.

This document does **not** authorize a push or a PR. It only defines the first milestone the implementation should reach.

## Demo 1 Definition

**Demo 1** means:

- one fake Home Assistant light exists inside the real local HA instance
- Pascal can connect to that HA instance
- Pascal can import that fake light
- one `Dining room` ceiling lamp in the Pascal editor can be linked to it
- one collection is created for that link
- one RTS control appears at the linked lamp position
- clicking that RTS control affects the HA-backed light
- Pascal reflects the returned HA state
- reloading the editor keeps the same binding and the same RTS control

If any of those are missing, Demo 1 is **not** complete.

## Exact Target For Demo 1

### Home Assistant side

Use one fake/demo/template-backed HA entity:

- `light.pascal_dining_single`

This light should be:

- importable
- toggleable
- brightness-capable if practical

### Pascal side

Use one real item on the default layout:

- one `Dining room` `Ceiling Lamp`

The current default layout is served from:

- [route.ts](/C:/Users/briss/.codex/worktrees/610d/editor/apps/editor/app/api/default-layout/route.ts)

which currently reads:

- `C:\Users\briss\Downloads\layout_2026-04-08.json`

## Why Demo 1 Comes First

Demo 1 proves the real backbone of the product:

- HA connection
- HA import
- Pascal collection binding
- RTS spatial rendering
- HA action execution
- HA state coming back
- reload persistence

It avoids broader complexity such as:

- grouped controls
- multiple linked items
- fans
- scripts/scenes/automations
- unlink flow
- room-wide empty-state cleanup beyond what is necessary

So Demo 1 is the fastest path to something real instead of theoretical.

## Demo 1 Success Criteria

Demo 1 is done only when all of these are true:

1. Pascal connects to the local Home Assistant instance successfully.
2. The import list shows `light.pascal_dining_single`.
3. One `Dining room` ceiling lamp can be selected in Pascal and linked to that light.
4. A collection is created or updated to hold that link.
5. The `Dining room` RTS control appears at the linked lamp location.
6. Clicking that RTS control sends the collection-based action path to HA.
7. The HA light changes state.
8. Pascal updates to reflect the returned HA-backed state.
9. Reloading the editor preserves the binding and restores the RTS control.

## Out Of Scope For Demo 1

These are **not** required for Demo 1:

- grouped light control
- multi-item collection linking
- fan control
- script/scene/automation trigger tiles
- unlink UI
- import refresh edge cases
- multiple HA instances
- manual RTS placement overrides

Those come after Demo 1.

## Required Fixture Before Starting

Before any Pascal implementation work is counted toward Demo 1, the following HA fixture must exist:

- one fake/demo/template-backed light:
  - `light.pascal_dining_single`

Recommended construction:

- real Home Assistant instance
- helper-backed or template-backed fake light state
- no physical device required

The important point is:

- **Home Assistant is real**
- **the test light is fake**

That keeps the dev loop realistic without depending on a real apartment device.

## Implementation Order

Proceed in this exact order.

### Step 1. Build the HA fixture

Create `light.pascal_dining_single` in the local Home Assistant instance.

Exit condition:

- the light exists in HA and can be toggled there

### Step 2. Prove connect + import

Make sure Pascal can:

- connect to HA
- import `light.pascal_dining_single`

Exit condition:

- the light shows up in the Pascal import list

### Step 3. Finish the single-item link flow

In the editor:

- select one `Dining room` ceiling lamp
- link it to `light.pascal_dining_single`

Exit condition:

- a collection exists for that link

### Step 4. Finish single-control RTS rendering

Render one RTS control from that collection only.

Requirements:

- it should appear at the linked lamp position
- it should not rely on viewer-local durable grouping state

Exit condition:

- the linked `Dining room` lamp has a visible RTS control in the right place

### Step 5. Finish the collection-based action path

Clicking that RTS control must:

- resolve the collection
- call the collection-based backend route
- trigger the HA action

Exit condition:

- the old item-direct path is not used for this flow

### Step 6. Finish state coming back from HA

After the action fires:

- Pascal must reflect the new HA-backed state

Exit condition:

- the RTS/UI state and Pascal visuals match the updated HA state

### Step 7. Finish reload persistence

Reload the editor and verify:

- the collection still exists
- the link still exists
- the RTS control still appears in the same place

Exit condition:

- the Demo 1 flow survives reload

## Demo 1 Validation Walkthrough

This is the human-facing check once implementation is in place.

### Validation A. Connect and import

Expected result:

- `light.pascal_dining_single` is visible in the HA import list

### Validation B. Link one lamp

Expected result:

- one `Dining room` ceiling lamp is linked to the imported light

### Validation C. See the RTS control

Expected result:

- one RTS control appears over that linked lamp

### Validation D. Click it

Expected result:

- the HA-backed light changes state
- Pascal reflects the change

### Validation E. Reload

Expected result:

- the same binding and RTS control come back after reload

## Evidence Required Before Calling Demo 1 Done

The minimum proof set is:

- app route proof that HA connection works
- import proof showing `light.pascal_dining_single`
- editor proof that the `Dining room` lamp is linked
- runtime proof that the RTS control appears in the correct place
- runtime proof that clicking it changes HA state
- reload proof that the binding persists

## What Comes Immediately After Demo 1

Once Demo 1 is complete, the next best sequence is:

1. grouped dining-room light demo
2. master-bedroom fan demo
3. trigger-only living-room script/scene demo
4. unlink demo
5. import refresh and edge-case cleanup

## One-Sentence Summary

Demo 1 is: **one fake HA light imported into Pascal, linked to one `Dining room` lamp, shown as one RTS control in the right place, clickable through the collection path, and still there after reload.**
