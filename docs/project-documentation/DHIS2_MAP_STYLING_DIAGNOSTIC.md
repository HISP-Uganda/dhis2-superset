# DHIS2 Map Styling Diagnostic Guide

## Problem
Superset style options (color schemes, opacity, borders) are not applying to DHIS2 Maps.

---

## Diagnostic Steps

### Step 1: Check Browser Console

Open DevTools Console (F12) and look for these messages:

#### Expected Console Output

```javascript
[DHIS2Map] Component rendered with props: {
  colorScheme: "supersetColors",
  linearColorScheme: "schemeBlues",
  useLinearColorScheme: true,
  opacity: 0.7,
  strokeColor: {r: 255, g: 255, b: 255, a: 1},
  strokeWidth: 1,
  ...
}

[getColorScale] schemeName=schemeBlues, schemeType=sequential, classes=5, range=[0, 1000]
```

#### What to Check

1. **Are props being received?**
   - Look for `[DHIS2Map] Component rendered with props`
   - Check if `colorScheme`, `linearColorScheme`, `opacity`, etc. are present
   - Check their values

2. **Is color scale being created?**
   - Look for `[getColorScale]` messages
   - Check if the correct scheme name is used
   - Check if min/max values are correct

3. **Are styles being applied?**
   - Look for `[DynamicGeoJSON] Updating layer styles`
   - This indicates style updates are being triggered

### Step 2: Check Chart Configuration

1. Go to your dashboard
2. Click **Edit Chart** on the DHIS2 Map
3. Go to **Customize** tab
4. Check **Map Style** section:

**Check these settings:**
- ✅ **Color Scheme:** Should show available schemes (e.g., "Superset Colors")
- ✅ **Sequential Color Scheme:** Should show gradient options (e.g., "Blues", "Greens")
- ✅ **Use Sequential Colors:** Checkbox (checked = gradient, unchecked = categorical)
- ✅ **Fill Opacity:** Slider (0-1)
- ✅ **Border Color:** Color picker
- ✅ **Border Width:** Number input
- ✅ **Auto Theme Borders:** Checkbox

### Step 3: Test Style Changes

Try changing each setting and observe:

1. **Change Color Scheme:**
   - Uncheck "Use Sequential Colors"
   - Select different "Color Scheme" (e.g., "Pastel1", "Set3")
   - Click **Update Chart**
   - **Expected:** Map colors should change

2. **Change Sequential Scheme:**
   - Check "Use Sequential Colors"
   - Select different "Sequential Color Scheme" (e.g., "Blues", "Greens", "Reds")
   - Click **Update Chart**
   - **Expected:** Map should use gradient from that scheme

3. **Change Opacity:**
   - Move "Fill Opacity" slider (e.g., from 0.7 to 0.3)
   - Click **Update Chart**
   - **Expected:** Map regions should become more transparent

4. **Change Border:**
   - Change "Border Color" to red
   - Change "Border Width" to 3
   - Click **Update Chart**
   - **Expected:** Borders should be thicker and red

---

## Common Issues and Fixes

### Issue 1: Styles Not Applied at All

**Symptoms:**
- Map always shows same colors regardless of settings
- Console shows props but styles don't change

**Possible Causes:**
1. Props not being passed to styling function
2. StyleKey not updating to trigger re-render
3. GeoJSON layer not re-applying styles

**Fix:**
Check lines 1040-1045 in DHIS2Map.tsx:
```typescript
// Determine which color scheme to use
const activeColorScheme = useMemo(() => {
  if (useLinearColorScheme) {
    return linearColorScheme || 'schemeBlues';
  }
  return colorScheme || 'supersetColors';
}, [useLinearColorScheme, linearColorScheme, colorScheme]);
```

**Verify:**
- Console shows correct `activeColorScheme`
- `useLinearColorScheme` boolean is correct

### Issue 2: Color Scale Not Created

**Symptoms:**
- Console shows `[getColorScale]` with undefined schemeName
- Map shows grey/default colors

**Possible Cause:**
Color scheme name not being passed correctly

**Fix:**
Check line 1047-1060 in DHIS2Map.tsx:
```typescript
const colorScale = useMemo(
  () =>
    getColorScale(
      activeColorScheme,  // Should be scheme name
      min,
      max,
      legendClasses,
      legendReverseColors,
      useLinearColorScheme ? 'sequential' : 'categorical',
      legendType === 'manual' && manualBreaks ? manualBreaks : undefined,
      legendType === 'manual' && manualColors ? manualColors : undefined,
    ),
  [activeColorScheme, min, max, legendClasses, ...],
);
```

**Verify:**
- `activeColorScheme` has a valid value
- `min` and `max` are numbers (not undefined)

### Issue 3: Styles Applied But Not Visible

**Symptoms:**
- Console shows styles being applied
- But map looks the same

**Possible Causes:**
1. Opacity too low (map nearly transparent)
2. Border color same as fill color
3. Data values all the same (no variation in colors)

**Fix:**
1. **Check opacity:** Set to 0.7-0.9 for visibility
2. **Check data values:** Ensure your metric has variation
3. **Check legend:** Values should show different color buckets

### Issue 4: StyleKey Not Updating

**Symptoms:**
- Props change but map doesn't re-render
- No `[DynamicGeoJSON] Updating layer styles` messages

**Cause:**
StyleKey memo not detecting changes

**Fix:**
Check line 1647-1669 in DHIS2Map.tsx:
```typescript
const styleKey = useMemo(() => {
  return JSON.stringify({
    colorScheme: activeColorScheme,
    opacity,
    strokeColor,
    strokeWidth,
    autoThemeBorders,
    legendReverseColors,
    min,
    max,
    legendClasses,
    // ... all style-related props
  });
}, [activeColorScheme, opacity, strokeColor, ...]);
```

**Verify:**
- All style props are in the dependency array
- StyleKey changes when any style prop changes

---

## Debug Code Additions

If styles still don't apply, add these console logs:

### In DHIS2Map.tsx (around line 1590)

```typescript
const getFeatureStyle = useCallback(
  (feature: BoundaryFeature) => {
    const value = getFeatureValue(feature);
    const fillColor = value !== undefined ? colorScale(value) : noDataColorRgb;

    // ADD THIS DEBUG LOG
    console.log('[getFeatureStyle]', {
      featureId: feature.id,
      featureName: feature.properties.name,
      value,
      fillColor,
      opacity,
      strokeColor,
      strokeWidth,
    });

    return {
      color: borderColor,
      weight: borderWidth,
      fillColor,
      fillOpacity: fillOpacityValue,
    };
  },
  [getFeatureValue, colorScale, opacity, strokeColor, strokeWidth, ...],
);
```

This will show:
- What color is being assigned to each region
- What opacity/stroke values are being used
- If values are being found for features

---

## Testing Checklist

- [ ] Console shows `[DHIS2Map] Component rendered` with correct props
- [ ] Console shows `[getColorScale]` with correct scheme name
- [ ] Changing color scheme updates the map
- [ ] Changing opacity makes map more/less transparent
- [ ] Changing border color/width changes boundaries
- [ ] Legend shows color scale correctly
- [ ] Data regions have different colors (if data varies)
- [ ] No-data regions show grey color

---

## Next Steps

If all checks pass but styles still don't apply:

1. **Share Console Output:**
   ```
   [DHIS2Map] Component rendered with props: {...}
   [getColorScale] ...
   [getFeatureStyle] ...
   ```

2. **Share Chart Configuration:**
   - Screenshot of Map Style section
   - Current values of all style controls

3. **Check Network Tab:**
   - Verify GeoJSON is being loaded
   - Check if data has values for the metric

4. **Try Simple Test:**
   - Create new DHIS2 Map chart
   - Select very simple data (one metric, few regions)
   - Apply bright red border (rgb(255, 0, 0))
   - Set opacity to 0.9
   - See if red borders appear

---

## Known Working Configuration

This configuration should definitely work:

```javascript
{
  useLinearColorScheme: true,
  linearColorScheme: "schemeBlues",
  opacity: 0.8,
  strokeColor: {r: 255, g: 255, b: 255, a: 1},  // White
  strokeWidth: 2,
  autoThemeBorders: false,
  legendClasses: 5,
  legendType: "auto",
}
```

**Result:** Should show blue gradient map with white borders.

If this doesn't work, there's a deeper integration issue that needs investigation.
