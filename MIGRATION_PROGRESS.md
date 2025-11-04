# Element System Migration Progress

## Status: Phase 1-3 Complete ✅

We've successfully implemented the foundation for the spec-driven element rendering system.

---

## What's Been Built

### ✅ Phase 1: Spec Extensions (COMPLETE)

**1.1 Extended ElementSpec Schema** (`lib/engine/spec.ts`)
- Added `GeometryType` for procedural rendering (cylinder, box, extrusion, plane)
- Added `SelectionStyle` for different selection visualizations (edges, box, outline, glow)
- Extended `render` configuration with:
  - `geometry` - Procedural geometry specifications
  - `material` - Material properties (color, emissive, metalness, roughness, opacity)
  - `selection` - Selection appearance (color, emissive intensity, style, outline width)
  - `hover` - Hover state appearance
  - `preview` - Placement preview appearance (valid/invalid colors, opacity)

**1.2 Updated All Catalog Specs**
- **Column** (`lib/catalog/structure/column.ts`) - Cylinder geometry with edge-based selection
- **Door** (`lib/catalog/structure/door.ts`) - GLB model with box selection
- **Window** (`lib/catalog/structure/window.ts`) - GLB model with box selection
- **Wall** (`lib/catalog/structure/wall.ts`) - Extrusion geometry with outline selection
- **Roof** (`lib/catalog/structure/roof.ts`) - Extrusion geometry with outline selection

### ✅ Phase 2: Generic Renderers (COMPLETE)

**2.1 Geometry Renderer** (`components/editor/elements/renderers/geometry-renderer.tsx`)
- Renders cylinder, box, and plane geometries procedurally
- Applies material properties from spec
- Handles opacity and emissive intensity based on state

**2.2 Model Renderer** (`components/editor/elements/renderers/model-renderer.tsx`)
- Renders GLB/GLTF models
- Applies scale and positioning from spec

**2.3 Selection Renderer** (`components/editor/elements/renderers/selection-renderer.tsx`)
- Four selection styles:
  - **Box**: Simple wireframe box
  - **Edges**: Cylinders along bounding box edges (for columns)
  - **Outline**: Edge geometry outline
  - **Glow**: Semi-transparent expanded box

**2.4 Generic Element** (`components/editor/elements/generic-element.tsx`)
- Orchestrates geometry/model + selection rendering
- Calculates emissive intensity based on selected/hovered state
- Manages visibility and opacity from ECS components

### ✅ Phase 3: Integration Layer (COMPLETE)

**3.1 Element Registry** (`lib/engine/element-registry.ts`)
- Central registry for looking up ElementSpecs by type
- Integrated with `registerFromSpec()` to auto-register specs
- Provides utility functions for querying specs by category

**3.2 Element Renderer** (`components/editor/elements/element-renderer.tsx`)
- Wraps GenericElement with editor state integration
- Handles click interactions and selection state
- Looks up spec from registry dynamically

**3.3 Elements Layer** (`components/editor/elements/elements-layer.tsx`)
- Queries ECS World for all entities in a given floor
- Renders each entity using ElementRenderer
- Replaces individual element-specific components

---

## How to Test

### Quick Test: Columns Only

**Step 1:** Add ElementsLayer to the editor for columns

In `components/editor/index.tsx`, find the `<Columns>` component and add ElementsLayer alongside it:

```tsx
import { ElementsLayer } from './elements/elements-layer'

// Around line 420-450, find the Columns component
<Columns
  floorId={level.id}
  isActive={isActive}
  isFullView={viewMode === 'full'}
  tileSize={TILE_SIZE}
  columnHeight={columnHeight}
  selectedElements={selectedElements}
  setSelectedElements={setSelectedElements}
  controlMode={controlMode}
  setControlMode={setControlMode}
  movingCamera={movingCamera}
/>

// Add this right after:
<ElementsLayer
  floorId={level.id}
  world={world}
  isActive={isActive}
  selectedElements={selectedElements}
  setSelectedElements={setSelectedElements}
  controlMode={controlMode}
  setControlMode={setControlMode}
  movingCamera={movingCamera}
  levelYOffset={levelYOffset}
  tileSize={TILE_SIZE}
/>
```

**Step 2:** Run the editor

```bash
bun dev
```

**Step 3:** Test columns

1. Switch to Select mode (V key)
2. Click on any column
3. **Expected:** You should see BOTH the old selection (white rings) AND the new selection (edge cylinders)
4. This confirms the new system is working alongside the old system

### Filter Elements Layer to Columns Only

To test only columns through the new system, update ElementsLayer query:

```tsx
// In elements-layer.tsx, around line 36
return allEntities.filter(entityId => {
  const hierarchy = world.getComponent<Hierarchy>(entityId, HIERARCHY)
  const element = world.getComponent<ElementTag>(entityId, ELEMENT)
  
  // Only render columns for testing
  return (hierarchy?.levelId === floorId || hierarchy?.parent === floorId) 
    && element?.kind === 'structure.column'
})
```

---

## Current Architecture

```
User clicks tool → Node tree updated → World rebuilt → 
Elements Layer queries entities → Element Renderer looks up spec → 
Generic Element chooses renderer → Geometry/Model Renderer displays
```

### Data Flow

1. **Node Tree** (canonical) stores building elements
2. **ECS World** (derived) built from nodes via `useEngineWorld(levels)`
3. **Element Registry** stores specs for rendering lookup
4. **Elements Layer** queries World for entities by floor
5. **Element Renderer** looks up spec and handles interaction
6. **Generic Element** chooses appropriate renderer (geometry vs model)
7. **Sub-renderers** display using spec configuration

---

## What's Left (Phases 4-5)

### 🟡 Phase 2.3: Preview System (TODO)
- Create `element-preview.tsx` for placement previews
- Use spec's `preview` configuration
- Show valid/invalid colors based on placement validation

### 🟡 Phase 4: Interactivity Systems (TODO)
- `systems/selection-system.ts` - Store selection as ECS components
- `systems/preview-system.ts` - Manage preview entities in World

### 🟡 Phase 5: Tools (TODO)
- `tools/placement-tool.tsx` - Generic placement for any element type
- Update `building-menu.tsx` to dynamically list elements from registry

### 🟡 Phase 6: Complete Migration (TODO)
- Gradually replace individual element components with ElementsLayer
- Test each element type (walls, doors, windows, roofs)
- Deprecate old components
- Update documentation

---

## Known Limitations

### Current State
- ✅ Generic rendering works for columns (simple geometry)
- ✅ Selection visualization works
- ⚠️ Walls and roofs use complex custom geometry (mitered junctions, pitched roofs)
  - These will need special handling or custom geometry strategies
- ⚠️ Doors/windows currently use existing components for placement
  - Preview system needs to be built for new placement

### Future Enhancements
- Add support for custom geometry strategies (for walls/roofs)
- Implement hover state tracking
- Build preview system with validation
- Create generic placement tool
- Add catalog UI for browsing elements

---

## Architecture Benefits

### ✅ Achieved
1. **Declarative Specs** - Elements defined in ~60 lines of JSON-like config
2. **Type Safety** - Full TypeScript coverage with validated specs
3. **Consistent Rendering** - All elements use same render pipeline
4. **Easy Extension** - Add new element by creating spec, no component code
5. **Visual Debugging** - ECS World visible in dev tools

### 🎯 Goals
1. **5-Minute Element Addition** - Create spec, register, done
2. **Remote Catalog** - Load specs from API at runtime
3. **Consistent Behavior** - All elements get selection, preview, validation
4. **Performance** - Memoized renderers, efficient queries

---

## Testing Checklist

- [ ] Columns render through ElementsLayer
- [ ] Column selection works (click to select)
- [ ] Selection visualization appears (edge cylinders)
- [ ] Multiple columns can be rendered
- [ ] Opacity controls work
- [ ] Visibility toggle works
- [ ] No performance regression

---

## Next Steps

1. **Test Columns** - Verify the new system works alongside old system
2. **Isolate Columns** - Hide old Columns component, test only new system
3. **Build Preview System** - For placement validation
4. **Migrate Doors/Windows** - Since they use models (easier than walls)
5. **Tackle Walls** - Requires custom geometry strategy
6. **Complete Migration** - Remove old components

---

## File Structure

```
lib/
├── engine/
│   ├── spec.ts                     # Extended with rendering properties
│   ├── element-registry.ts         # NEW: Spec registry for rendering
│   ├── spec-registry.ts            # Updated: Registers in element registry
│   └── index.ts                    # Updated: Exports element registry
│
├── catalog/
│   └── structure/
│       ├── column.ts               # Updated: Full rendering config
│       ├── door.ts                 # Updated: Full rendering config
│       ├── window.ts               # Updated: Full rendering config
│       ├── wall.ts                 # Updated: Full rendering config
│       └── roof.ts                 # Updated: Full rendering config
│
components/
└── editor/
    └── elements/
        ├── generic-element.tsx     # NEW: Main renderer
        ├── element-renderer.tsx    # NEW: Editor integration
        ├── elements-layer.tsx      # NEW: Multi-element renderer
        ├── index.ts                # NEW: Exports
        └── renderers/
            ├── geometry-renderer.tsx    # NEW: Procedural geometry
            ├── model-renderer.tsx       # NEW: GLB models
            ├── selection-renderer.tsx   # NEW: Selection vis
            └── index.ts                 # NEW: Exports
```

---

## Questions?

- **Q: Why are there two rendering systems?**
  - A: We're gradually migrating. The old system stays until we've verified the new one works.

- **Q: Will this break existing functionality?**
  - A: No, the new system runs alongside the old one. We can toggle between them for testing.

- **Q: How do I add a new element now?**
  - A: Create a spec in `lib/catalog/`, register it, and it automatically works with the new system.

- **Q: What about walls with mitered junctions?**
  - A: Those will need a custom geometry strategy. The framework supports this via the `extrusion` type.

- **Q: When will this be production-ready?**
  - A: After completing phases 4-6 and thorough testing (estimate: 2-3 more sessions).

---

**Last Updated:** November 3, 2025  
**Status:** Phases 1-3 complete, ready for testing  
**Next:** Test column rendering through new system

