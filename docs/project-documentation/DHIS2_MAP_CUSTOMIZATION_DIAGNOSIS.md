# DHIS2 Map Customization Diagnosis

This document analyzes why DHIS2 Map **side panel customizations** (Map Configuration, Labels, Legend, Tooltip, Border Colors, etc.) may not be fully reflected in the current Superset integration, and outlines how to make them work.

## 1. Current Behavior

You confirmed that:
- The DHIS2 Map **renders correctly** (Uganda outline, regions/districts visible).
- However, **side panel customizations** such as:
  - Organisation Unit Column
  - Metric to Display
  - Aggregation Method
  - Time Period Column
  - Boundary Levels / Boundary Load Method
  - Level X Border Color (e.g. `#DC3545`)
  - Show Labels / Label Content / Label Font Size
  - Show Legend / Legend Position / Legend Type / Number of Classes / Reverse Color Scheme / No Data Color
  - Tooltip options

  do **not consistently change the visual output** when modified.

This indicates that the **control panel UI is wired**, but some options are not fully propagated into:

1. `transformProps` (superset → plugin props mapping), and/or
2. `DHIS2Map.tsx` rendering logic (Leaflet styles, label layers, legend component, tooltip content).

---

## 2. Architecture Recap (Where Customizations Should Flow)

1. **Control Panel (`controlPanel.ts`)**
   - Defines the controls and their field names in `formData`:
     - `org_unit_column`, `metric`, `aggregation_method`, `time_period_column`,
     - `boundary_levels`, `boundary_load_method`,
     - `show_labels`, `label_content`, `label_font_size`,
     - `show_legend`, `legend_position`, `legend_type`, `number_of_classes`, `reverse_color_scheme`, `no_data_color`,
     - Tooltip-related flags/content.

2. **transformProps (`transformProps.ts`)**
   - Receives `formData` (with all these fields) + query data from Superset.
   - Responsible for:
     - Resolving **actual column names** for org unit and metric (you already enhanced this).
     - Translating control values into **strongly typed props** for the React map component (e.g. `showLabels: boolean`, `noDataColor: string`, `levelBorderColors: {...}`).

3. **React Map (`DHIS2Map.tsx` + components)**
   - Uses props from `transformProps` to:
     - Build color scales (`getColorScale`) using legend config.
     - Compute feature styles (fill color, border color, no-data color, opacity).
     - Render label layers based on `showLabels`, `labelContent`, `labelFontSize`.
     - Render legend via `LegendPanel` (position, type, number of classes).
     - Configure tooltip content using tooltip settings.

If any customization works in the **control panel** but not on the map, it usually means one of:
- The control value is not being passed through `transformProps`.
- The prop is present but not **used** in the style/label/legend/tooltip logic.
- The value is overridden by fallback logic (e.g. hardcoded border colors) after being set.

---

## 3. Likely Gaps for Each Customization Group

Based on the existing documentation and code summaries, here is where things can be missing or miswired.

### 3.1 Map Configuration (Org Unit Column, Metric, Aggregation, Time Period)

- **Org Unit Column / Metric**:
  - `transformProps.ts` already has robust detection (see `DHIS2_MAP_FIXES_SUMMARY.md`).
  - These are largely working because the map now shows data for some regions/districts.

- **Aggregation Method**:
  - The control panel exposes options like `SUM`, `AVG`, etc.
  - However, unless `buildQuery.ts` and/or the DHIS2 dialect translates this into an actual **aggregation in the DHIS2 analytics query**, changing this control will not alter the data.
  - Check:
    - `superset-frontend/src/visualizations/DHIS2Map/buildQuery.ts`: does it read `formData.aggregation_method` and modify the query (e.g. choose between aggregated vs raw metrics)?
    - If not, aggregation is a **no-op** in the current implementation.

- **Time Period Column**:
  - Control may exist, but unless `buildQuery.ts` uses it to construct DHIS2 period dimensions, it will not affect the result.
  - Also, `transformProps.ts` needs to pass resolved period information if labels/tooltip reference it.

**Conclusion:** Map configuration basics mostly work for org unit and metric; aggregation method and time period likely need stronger wiring to `buildQuery.ts` and DHIS2 analytics parameters.

### 3.2 Boundary Levels and Boundary Load Method

- These are **now working**:
  - `boundary_levels` is normalized by `transformProps.ts` and passed as `boundaryLevels`.
  - `boundary_load_method` is passed as `boundaryLoadMethod` and honored in `DHIS2Map.tsx` when calling `loadDHIS2GeoFeatures`.
  - Changing levels refetches boundaries (per fixes doc).

So boundary-related controls are mostly **correctly wired**.

### 3.3 Level Border Colors & Default Border Color

Symptoms you described:
- Setting **Level 2 Border Color** (e.g. `#DC3545`) does not visibly change the region borders on the map.

Possible reasons:

1. `controlPanel.ts` defines level border color controls, but the values are not correctly mapped into a structured object (e.g. `levelBorderColors: { [level]: { color, width } }`) in `transformProps.ts`.

2. `DHIS2Map.tsx` `getFeatureStyle` may:
   - Use a **hardcoded stroke color** or fallback border color, ignoring `levelBorderColors`.
   - Or apply `strokeColor` from props but never assign it based on per-level controls.

3. When multiple levels are present, the legend/level border styles may be calculated, but for a **single level** (e.g. only Level 2) the plugin might be using just a default border color instead of the per-level configuration.

**What to check in code:**

- In `transformProps.ts`:
  - Look for logic that constructs `levelBorderColors` from `formData.level_border_colors` and per-level overrides (e.g. `level_2_border_color`).
  - Confirm that for Level 2 only, `levelBorderColors[2]` is set to `#DC3545` as you expect.

- In `DHIS2Map.tsx`:
  - In `getFeatureStyle(feature)` or equivalent style function, ensure:
    - It looks up the feature's level (e.g. `feature.properties.level`).
    - It checks `levelBorderColors[level]` and uses its `color` and `width` for the `stroke` / `weight` properties passed to Leaflet.

If the per-level lookup is missing or overridden by defaults, border color changes from the side panel will not propagate to the map.

### 3.4 Labels (Show Labels, Content, Font Size)

- **Controls:**
  - `show_labels`, `label_content`, `label_font_size` likely exist in `controlPanel.ts`.

- **transformProps:**
  - Needs to pass these as boolean/string/number props to `DHIS2Map.tsx`.

- **Map rendering:**
  - `DHIS2Map.tsx` (or a dedicated `Labels` component) must:
    - Conditionally create a label layer (e.g. Leaflet `L.marker` or `L.divIcon`) when `showLabels` is true.
    - Use `labelContent` to decide label text (e.g., boundary name, metric value, period).
    - Apply `labelFontSize` via CSS/HTML in the `divIcon`, or via Leaflet's style options.

If labels are not appearing or do not change when you toggle these controls, it likely means:
- `showLabels` / `labelContent` / `labelFontSize` are not fully wired from `formData` → props → rendering.
- Or labels rendering is disabled in this Superset integration (compared to the standalone DHIS2Map that has full label support).

### 3.5 Legend (Show Legend, Position, Type, Number of Classes, Reverse Color Scheme, No Data Color)

- **Legend visibility & position:**
  - `LegendPanel.tsx` must receive `showLegend`, `legendPosition` props and render/hide accordingly.
  - If `LegendPanel` is always rendered with defaults, UI changes will not reflect.

- **Number of classes & reverse color scheme:**
  - These should feed into the `getColorScale` call in `utils.ts`:
    - `classes` parameter ← number of classes.
    - `reverseColors` parameter ← reverse setting.
  - If `transformProps.ts` sends static `classes` and `reverseColors` defaults, changes in the UI will not affect the color scale.

- **No Data Color:**
  - Expected to be used in `getFeatureStyle` when a feature has **no value** (no data or filtered out):

    ```ts
    const fillColor = hasData ? colorScale(value) : noDataColor;
    const fillOpacity = hasData ? opacity : noDataOpacity;
    ```

  - Currently, your `getFeatureStyle` sets a grey color and adjusts opacity for no-data. If it does not read `noDataColor` from props, the side panel setting will not apply.

### 3.6 Tooltip

- Tooltips require:
  - Control panel fields describing what to show (value, name, period, etc.).
  - `transformProps.ts` to pass tooltip configuration.
  - `DHIS2Map.tsx` to bind an `onEachFeature` handler that sets `layer.bindTooltip(...)` using the configured content.

If the tooltip content never changes regardless of control settings, the tooltip configuration is not flowing through.

---

## 4. Why the Customizations Are Not Applying (Summary)

From the code and documents you have:

1. The **core wiring for data & boundaries is fixed**: level selection, geometry normalization, data mapping.
2. Many **styling and UI controls** are defined and partially used in the standalone DHIS2Map repo, but in your Superset integration:
   - Some controls are not fully passed through `transformProps`.
   - Some props are passed but not used in the active `DHIS2Map.tsx` style/label/legend/tooltip logic.
   - Certain values (like Level 2 border color, no-data color, legend classes) may still use **static defaults** or auto-generated values and ignore the formData overrides.

Therefore, the map shows and data maps correctly, but **styling customizations appear “stuck”**.

---

## 5. How to Make Customizations Work

Here is the concrete approach to get the side panel controls applying correctly:

### Step 1: Audit `controlPanel.ts` → `transformProps.ts` Mapping

- For each control you care about (org unit column, metric, aggregation method, time period column, boundary levels, boundary load method, label options, legend options, border colors, tooltip options):
  1. Confirm the field name in `controlPanel.ts` (e.g. `boundary_load_method`, `no_data_color`).
  2. Ensure `transformProps.ts` reads `formData.<field_name>` and includes it in the returned props object with a clear name (e.g. `boundaryLoadMethod`, `noDataColor`).

- Add debug logging in `transformProps.ts` to log the resolved props for at least:
  - `boundaryLevels`, `boundaryLoadMethod`.
  - `showLabels`, `labelContent`, `labelFontSize`.
  - `showLegend`, `legendPosition`, `legendType`, `numClasses`, `reverseColors`, `noDataColor`.
  - `levelBorderColors` and `defaultBorderColor`.

### Step 2: Wire Props into `DHIS2Map.tsx` Behavior

- In `DHIS2Map.tsx`, confirm that you:

  1. **Color Scale & Legend**
     - Call `getColorScale(schemeName, min, max, classes, reverseColors, schemeType, manualBreaks, manualColors)` using:
       - `classes` from the legend control.
       - `reverseColors` from the control.
     - Pass legend-related props into `LegendPanel` so it renders in the desired position/type and reflects the same classes and color scheme.

  2. **Border Colors**
     - In `getFeatureStyle(feature)`:
       - Derive feature level from its properties.
       - Use `levelBorderColors[level]?.color` (or fallback to `defaultBorderColor`) as `strokeColor`.
       - Use `levelBorderColors[level]?.width` (or default width) as `weight` (border thickness).
     - Ensure no later override resets `stroke` / `weight` to a hardcoded value.

  3. **No-Data Color**
     - When `feature` has no mapped data value:
       - Set `fillColor = noDataColor` from props, not a hardcoded grey.
       - Keep increased opacity so boundaries remain visible.

  4. **Labels**
     - If `showLabels` is true, render label markers/overlays:
       - Use `labelContent` to decide the string (e.g. boundary name or name+value).
       - Apply `labelFontSize` to the label style.
       - Hide or remove labels when `showLabels` is false.

  5. **Tooltip**
     - Configure `onEachFeature` to `bindTooltip` using tooltip settings from props (which columns to show, formatting, etc.).

### Step 3: Test Each Control Group

1. **Boundary Levels & Border Colors**
   - Set Level 2 border color to a strong color (e.g. `#DC3545`) and width > 2.
   - With only Level 2 selected, verify border color/width clearly change.

2. **Legend**
   - Change number of classes from 5 → 7 and toggle “Reverse Color Scheme”.
   - Confirm that:
     - Legend swatches count changes.
     - Map colors invert when reversed.

3. **Labels / Tooltip**
   - Toggle “Show Labels” on/off.
   - Change Label Content and Font Size.
   - Confirm labels appear/disappear and text/style updates.
   - Update tooltip settings and confirm tooltip content changes on hover.

4. **Data Mapping**
   - Keep using the testing steps from `DHIS2_MAP_FIXES_SUMMARY.md` to ensure data → boundary mapping still works.

---

## 6. Next Actions

1. Implement missing mappings in `transformProps.ts` from control panel fields to props.
2. Adjust `DHIS2Map.tsx` to truly consume:
   - `levelBorderColors`, `defaultBorderColor`, `noDataColor`.
   - Legend configuration (`classes`, `reverseColors`, `legendType`, `legendPosition`).
   - Label and tooltip configuration.
3. Re-run the tests in `DHIS2_MAP_FIXES_SUMMARY.md` plus the additional style tests above.

Once these steps are complete, the DHIS2 Map should not only show correct **boundaries and data**, but also **fully reflect** all the side panel customizations (border colors, labels, legend, etc.) as designed.
