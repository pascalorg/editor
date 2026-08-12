# Blender Edit-Mode Material Assignment Research

## Purpose and conclusion

This brief records Blender's per-face material workflow and translates its useful interaction contracts into a Pascal custom-mesh plan. Blender behavior claims use only the official Blender manual, Python API, and source mirror. Source links are pinned to commit `ce63cce6b7d645d6565f0f973142209b5069a7b2`; the research was completed on 2026-08-12.

The central design is deliberately two-level:

1. A reusable **Material** data-block owns the appearance.
2. An object's ordered **material slots** reference materials.
3. Each face stores one slot choice; it does not contain or duplicate the material.

Pascal already has the corresponding persistent pieces in a safer stable-ID form: `CustomMeshFace.materialSlot` identifies an object-local slot, `CustomMeshNode.slots` maps slot IDs to reusable `MaterialRef` values, and the scene owns reusable materials. The missing product surface is an editor-owned active slot plus explicit face assignment controls.

## Blender's data model

Materials are reusable data-blocks that can be assigned to one or more objects. Material slots link those data-blocks to an object/mesh. Blender starts with one slot applying one material to the whole object; multiple slots allow different parts of the mesh to use different materials. [Blender material assignment manual](https://docs.blender.org/manual/en/5.0/render/materials/assignment.html#material-slots)

For a mesh, each polygon has one zero-based `material_index`, documented as the polygon's material-slot index with a default of `0`. It is therefore a many-faces-to-one-slot mapping: every face chooses exactly one slot, while any number of faces can share it. [Blender `MeshPolygon.material_index` API](https://docs.blender.org/api/current/bpy.types.MeshPolygon.html#bpy.types.MeshPolygon.material_index)

Slot identity and Material identity are different:

- A slot is an object/mesh-local position in an ordered list.
- A Material is a reusable data-block referenced by a slot.
- The same Material can be reused in other objects and can even occur in more than one slot on an object. Blender's assignment code explicitly prefers the active object's slot index before falling back to searching for a matching Material data-block, because duplicate slot references are possible. [Blender material assignment operator](https://github.com/blender/blender/blob/ce63cce6b7d645d6565f0f973142209b5069a7b2/source/blender/editors/render/render_shading.cc#L310-L343)

The Material data-block picker is the reuse surface. It lists materials in the current blend file, supports name search, and lets the user place an existing Material in the selected slot instead of duplicating it. [Blender reusing existing materials](https://docs.blender.org/manual/en/5.0/render/materials/assignment.html#reusing-existing-materials)

Blender additionally supports linking slot materials to either a specific object or its shared mesh data. That distinction matters for Blender instances, but Pascal should not copy it unless custom meshes later gain shared editable topology instances: Pascal's existing scene `MaterialRef` plus per-node `slots` mapping already provides the relevant reuse boundary. [Blender material slot link behavior](https://docs.blender.org/manual/en/5.0/render/materials/assignment.html#data-block)

## Edit Mode workflow

Blender exposes the object material-slot list in Material Properties. In Edit Mode it adds three face-oriented actions below the list: **Assign**, **Select**, and **Deselect**. The documented workflow for applying a second material is:

1. Begin with the base material covering the object.
2. Enter Edit Mode and Face Select.
3. Select one or many target faces.
4. Add/select a material slot and choose a new or existing Material for it.
5. Press **Assign**.

[Blender Edit Mode material controls](https://docs.blender.org/manual/en/5.0/render/materials/assignment.html#edit-mode), [Blender multiple-material workflow](https://docs.blender.org/manual/en/5.0/render/materials/assignment.html#multiple-materials)

The three actions have distinct semantics:

| Action       | Blender behavior                                                  | Important invariant                                                                          |
| ------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Assign**   | Writes the active slot index to every selected face.              | It overwrites those faces' previous assignments and leaves unselected faces unchanged.       |
| **Select**   | Selects visible faces whose assignment matches the active slot.   | It adds matching faces to the current selection; it does not clear unrelated selected faces. |
| **Deselect** | Deselects visible faces whose assignment matches the active slot. | It subtracts matching faces from the current selection; it does not change any assignment.   |

The manual defines the public actions. The source shows that Assign loops over selected edit-mesh faces and sets `efa->mat_nr`, while Select/Deselect visit matching, non-hidden faces and set only their selection state. [Blender Assign implementation](https://github.com/blender/blender/blob/ce63cce6b7d645d6565f0f973142209b5069a7b2/source/blender/editors/render/render_shading.cc#L344-L408), [Blender material Select/Deselect implementation](https://github.com/blender/blender/blob/ce63cce6b7d645d6565f0f973142209b5069a7b2/source/blender/editors/mesh/editmesh_select.cc#L3450-L3466)

Assigning multiple selected faces is a single operator and a single undoable action. Repeating Assign with another active slot directly replaces the selected faces' earlier slot index; there is no layered material stack per face. [Blender material assignment operator registration](https://github.com/blender/blender/blob/ce63cce6b7d645d6565f0f973142209b5069a7b2/source/blender/editors/render/render_shading.cc#L400-L408)

### Active slot synchronization

When face picking resolves a face, Blender sets the object's active material index from that face's `mat_nr`. This makes the material panel follow the active/clicked face rather than forcing the user to hunt for its slot manually. [Blender face-pick active-material synchronization](https://github.com/blender/blender/blob/ce63cce6b7d645d6565f0f973142209b5069a7b2/source/blender/editors/mesh/editmesh_select.cc#L2918-L2925)

This does not mean every multi-face selection has one material. A selection can contain faces with mixed assignments; the active face supplies the panel's active slot, and an explicit Assign then makes all selected faces use that slot.

### Choosing a Material is not Assign

There are two mutations that should remain conceptually separate:

- Replacing the Material referenced by an existing slot changes the appearance of **every face already using that slot**.
- Pressing Assign changes the slot choice of **the currently selected faces**.

Blender's UI makes the distinction through the slot list/data-block chooser and the separate Assign button. Pascal may streamline the number of clicks, but a control that edits a shared slot must not look like a face-scoped assignment. Otherwise changing one selected face could unexpectedly repaint many unselected faces.

## Removal, cleanup, and the absence of per-face unassign

Blender does not provide an **Unassign** action for faces. A face is moved back to the base appearance by assigning the base/first slot to it. Deselect only changes selection.

Removing a material slot is an object-level structural action, not per-face unassignment, and current Blender blocks it during Edit Mode. [Blender material-slot removal poll](https://github.com/blender/blender/blob/ce63cce6b7d645d6565f0f973142209b5069a7b2/source/blender/editors/render/render_shading.cc#L245-L302)

When a slot is removed in Object Mode, Blender removes that ordered entry and remaps face indices. Higher indices shift down; faces using the removed nonzero slot fall back to the preceding slot, while removing slot zero leaves its faces at index zero so they use the new first slot. This is an implementation consequence of Blender's ordinal indices, not a desirable interaction to copy blindly. [Blender slot removal](https://github.com/blender/blender/blob/ce63cce6b7d645d6565f0f973142209b5069a7b2/source/blender/blenkernel/intern/material.cc#L1461-L1546), [Blender mesh material-index remapping](https://github.com/blender/blender/blob/ce63cce6b7d645d6565f0f973142209b5069a7b2/source/blender/blenkernel/intern/mesh.cc#L1812-L1834)

Blender distinguishes slot cleanup from deleting reusable materials:

- **Remove Unused Slots** removes slots not referenced by object geometry.
- **Remove All Materials** clears the active object's slots, but the Material data-blocks remain available in the blend file.
- Unlinking a Material from one object does not destroy it while it has other users; zero-user persistence follows Blender's general data-block lifecycle.

[Blender slot cleanup](https://docs.blender.org/manual/en/5.0/render/materials/assignment.html#slot-list), [Blender deleting a material](https://docs.blender.org/manual/en/5.0/render/materials/assignment.html#deleting-a-material), [Blender data-block lifecycle](https://docs.blender.org/manual/en/5.0/files/data_blocks.html)

## Recommended Pascal contract

This section is a product inference based on Blender's behavior and Pascal's current model.

### Persistent state

Keep Pascal's stable string slot IDs rather than copying Blender's fragile ordered indices:

```ts
type CustomMeshFace = {
  id: string;
  vertexIds: string[];
  materialSlot: string;
};

type CustomMeshNode = {
  topology: { faces: CustomMeshFace[] /* ... */ };
  slots?: Record<string, MaterialRef>;
};
```

The initial custom mesh keeps every face on `materialSlot: "body"`. Its `body` slot resolves to one reusable scene/library material, preserving the current one-material default. Adding another material creates a new stable slot ID and maps it to a `MaterialRef`; assigning faces changes only their `materialSlot` string.

The current schema already has this shape in [`custom-mesh.ts`](../packages/core/src/schema/nodes/custom-mesh.ts). No face should store copied shader/color/texture properties.

### Transient editor state

The Edit Mode session should own an `activeMaterialSlotId`. It should not be persisted as scene data and it should remain independent of component selection.

- Clicking a face makes that face active and synchronizes `activeMaterialSlotId` to its slot.
- Shift-selecting additional faces may produce a mixed-material selection; the active face still drives the displayed slot.
- Manually choosing a slot in the panel changes `activeMaterialSlotId` without repainting anything.
- Assign is enabled only when at least one editable face is selected.
- Assign produces one immutable topology update and one undo entry, regardless of face count.

### Side-panel shape

A Blender-derived Pascal panel can be compact:

1. **Face Material** section visible in custom-mesh Edit Mode, primarily in Face selection mode.
2. Active slot/material preview and a searchable reusable-material chooser backed by the current scene materials. Library materials may appear too, but choosing one should resolve/mint the same shared `MaterialRef` used elsewhere in Pascal.
3. **Assign to selected** as the explicit mutating action, with the selection count in its label or nearby.
4. **Select faces** and **Deselect faces** for the active slot; these are valuable once models have many faces.
5. An add-slot path that reuses a scene Material instead of creating a duplicate.
6. Slot rename and remove/cleanup can be deferred; removal needs an explicit Pascal fallback policy because stable IDs do not require Blender's accidental preceding-slot remap.

For a faster UX, clicking a material search result could perform “ensure object slot + assign to selected” in one undoable command. If adopted, label it as assignment and keep slot editing elsewhere; silently replacing the active slot's shared material reference would have much broader effects.

### Material identity and slot deduplication

For the MVP, one object-local slot per `MaterialRef` is the least surprising policy. If the chosen reusable material already has a slot on the mesh, activate and assign that slot; otherwise create a slot and assign it. Blender permits duplicate slots referencing the same Material, but Pascal has no demonstrated need for duplicate semantic slots yet.

Do not infer that identical-looking materials are the same. Reuse should be based on `MaterialRef` identity. A later explicit duplicate/copy action can create an independently editable scene material.

### Topology-operation invariant

Every topology command must preserve or deterministically derive face assignments:

- Retained faces keep their `materialSlot`.
- Split/inset faces inherit from their source face unless the operator defines otherwise.
- Extruded caps inherit the source face; new side faces need a documented source/fallback rule.
- Merge/dissolve across mixed materials needs a deterministic active/source-face policy.
- Deleting the last face using a slot does not need to delete the reusable Material; optional slot cleanup is separate.

This is more important than matching Blender's exact removal remap because custom-mesh commands already operate on stable face identities.

## MVP acceptance matrix

| Case                                                         | Expected result                                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| New custom mesh                                              | All faces resolve through the single `body` slot and show one material.                                 |
| Click a face                                                 | The face becomes active/selected and the panel follows its assigned material.                           |
| Select several faces, choose a reused scene material, Assign | One object slot is reused or created; every selected face points to it; unselected faces are unchanged. |
| Selected faces have mixed materials                          | Panel communicates Mixed while preserving the active face/slot; Assign normalizes only the selection.   |
| Change which slot is active                                  | No face appearance changes until Assign.                                                                |
| Edit the Material referenced by a slot                       | Every face/object using that reusable Material updates.                                                 |
| Select faces by active material                              | Matching visible faces are added without clearing unrelated selected faces.                             |
| Deselect faces by active material                            | Matching visible faces are removed from selection; assignments are unchanged.                           |
| Reassign a face to `body`                                    | Face returns to the base material; no null/unassigned state is needed.                                  |
| Undo a 20-face assignment                                    | One undo restores every prior per-face slot assignment.                                                 |
| Extrude/inset an assigned face                               | New faces follow the documented inheritance rule and every slot reference remains valid.                |
| Remove an unused object slot                                 | No face changes and the reusable scene Material remains available.                                      |

## Implemented decisions

1. Pascal exposes the object slot list and reusable scene/library material choices in the custom-mesh inspector.
2. Material choice and face assignment remain separate; **Assign** is the explicit mutating action.
3. Mixed selections show **Mixed materials**, while the active face continues to drive the active slot.
4. **Select** and **Deselect** ship with the MVP and modify only transient face selection.
5. Object-mode cleanup removes unused object-local slots only. `body` remains permanent, reusable scene materials remain available, and no implicit ordinal remapping is introduced.
6. Extrude and inset inherit the source face, loop-cut pieces inherit the face they split, and bevel/dissolve use the first adjacent face in stable topology order.
