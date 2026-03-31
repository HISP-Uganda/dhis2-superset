# PHASE 1: Summary Chart Implementation Plan

This document outlines the implementation plan for a new **Summary** chart type in Apache Superset. The plan is based on an analysis of the existing chart plugin architecture and is designed to deliver a production-ready, configurable, and theme-aware component.

## 1. Current Superset Chart Plugin Architecture

Superset's frontend is a monorepo containing multiple packages. Chart plugins are either included as local plugins within the `superset-frontend` package or as separate packages under the `@superset-ui` scope.

Based on the analysis of `superset-frontend/src/visualizations/presets/MainPreset.js`, chart plugins follow a standard registration pattern. A central `MainPreset` class imports and instantiates plugins.

A typical chart plugin consists of the following key files:

-   **`index.ts`**: The entry point for the plugin. It exports a `ChartPlugin` class, which defines the plugin's metadata (e.g., `name`, `description`, `icon`) and registers the control panel configuration and rendering component.
-   **`control.ts`**: (Often named `control.ts` or similar) Defines the chart's control panel UI using Superset's control-panel library. It's composed of sections and individual controls (e.g., for selecting metrics, colors, and layout options).
-   **`transformProps.ts`**: A crucial function that takes the raw data from Superset's query engine and the user's control panel settings, then transforms them into a structured props object that the rendering component can easily consume.
-   **`Component.tsx`**: (e.g., `Summary.tsx`) The React component that visually renders the chart using the transformed props. It's responsible for all the UI, styling, and layout.
-   **`types.ts`**: Contains TypeScript type definitions for the plugin's props, data structures, and control settings, ensuring type safety.
-   **Styling**: Styling is typically handled using Emotion (`@emotion/styled`), which allows for creating styled components that can access Superset's theme for consistent look and feel.

Plugins are registered in `MainPreset.js` by instantiating them and assigning a unique `key`.

## 2. How the Summary Chart Will Fit In

The Summary chart will be implemented as a **local plugin**, following the pattern of existing plugins like `TimeTable` and `DHIS2Map`. This approach is clean, self-contained, and avoids the complexity of creating a new `@superset-ui` package.

A new directory will be created: `superset-frontend/src/visualizations/Summary`.

This directory will contain:

-   `index.ts`: To define and register the `SummaryChartPlugin`.
-   `Summary.tsx`: The main React rendering component.
-   `control.ts`: To define the extensive control panel.
-   `transformProps.ts`: To handle the complex data mapping.
-   `types.ts`: For all related TypeScript types.
-   `components/`: A subdirectory for breaking down the rendering logic (e.g., `SummaryItem.tsx`, `MicroBar.tsx`).
-   `styles.ts`: For Emotion-based styled components.

The new plugin will be registered in `superset-frontend/src/visualizations/presets/MainPreset.js` by adding:

```javascript
import SummaryChartPlugin from '../Summary';
// ... in the plugins array:
new SummaryChartPlugin().configure({ key: 'summary' }),
```

## 3. Control Panel Sections and Config Options

The control panel will be organized into logical sections for a clear user experience.

#### **1. Data**

-   **Metrics**: `MetricsControl` to select multiple value columns.
-   **Label Source**: `SelectControl` to choose between using metric names as labels or a dedicated column (`ColumnSelectControl`).
-   **Group By**: `GroupByControl` for grouping data.
-   **Secondary Metrics**: `MetricsControl` for optional secondary values.
-   **Trend/Change Metrics**: `MetricsControl` to select columns for increase/decrease values.
-   **Sparkline Data**: `MetricsControl` to select the time-series data for sparklines.
-   **Sorting**: `SelectControl` for sorting items.

#### **2. Layout**

-   **Layout Mode**: `SelectControl` with options: `Vertical List`, `Horizontal Row`, `Grid`, `Split Summary`, `Micro Card`.
-   **Grid Columns**: `SelectControl` for `2`, `3`, or `4` columns (visible only in Grid mode).
-   **Value Position**: `SelectControl` (`Right of Label`, `Left of Label`, `Below Label`, `Above Label`).
-   **Label Position**: `SelectControl` (similar options).
-   **Visual Density**: `SelectControl` with options: `Micro`, `Compact`, `Standard`, `Comfortable`.
-   **Dividers**: `CheckboxControl` to show/hide dividers between items.

#### **3. Typography**

-   **Label Font Size**: `FontSizeControl`.
-   **Value Font Size**: `FontSizeControl`.
-   **Secondary Text Font Size**: `FontSizeControl`.
-   **Font Weight**: `SelectControl` for `Normal`, `Bold`.

#### **4. Formatting**

-   **Number Format**: `D3FormatControl` for primary values.
-   **Secondary Value Format**: `D3FormatControl`.
-   **Null Display Text**: `TextControl`.

#### **5. Trend & Indicators**

-   **Trend Display Mode**: `SelectControl` (`Absolute Change`, `Percentage Change`, `Arrow Only`).
-   **Positive/Negative Logic**: `SelectControl` (`Higher is Better`, `Lower is Better`).
-   **Thresholds**: A `CollectionControl` to define multiple thresholds with associated colors.

#### **6. Styling**

-   **Color Scheme**: `ColorSchemeControl`.
-   **Value Color**: `ColorPickerControl`.
-   **Label Color**: `ColorPickerControl`.
-   **Background Color**: `ColorPickerControl`.
-   **Border Radius**: `SliderControl`.
-   **Borders**: `SelectControl` to configure border width and style.

#### **7. Micro Visualizations**

-   **Visualization Type**: `SelectControl` (`None`, `Sparkline`, `Mini Bar`, `Mini Progress Bar`).
-   **Chart Position**: `SelectControl` (`Left`, `Right`, `Below`).
-   **Chart Color**: `ColorPickerControl`.

## 4. Rendering & Layout Approach

The main `Summary.tsx` component will receive the transformed props. It will map over an array of `summaryItems` and render a `SummaryItem.tsx` component for each.

-   **Layout**: CSS Flexbox and CSS Grid will be used to implement the different layout modes. A `switch` statement or object lookup based on the `layoutMode` prop will determine the container's styling.
-   **Responsiveness**: Media queries will be used to adjust the layout on smaller screens (e.g., collapsing grid columns).
-   **Components**: The rendering will be modular:
    -   `SummaryItem.tsx`: Renders a single indicator.
    -   `Value.tsx`: Renders the formatted value.
    -   `Label.tsx`: Renders the label.
    -   `TrendIndicator.tsx`: Renders the delta arrow and change value.
    -   `MicroVisualization.tsx`: A wrapper that renders the selected micro-chart.

## 5. Styling & Theme Integration Approach

-   **Emotion**: All styling will be done using `@emotion/styled`.
-   **Theme Tokens**: Components will exclusively use theme tokens from `props.theme` for colors, fonts, spacing, and borders. This ensures the chart automatically adapts to the active Superset theme and maintains a consistent look. For example, `color: ${props.theme.colors.grayscale.dark1}`.
-   **No Hardcoded Styles**: No hardcoded pixel values for fonts or spacing; theme-based units will be preferred.

## 6. Compact-Density Variants

A `density` prop (from the control panel) will drive the spacing. A utility function will return padding, margin, and font-size values based on the selected density.

```typescript
// Example in styles.ts
const getDensityStyles = (density: string) => {
  switch (density) {
    case 'micro': return { padding: '2px', fontSize: '10px' };
    case 'compact': return { padding: '4px', fontSize: '12px' };
    // ... etc.
  }
};
```

## 7. Risks and Compatibility Concerns

-   **Data Transformation Complexity**: The `transformProps.ts` will be the most complex part, as it needs to handle various data shapes (pivoted, grouped, single row). This logic must be robust and well-tested.
-   **Performance**: Rendering a large number of items, especially with sparklines, could impact performance. The rendering should be optimized, and virtualization could be considered for very large lists (though unlikely to be necessary for this chart type).
-   **Control Panel UX**: The high degree of configurability can lead to a cluttered control panel. The sections will need to be well-organized, with advanced options potentially hidden by default.
-   **MainPreset.js Modification**: Editing `MainPreset.js` is a regression-sensitive operation. Care must be taken to not disrupt other plugins.

## 8. Files/Modules to be Added or Modified

#### **New Files/Directories**

-   `superset-frontend/src/visualizations/Summary/`
-   `superset-frontend/src/visualizations/Summary/index.ts`
-   `superset-frontend/src/visualizations/Summary/Summary.tsx`
-   `superset-frontend/src/visualizations/Summary/control.ts`
-   `superset-frontend/src/visualizations/Summary/transformProps.ts`
-   `superset-frontend/src/visualizations/Summary/types.ts`
-   `superset-frontend/src/visualizations/Summary/styles.ts`
-   `superset-frontend/src/visualizations/Summary/components/SummaryItem.tsx`
-   `superset-frontend/src/visualizations/Summary/components/TrendIndicator.tsx`
-   `superset-frontend/src/visualizations/Summary/components/MicroVisualization.tsx`

#### **Modified Files**

-   `superset-frontend/src/visualizations/presets/MainPreset.js`: To add and register the new `SummaryChartPlugin`.

## 9. Regression-Sensitive Areas

-   **Plugin Registration**: Incorrectly modifying `MainPreset.js` could disable all other chart types.
-   **Dashboard Rendering**: The new chart must not interfere with the dashboard's grid rendering or lifecycle methods.
-   **Theming**: The chart must not introduce global style overrides that could affect other parts of the application.

## 10. Acceptance Criteria

1.  It appears as a normal chart type in Superset.
2.  Users can create it through standard Explore/chart workflows.
3.  It can display multiple indicators and values in one chart block.
4.  It supports vertical, horizontal, and grid-like summary layouts.
5.  It supports value position configuration: below, above, left, right, inline.
6.  It supports trend/increase/decrease states.
7.  It supports optional micro visuals.
8.  It supports compact density without wasted space.
9.  It respects theme styling automatically.
10. It does not break standard Superset behavior.

This plan provides a clear path forward for implementing the Summary chart. Upon approval, I will proceed with PHASE 2: Implementation.
