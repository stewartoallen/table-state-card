# Table State Card

Table State Card is a compact Home Assistant Lovelace table for repeated rows of controls, values, and small history sparklines.

It is intended for dense operational views where stock entity rows, graph cards, and stacks use too much padding.

## Installation

Add this dashboard resource:

```text
/local/community/table-state-card/table-state-card.js
```

Resource type:

```text
JavaScript module
```

Then refresh the browser.

## Example

```yaml
type: custom:table-state-card
title: Zones
hours_to_show: 6
refresh_interval: 300
row_height: 26
columns:
  - type: toggle
    key: fan
    width: 24px
  - type: name
    width: minmax(80px, 1fr)
  - type: value
    key: temperature
    width: 64px
  - type: sparkline
    key: temperature
    width: minmax(90px, 1.4fr)
entities:
  - entity: switch.office_fan
    name: Office
    fan: switch.office_fan
    temperature: sensor.office_temperature
  - entity: switch.bedroom_fan
    name: Bedroom
    fan: switch.bedroom_fan
    temperature: sensor.bedroom_temperature
```

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `entities` | list | required | Entity rows. Strings are treated as `{ entity }`. |
| `columns` | list | `toggle`, `name`, `value`, `sparkline` | Column definitions as strings or objects with `type` and optional `width`. |
| `title` | string | none | Card title. Omit to hide. |
| `hours_to_show` | number | `6` | Sparkline history range in hours. |
| `refresh_interval` | number | `300` | Seconds between history refreshes. |
| `row_height` | number/string | `28` | Row height in pixels, or any CSS size. |
| `entities[].entity` | string | none | Main row entity. Used for toggle/value/history unless overridden. |
| `entities[].name` | string | friendly name | Display name. |
| `entities[].toggle_entity` | string | `entity` | Entity toggled by the toggle column. |
| `entities[].value_entity` | string | `entity` | Entity displayed by the value column. |
| `entities[].history_entity` | string | `value_entity`/`entity` | Entity used for sparkline history. |
| `entities[].<key>` | string | none | Named entity reference used by a column with matching `key`, `name`, or `id`. |
| `entities[].color` | string | theme primary | Sparkline stroke color. |
| `entities[].fill` | string | theme primary tint | Sparkline fill color. |

## Columns

Supported column types:

- `toggle`: compact toggle button using `homeassistant.toggle`
- `name`: row label
- `value` or `state`: current state with unit
- `sparkline` or `history`: compact SVG sparkline from history

Each column can specify a CSS grid width:

```yaml
columns:
  - type: toggle
    width: 24px
  - type: value
    width: max-content
  - type: sparkline
    width: minmax(90px, 1fr)
```

Columns can resolve entities several ways. The most flexible pattern is to give a column a `key` and put matching entity IDs on each row:

```yaml
columns:
  - type: toggle
    key: fan
  - type: value
    key: temperature
  - type: sparkline
    key: temperature
entities:
  - name: Office
    fan: switch.office_fan
    temperature: sensor.office_temperature
```

You can also set `entity` directly on a column, or use row-level `toggle_entity`, `value_entity`, and `history_entity`.

## Development

Run the syntax check:

```bash
npm run check
```
