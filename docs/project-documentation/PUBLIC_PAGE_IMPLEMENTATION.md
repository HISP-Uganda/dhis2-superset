# Implementation Summary: Public Dashboard Features

## Overview
This document summarizes the implementation of the following features:
1. 'Categories' Label Change (DASHBOARDS → Categories)
2. Dashboard `display_order` Field for Public Page Ordering
3. Dynamic and Configurable Public Page Layout

---

## 1. 'Categories' Label Change

### Files Changed:
- `superset-frontend/src/features/home/DataSourceSidebar.tsx`

### Implementation:
The sidebar label was changed from "Dashboards" to "Categories" in both the loading and display states:
```tsx
<SidebarTitle>{t('Categories')}</SidebarTitle>
```

---

## 2. Dashboard `display_order` Field

### Backend Changes:

#### Model (`superset/models/dashboard.py`):
```python
display_order = Column(Integer, nullable=True)  # Order for public dashboard list
```

#### API (`superset/dashboards/api.py`):
- Added `display_order` to `list_columns`, `add_columns`, and `order_columns`
- Updated public dashboards endpoint to sort by `display_order`:
```python
dashboards = (
    db.session.query(Dashboard)
    .filter(Dashboard.published == True)
    .order_by(Dashboard.display_order.asc().nullslast(), Dashboard.id.asc())
    .all()
)
```

#### Schema (`superset/dashboards/schemas.py`):
- Added `display_order` field to `DashboardPostSchema`, `DashboardPutSchema`, and `DashboardGetResponseSchema`

#### Migration (`superset/migrations/versions/2025-12-15_10-00_add_display_order_to_dashboards.py`):
```python
def column_exists(table_name: str, column_name: str) -> bool:
    """Check if a column exists in a table."""
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = [col["name"] for col in inspector.get_columns(table_name)]
    return column_name in columns

def upgrade():
    # Only add column if it doesn't already exist
    if not column_exists("dashboards", "display_order"):
        op.add_column("dashboards", sa.Column("display_order", sa.Integer(), nullable=True))
```

### Frontend Changes:

#### BasicInfoSection (`superset-frontend/src/dashboard/components/PropertiesModal/sections/BasicInfoSection.tsx`):
Added UI field for display_order:
```tsx
<ModalFormField
  label={t('Display Order (for public list)')}
  testId="dashboard-display-order-field"
  bottomSpacing={false}
>
  <FormItem name="displayOrder" noStyle>
    <InputNumber
      placeholder={t('Lower numbers appear first (e.g., 1, 2, 3...)')}
      data-test="dashboard-display-order-input"
      min={1}
      style={{ width: '100%' }}
    />
  </FormItem>
</ModalFormField>
```

#### PropertiesModal (`superset-frontend/src/dashboard/components/PropertiesModal/index.tsx`):
- Added `displayOrder` to form data handling
- Added `display_order` to API save payload

---

## 3. Dynamic and Configurable Public Page Layout

### New Files Created:

#### Configuration Types (`superset-frontend/src/pages/PublicLandingPage/config.ts`):
Defines TypeScript interfaces for all configurable options:
- `PublicPageNavbarConfig`: Logo, title, login button, custom links
- `PublicPageSidebarConfig`: Width, position, title, mobile settings
- `PublicPageContentConfig`: Background, welcome message
- `PublicPageFooterConfig`: Footer text, links

#### Config Hook (`superset-frontend/src/pages/PublicLandingPage/usePublicPageConfig.ts`):
Fetches configuration from backend API with fallback to defaults.

#### Configurable Sidebar (`superset-frontend/src/pages/PublicLandingPage/ConfigurableSidebar.tsx`):
A sidebar component that respects configuration settings.

#### Backend API (`superset/public_page/api.py`):
New API endpoint at `/api/v1/public_page/config` that serves the configuration.

### Updated Files:

#### PublicLandingPage (`superset-frontend/src/pages/PublicLandingPage/index.tsx`):
Completely refactored to use configurable components with styled-components that accept configuration props.

#### Initialization (`superset/initialization/__init__.py`):
Added `PublicPageRestApi` registration.

#### Config (`docker/pythonpath_dev/superset_config.py`):
Added example `PUBLIC_PAGE_CONFIG` setting.

---

## Configuration Example

Add this to your `superset_config.py` to customize the public page:

```python
PUBLIC_PAGE_CONFIG = {
    "navbar": {
        "enabled": True,
        "height": 60,
        "backgroundColor": "#ffffff",
        "boxShadow": "0 2px 8px rgba(0, 0, 0, 0.1)",
        "logo": {
            "enabled": True,
            "alt": "Organization Logo",
            "height": 40,
        },
        "title": {
            "enabled": True,
            "text": "Data Dashboard",
            "fontSize": "18px",
            "fontWeight": 700,
            "color": "#1890ff",
        },
        "loginButton": {
            "enabled": True,
            "text": "Login",
            "url": "/login/",
            "type": "primary",
        },
        "customLinks": [
            {"text": "Help", "url": "/help/", "external": False},
        ],
    },
    "sidebar": {
        "enabled": True,
        "width": 280,
        "position": "left",  # or "right"
        "backgroundColor": "#ffffff",
        "borderStyle": "1px solid #f0f0f0",
        "title": "Categories",
        "collapsibleOnMobile": True,
        "mobileBreakpoint": 768,
    },
    "content": {
        "backgroundColor": "#f5f5f5",
        "padding": "0",
        "showWelcomeMessage": True,
        "welcomeTitle": "Welcome",
        "welcomeDescription": "Select a category from the sidebar to view dashboards.",
    },
    "footer": {
        "enabled": True,
        "height": 50,
        "backgroundColor": "#fafafa",
        "text": "© 2025 Your Organization",
        "textColor": "#666666",
        "links": [
            {"text": "Privacy", "url": "/privacy/"},
            {"text": "Terms", "url": "/terms/"},
        ],
    },
}
```

---

## Usage

### Setting Dashboard Display Order:
1. Open a dashboard
2. Click the three-dot menu → Properties
3. In the "General information" section, set the "Display Order (for public list)" value
4. Lower numbers appear first (e.g., 1, 2, 3...)
5. Dashboards without a display_order value appear last

### Customizing Public Page Layout:
1. Edit `superset_config.py`
2. Add or modify the `PUBLIC_PAGE_CONFIG` dictionary
3. Restart Superset

---

## Database Migration

Run the migration to add the `display_order` column:
```bash
superset db upgrade
```

Or manually:
```sql
ALTER TABLE dashboards ADD COLUMN display_order INTEGER;
```

