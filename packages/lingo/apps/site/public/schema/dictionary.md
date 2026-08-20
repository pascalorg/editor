# Lingo data-schema dictionary (v3)

The compact wire JSON `JSON.stringify(lingo(...))` produces. Generated from
`@pascal-app/lingo/schema` — do not edit by hand (`node scripts/gen-schemas.mjs`).

## Result types (discriminate on `type`)

| `type` | when | key fields |
|---|---|---|
| `quantity` | one value ("5 kg") | `value`, `unit`, `base`, `baseUnit` |
| `range` | a range ("5–10 kg") | `min`, `max` (or `plusMinus`), `baseUnit` |
| `conversion` | "72 in to cm" | `source`, `converted` |
| `number` | bare number, no unit | `value` |
| `failure` | `ok:false` | `issues`, optional `candidate` |

## Common keys

| key | type | meaning |
|---|---|---|
| `schemaVersion` | `3` | wire-schema version |
| `ok` | `boolean` | `false` ⇒ a `failure` result |
| `kind` | string | measurement kind (see below) |
| `value` | number | amount in `unit` |
| `unit` | string | the unit id it was expressed in |
| `base` | number | canonical amount in `baseUnit` (authoritative) |
| `baseUnit` | string | the kind base unit |
| `text` | string | the full original input |
| `span` | `{start,end,text}` | `[start,end)` char range into the input; `text` is that substring |
| `issues` | Issue[] | warnings/errors (see codes below) |
| `confidence` | number | 0–1 reading confidence |

## Kinds (33)

`length`, `mass`, `temperature`, `duration`, `volume`, `area`, `speed`, `data`, `data_rate`, `flow_rate`, `acceleration`, `pressure`, `energy`, `force`, `torque`, `power`, `frequency`, `angle`, `percent`, `luminous_intensity`, `luminous_flux`, `illuminance`, `luminance`, `voltage`, `current`, `resistance`, `charge`, `substance`, `concentration`, `radiation_absorbed_dose`, `radiation_equivalent_dose`, `radioactivity`, `currency`

## Unit systems

`metric`, `us`, `imperial`, `shared`

## Issue severities

`error`, `warning`, `info`

## Issue codes (33)

| code | meaning |
|---|---|
| `EMPTY` | Input was empty or whitespace. |
| `NO_VALUE` | No number was found. |
| `UNKNOWN_UNIT` | The unit was not recognized. |
| `KIND_MISMATCH` | The unit is not of the expected kind. |
| `RANGE_KIND_MISMATCH` | Range bounds are different kinds. |
| `CONVERSION_KIND_MISMATCH` | Cannot convert across kinds. |
| `RATE_REQUIRED` | A currency conversion needs an exchange rate. |
| `TRAILING_INPUT` | Extra text after the value was not understood. |
| `SINGLE_VALUE_EXPECTED` | A single value was expected, not a range. |
| `APPROX_NOT_ALLOWED` | An approximate value was not allowed here. |
| `UNIT_REQUIRED` | A unit was required but none was given. |
| `CONVERSION_NOT_ALLOWED` | A conversion was not allowed here. |
| `NUMBER_FORMAT` | The number could not be parsed. |
| `NONFINITE` | The value is not finite. |
| `LOCALE_NOT_LOADED` | The requested locale pack was not loaded. |
| `RANGE_MIN` | Value is below the allowed minimum. |
| `RANGE_MAX` | Value is above the allowed maximum. |
| `RANGE_OPEN_BOUND_NOT_ALLOWED` | An open-ended range bound was not allowed. |
| `REQUIRED` | A value is required. |
| `UNSUPPORTED_DATE` | The date could not be understood. |
| `NOW_REQUIRED` | A reference time (`now`) is required. |
| `TYPO_CORRECTED` | A likely typo was auto-corrected. |
| `AMBIGUOUS_NUMBER` | The number was ambiguous (e.g. "1,234"). |
| `AMBIGUOUS_UNIT` | The unit was ambiguous; a default was assumed. |
| `AMBIGUOUS_DATE` | The date was ambiguous; a reading was assumed. |
| `RANGE_REVERSED` | Range bounds were given high-to-low and swapped. |
| `COMPOUND_OVERFLOW` | A compound part exceeded its expected range. |
| `CIVIL_AVERAGE` | An average calendar length was used. |
| `UNIT_ASSUMED` | A unit was assumed from context. |
| `WEEKDAY_ASSUMED_NEXT` | A weekday was read as the next occurrence. |
| `SLANG_UNIT` | A slang unit spelling was interpreted. |
| `TZ_IGNORED` | A time zone was detected but not applied (civil time kept; use applyZone). |
| `AMBIGUOUS_TIMEZONE` | A time-zone abbreviation maps to more than one real zone. |

