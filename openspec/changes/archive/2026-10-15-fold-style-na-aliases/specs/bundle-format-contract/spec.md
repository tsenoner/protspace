## ADDED Requirements

### Requirement: A style for N/A reaches the web's N/A category

`protspace style` SHALL store every style that names a value the web reads as missing under the
web's N/A key, `__NA__`, whatever spelling the data or the styles file uses. This covers colours,
shapes, `pinnedValues` and `hiddenValues`. The settings it writes SHALL hold at most one N/A
category, and a newly given N/A style SHALL replace a stored one.

#### Scenario: Missing cells spelled in a way the old alias list missed

- **WHEN** a column's missing cells are spelled `N/A` and the styles file colours `N/A`
- **THEN** the settings hold that colour under `__NA__` and no `N/A` category

#### Scenario: Restyling N/A

- **WHEN** a bundle's settings already colour `__NA__` and `protspace style` is given a new N/A
  colour under any N/A spelling
- **THEN** the written settings hold the new colour under `__NA__`

#### Scenario: Hiding or pinning N/A by its spelling

- **WHEN** `hiddenValues` or `pinnedValues` name N/A as `N/A`, `""` or `none`
- **THEN** the written settings name it `__NA__`, once
