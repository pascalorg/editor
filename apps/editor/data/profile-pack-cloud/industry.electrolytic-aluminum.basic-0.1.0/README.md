# Electrolytic Aluminum Basic Equipment Pack

电解铝行业基础资源包，覆盖电解铝厂整厂、电解车间到铸造线，以及常见电解铝设备。

## Pack Type

Factory-capable pack: supports whole-factory/process creation through process templates and factory architectures.

## Factory Creation

支持整厂 / 工序:

- Electrolytic aluminum smelter (`electrolytic_aluminum_smelter_full`)
- Electrolytic aluminum potroom and casting line (`electrolytic_aluminum_potroom_casting_line`)

支持范围:

- Potroom electrolysis core (`potroom_core`)
- Molten metal transfer and casting (`metal_transfer_and_casting`)
- Full electrolytic aluminum smelter (`full_smelter`)

## Devices

- Potline module (`electrolytic_aluminum.potline_module`)
- Pot tending overhead crane (`electrolytic_aluminum.pot_tending_crane`)
- Rectifier transformer station (`electrolytic_aluminum.rectifier_transformer_station`)
- Alumina storage silo (`electrolytic_aluminum.alumina_storage_silo`)
- Alumina conveying line (`electrolytic_aluminum.alumina_conveying_line`)
- Dry scrubber baghouse (`electrolytic_aluminum.dry_scrubber_baghouse`)
- Vacuum tapping ladle (`electrolytic_aluminum.vacuum_tapping_ladle`)
- Anode assembly station (`electrolytic_aluminum.anode_assembly_station`)
- Molten aluminum holding furnace (`electrolytic_aluminum.molten_aluminum_holding_furnace`)
- Continuous ingot casting line (`electrolytic_aluminum.continuous_ingot_casting_line`)

## Validation

```bash
bun apps/editor/scripts/profile-pack-qa.ts industry.electrolytic-aluminum.basic@0.1.0 --validate-only
```
