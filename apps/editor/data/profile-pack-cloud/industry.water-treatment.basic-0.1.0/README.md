# Water Treatment Basic Equipment Pack

水处理行业基础资源包，覆盖水处理厂整厂，以及沉淀、加药、过滤、泵送、管廊和污泥脱水设备。

## Pack Type

Factory-capable pack: supports whole-factory/process creation through process templates and factory architectures.

## Factory Creation

支持整厂 / 工序:

- Water treatment plant (`water_treatment_plant_basic`)

支持范围:

- Water treatment plant basic architecture (`water_treatment.factory.basic`)

## Devices

- Sedimentation tank (`water_treatment.sedimentation_tank`)
- Chemical dosing unit (`water_treatment.chemical_dosing_unit`)
- Filter vessel (`water_treatment.filter_vessel`)
- Pump skid (`water_treatment.pump_skid`)
- Pipe corridor (`water_treatment.pipe_corridor`)
- Sludge dewatering machine (`water_treatment.sludge_dewatering_machine`)

## Validation

```bash
bun apps/editor/scripts/profile-pack-qa.ts industry.water-treatment.basic@0.1.0 --validate-only
```
