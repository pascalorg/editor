# Water Treatment Basic Equipment Pack

Basic water and wastewater treatment equipment profiles for sedimentation, chemical dosing, filtration, pumping, pipe corridors, and sludge dewatering.

## Devices

- Sedimentation tank (water_treatment.sedimentation_tank)
- Chemical dosing unit (water_treatment.chemical_dosing_unit)
- Filter vessel (water_treatment.filter_vessel)
- Pump skid (water_treatment.pump_skid)
- Pipe corridor (water_treatment.pipe_corridor)
- Sludge dewatering machine (water_treatment.sludge_dewatering_machine)

## Factory Architectures

- Water treatment plant basic architecture

## Process Templates

- Water treatment plant

## Validation

Run:

```bash
bun apps/editor/scripts/profile-pack-qa.ts industry.water-treatment.basic@0.1.0 --validate-only
```

