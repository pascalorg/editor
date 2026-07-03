# Thermal Power Plant Basic Equipment Pack

Factory-capable coal-fired thermal power plant profile pack based on a campus-style plant layout with cooling towers, boiler and turbine island, coal handling, flue-gas cleanup, chimney, switchyard, and auxiliary buildings.

## Devices

- Natural draft cooling tower (thermal_power.natural_draft_cooling_tower)
- Circulating water pump house (thermal_power.circulating_water_pump_house)
- Coal yard stockpile (thermal_power.coal_yard_stockpile)
- Coal handling conveyor (thermal_power.coal_handling_conveyor)
- Coal pulverizer mill (thermal_power.coal_pulverizer_mill)
- Coal-fired boiler island (thermal_power.boiler_island)
- Steam turbine generator (thermal_power.steam_turbine_generator)
- Surface condenser (thermal_power.surface_condenser)
- Electrostatic precipitator (thermal_power.electrostatic_precipitator)
- Wet FGD absorber tower (thermal_power.fgd_absorber)
- Plant chimney stack (thermal_power.chimney_stack)
- Fly ash silo (thermal_power.fly_ash_silo)
- Water treatment building (thermal_power.water_treatment_building)
- Generator step-up transformer (thermal_power.generator_step_up_transformer)
- High voltage switchyard (thermal_power.switchyard)
- Control room and DCS building (thermal_power.control_room)
- Warehouse and maintenance workshop (thermal_power.warehouse_workshop)

## Pack Type

Factory-capable pack: supports factory/process creation through process templates and factory architectures.

## Factory Creation

Supported whole-factory/process templates:

- Coal-fired thermal power station (thermal_power_coal_fired_station)

Supported factory scopes/modules:

- Coal-fired thermal power station (coal_fired_station)

## Factory Architectures

- Coal-fired thermal power station architecture

## Process Templates

- Coal-fired thermal power station

## Authoring Review

- thermal_power.steam_turbine_generator: boiler_missing_process_features - Boiler profiles should show more than a plain box: include a stack, visible steam drum or tube bank, steam header, and control/service details.

## Validation

Run:

```bash
bun apps/editor/scripts/profile-pack-qa.ts industry.thermal-power.basic@0.1.0 --validate-only
```
