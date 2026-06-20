# Electrolytic Aluminum Basic Equipment Pack

Basic equipment profiles for electrolytic aluminum smelters, covering potroom electrolysis, alumina handling, rectifier power supply, pot tending, fume treatment, molten aluminum transfer, anode assembly, holding furnace, and ingot casting scenarios.

## Devices

- Aluminum electrolytic cell (electrolytic_aluminum.electrolytic_cell)
- Pot tending overhead crane (electrolytic_aluminum.pot_tending_crane)
- Rectifier transformer station (electrolytic_aluminum.rectifier_transformer_station)
- Alumina storage silo (electrolytic_aluminum.alumina_storage_silo)
- Alumina conveying line (electrolytic_aluminum.alumina_conveying_line)
- Dry scrubber baghouse (electrolytic_aluminum.dry_scrubber_baghouse)
- Vacuum tapping ladle (electrolytic_aluminum.vacuum_tapping_ladle)
- Anode assembly station (electrolytic_aluminum.anode_assembly_station)
- Molten aluminum holding furnace (electrolytic_aluminum.molten_aluminum_holding_furnace)
- Continuous ingot casting line (electrolytic_aluminum.continuous_ingot_casting_line)

## Validation

Run:

```bash
bun apps/editor/scripts/profile-pack-qa.ts industry.electrolytic-aluminum.basic@0.1.0 --validate-only
```

