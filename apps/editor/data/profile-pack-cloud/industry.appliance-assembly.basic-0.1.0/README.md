# Appliance Assembly Basic Equipment Pack

Factory-capable home appliance final assembly pack for a strict two-floor workshop building with roof, mezzanine production areas, conveyor lines, kitting, foaming, testing, aging, packaging, palletizing, controls, and utility equipment.

## Devices

- Two-floor workshop shell (appliance_assembly.two_floor_workshop_shell)
- Parts kitting station (appliance_assembly.parts_kitting_station)
- Mezzanine storage rack (appliance_assembly.mezzanine_storage_rack)
- Door liner assembly station (appliance_assembly.door_liner_assembly_station)
- Vertical lift conveyor (appliance_assembly.vertical_lift_conveyor)
- Sheet metal buffer rack (appliance_assembly.sheet_metal_buffer)
- Cabinet foaming press (appliance_assembly.cabinet_foaming_press)
- Curing buffer conveyor (appliance_assembly.curing_buffer_conveyor)
- Final assembly conveyor (appliance_assembly.final_assembly_conveyor)
- Screw fastening station (appliance_assembly.screw_fastening_station)
- Leak test station (appliance_assembly.leak_test_station)
- Functional test bench (appliance_assembly.functional_test_bench)
- Aging burn-in rack (appliance_assembly.aging_burn_in_rack)
- Vision inspection gate (appliance_assembly.vision_inspection_gate)
- Carton packaging station (appliance_assembly.carton_packaging_station)
- Palletizing robot cell (appliance_assembly.palletizing_robot_cell)
- Material cart (appliance_assembly.material_cart)
- Mezzanine control room (appliance_assembly.mezzanine_control_room)
- Line control cabinet (appliance_assembly.line_control_cabinet)
- Utility air skid (appliance_assembly.utility_air_skid)
- Overhead utility rack (appliance_assembly.overhead_utility_rack)

## Pack Type

Factory-capable pack: supports factory/process creation through process templates and factory architectures.

## Factory Creation

Supported whole-factory/process templates:

- Appliance assembly final assembly factory (appliance_assembly_final_assembly_factory)

Supported factory scopes/modules:

- Main final assembly line (main_final_assembly_line)
- Full two-floor appliance assembly factory (full_two_floor_factory)

## Factory Architectures

- Appliance assembly two-floor final assembly architecture

## Process Templates

- Appliance assembly final assembly factory

## Authoring Review

- No scaffold authoring warnings.

## Validation

Run:

```bash
bun apps/editor/scripts/profile-pack-qa.ts industry.appliance-assembly.basic@0.1.0 --validate-only
```
