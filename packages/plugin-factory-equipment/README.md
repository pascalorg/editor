# `@pascal-app/plugin-factory-equipment`

First-party factory equipment plugin for Pascal.

This package owns reusable equipment node implementations such as
`factory:pump`. Industry packs do not duplicate this geometry. They bind their
industry profiles to these node kinds and provide profile defaults, constraints,
quality rules, and selection vocabulary.

## Relationship To Industry Packs

- Factory equipment plugin: horizontal node capability package.
- Industry pack: vertical domain knowledge package.
- Binding: maps an industry profile such as `chemical.centrifugal_pump` to a
  factory node such as `factory:pump`.

Example:

```json
{
  "profileId": "chemical.centrifugal_pump",
  "nodeKind": "factory:pump",
  "paramMap": {
    "pumpType": { "source": "literal", "value": "centrifugal" },
    "length": "envelope.length",
    "inletDiameter": "ports.inlet.diameter",
    "outletDiameter": "ports.outlet.diameter"
  }
}
```

The result is that AI and industry packs select/configure constrained equipment
generators instead of asking the model to invent primitive geometry each time.
