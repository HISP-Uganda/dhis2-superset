# Embedded SDK Implementation Plan

## Goal
Enable public access to dashboards with full filter functionality using Superset's Embedded SDK and Guest Tokens.

**Expected Outcome**: Users can view dashboards, apply filters, and see real-time chart updates WITHOUT logging in.

---

## Prerequisites Verification

### Step 0: Verify Environment
- [ ] Check Superset version (must be ≥ 2.1)
- [ ] Verify current feature flags in `superset_config.py`
- [ ] Check if `@superset-ui/embedded-sdk` is available for the Superset version

**Commands**:
```bash
# Check Superset version
superset version

# Check if embedded SDK package exists in node_modules
ls superset-frontend/node_modules/@superset-ui/embedded-sdk
```

---

## Phase 1: Backend Configuration

### Step 1: Enable Feature Flags
**File**: `superset/config.py` or `superset_config.py`

Add/update feature flags:
```python
FEATURE_FLAGS = {
    "EMBEDDED_SUPERSET": True,
    # ... other existing flags
}
```

### Step 2: Configure Guest Token Secret
**File**: `superset/config.py` or `superset_config.py`

Add JWT secret for guest tokens:
```python
# Strong secret for production - change this!
GUEST_TOKEN_JWT_SECRET = "your-strong-secret-key-here-change-in-production"
```

**Security Note**: Use a strong, random secret in production. Generate with:
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

### Step 3: Restart Superset Backend
```bash
# Stop current backend process
# Then restart with:
superset run -p 8088 --with-threads --reload --debugger
```

---

## Phase 2: Backend API - Guest Token Endpoint

### Step 4: Create Guest Token Generation Endpoint

**Option A: Python/Flask Endpoint (Recommended)**

**File**: Create `superset/security/guest_token_api.py`

```python
from flask import request, Response
from flask_appbuilder.api import BaseApi, expose
import jwt
import time
from superset import app

class GuestTokenApi(BaseApi):
    resource_name = "guest_token"

    @expose("/", methods=["POST"])
    def create_guest_token(self) -> Response:
        """Generate guest token for embedded dashboard access."""
        data = request.json
        dashboard_id = data.get("dashboard_id")

        if not dashboard_id:
            return self.response_400(message="dashboard_id is required")

        payload = {
            "user": {
                "username": "guest",
                "first_name": "Guest",
                "last_name": "User"
            },
            "resources": [{
                "type": "dashboard",
                "id": str(dashboard_id)
            }],
            "rls": [],  # Row-level security rules (empty for now)
            "exp": int(time.time()) + 3600  # Expire in 1 hour
        }

        token = jwt.encode(
            payload,
            app.config["GUEST_TOKEN_JWT_SECRET"],
            algorithm="HS256"
        )

        return self.response(200, token=token)
```

**File**: Register in `superset/initialization/__init__.py`

Find the API registration section and add:
```python
from superset.security.guest_token_api import GuestTokenApi

appbuilder.add_api(GuestTokenApi)
```

**Option B: Node.js/Express Endpoint (If separate backend)**

**File**: Create `backend/routes/guest-token.js`

```javascript
const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

const GUEST_TOKEN_JWT_SECRET = process.env.GUEST_TOKEN_JWT_SECRET;

router.post('/api/guest-token', (req, res) => {
  const { dashboard_id } = req.body;

  if (!dashboard_id) {
    return res.status(400).json({ error: 'dashboard_id is required' });
  }

  const payload = {
    user: {
      username: 'guest',
      first_name: 'Guest',
      last_name: 'User'
    },
    resources: [{
      type: 'dashboard',
      id: dashboard_id
    }],
    rls: [],
    exp: Math.floor(Date.now() / 1000) + 3600  // 1 hour
  };

  const token = jwt.sign(payload, GUEST_TOKEN_JWT_SECRET);

  res.json({ token });
});

module.exports = router;
```

### Step 5: Test Guest Token Endpoint

```bash
# Test token generation
curl -X POST http://localhost:8088/api/v1/guest_token/ \
  -H "Content-Type: application/json" \
  -d '{"dashboard_id": "your-dashboard-uuid"}'

# Should return: {"token": "eyJ0eXAiOiJKV1QiLCJhbGc..."}
```

---

## Phase 3: Frontend Setup

### Step 6: Install Embedded SDK

```bash
cd superset-frontend
npm install @superset-ui/embedded-sdk
```

### Step 7: Create Guest Token Fetch Utility

**File**: `superset-frontend/src/utils/guestToken.ts`

```typescript
import { SupersetClient } from '@superset-ui/core';

export async function fetchGuestToken(dashboardId: string): Promise<string> {
  try {
    const response = await SupersetClient.post({
      endpoint: '/api/v1/guest_token/',
      postPayload: { dashboard_id: dashboardId },
    });

    return response.json.token;
  } catch (error) {
    console.error('Failed to fetch guest token:', error);
    throw error;
  }
}
```

---

## Phase 4: Frontend Components

### Step 8: Create Embedded Dashboard Component

**File**: `superset-frontend/src/features/home/EmbeddedDashboard.tsx`

```typescript
import React, { useEffect, useRef, useState } from 'react';
import { embedDashboard } from '@superset-ui/embedded-sdk';
import { fetchGuestToken } from '../../utils/guestToken';

interface EmbeddedDashboardProps {
  dashboardId: string;
  filters?: Record<string, any>;
}

export default function EmbeddedDashboard({
  dashboardId,
  filters = {}
}: EmbeddedDashboardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const embed = async () => {
      try {
        const dashboard = await embedDashboard({
          id: dashboardId,
          supersetDomain: window.location.origin,
          mountPoint: containerRef.current!,
          fetchGuestToken: () => fetchGuestToken(dashboardId),
          dashboardUiConfig: {
            hideTitle: false,
            hideChartControls: false,
            hideTab: false,
            filters: {
              visible: true,
              expanded: true,
            },
          },
        });

        // Apply filters if provided
        if (Object.keys(filters).length > 0) {
          // Wait for dashboard to be ready
          setTimeout(() => {
            Object.entries(filters).forEach(([filterId, value]) => {
              dashboard.setFilterValue(filterId, value);
            });
          }, 1000);
        }

        setIsLoading(false);
      } catch (err) {
        console.error('Failed to embed dashboard:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setIsLoading(false);
      }
    };

    embed();
  }, [dashboardId, filters]);

  if (error) {
    return (
      <div style={{ padding: '20px', color: 'red' }}>
        Failed to load dashboard: {error}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        Loading dashboard...
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100vh' }}
    />
  );
}
```

### Step 9: Update Public Dashboard Page

**File**: `superset-frontend/src/features/home/DashboardContentArea.tsx`

Replace existing implementation with embedded SDK:

```typescript
import React from 'react';
import EmbeddedDashboard from './EmbeddedDashboard';

interface DashboardContentAreaProps {
  dashboardId: string;
  isPublic: boolean;
  filters?: Record<string, any>;
}

export default function DashboardContentArea({
  dashboardId,
  isPublic,
  filters = {},
}: DashboardContentAreaProps) {
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <EmbeddedDashboard
        dashboardId={dashboardId}
        filters={filters}
      />
    </div>
  );
}
```

---

## Phase 5: React Filter Integration

### Step 10: Create External Filter Bar (Optional)

**File**: `superset-frontend/src/features/home/ExternalFilterBar.tsx`

```typescript
import React, { useState } from 'react';

interface ExternalFilterBarProps {
  onFiltersChange: (filters: Record<string, any>) => void;
}

export default function ExternalFilterBar({ onFiltersChange }: ExternalFilterBarProps) {
  const [country, setCountry] = useState('');
  const [year, setYear] = useState('');

  const handleApply = () => {
    const filters: Record<string, any> = {};

    if (country) {
      filters['country_filter_id'] = country;
    }

    if (year) {
      filters['year_filter_id'] = year;
    }

    onFiltersChange(filters);
  };

  return (
    <div style={{ padding: '10px', display: 'flex', gap: '10px' }}>
      <select value={country} onChange={(e) => setCountry(e.target.value)}>
        <option value="">Select Country</option>
        <option value="Uganda">Uganda</option>
        <option value="Kenya">Kenya</option>
      </select>

      <select value={year} onChange={(e) => setYear(e.target.value)}>
        <option value="">Select Year</option>
        <option value="2024">2024</option>
        <option value="2025">2025</option>
      </select>

      <button onClick={handleApply}>Apply Filters</button>
    </div>
  );
}
```

### Step 11: Integrate Filter Bar with Embedded Dashboard

**File**: Update `superset-frontend/src/features/home/DashboardContentArea.tsx`

```typescript
import React, { useState } from 'react';
import EmbeddedDashboard from './EmbeddedDashboard';
import ExternalFilterBar from './ExternalFilterBar';

interface DashboardContentAreaProps {
  dashboardId: string;
  isPublic: boolean;
}

export default function DashboardContentArea({
  dashboardId,
  isPublic,
}: DashboardContentAreaProps) {
  const [filters, setFilters] = useState<Record<string, any>>({});

  return (
    <div style={{ width: '100%', height: '100%' }}>
      {isPublic && (
        <ExternalFilterBar onFiltersChange={setFilters} />
      )}

      <EmbeddedDashboard
        dashboardId={dashboardId}
        filters={filters}
      />
    </div>
  );
}
```

---

## Phase 6: Testing

### Step 12: Test Public Dashboard Access

1. **Start Superset backend**:
   ```bash
   superset run -p 8088 --with-threads --reload --debugger
   ```

2. **Start frontend dev server**:
   ```bash
   cd superset-frontend
   npm run dev
   ```

3. **Access public dashboard**:
   - Open browser: `http://localhost:9000/public-dashboard`
   - Should see dashboard WITHOUT login prompt
   - Filters should be visible and functional

4. **Test filter functionality**:
   - Select filter values
   - Click "Apply"
   - Verify charts update in real-time

5. **Check browser console**:
   - Should see NO 401/403 authentication errors
   - Guest token should be automatically refreshed

### Step 13: Test Cross-Filtering (Optional)

If using Superset's native cross-filtering:
- Click on a chart element
- Verify other charts update based on the selection
- Check that filters sync across all charts

---

## Phase 7: Production Preparation

### Step 14: Security Hardening

1. **Use strong JWT secret**:
   ```python
   # Generate secure secret
   import secrets
   GUEST_TOKEN_JWT_SECRET = secrets.token_hex(32)
   ```

2. **Set token expiration**:
   ```python
   # Shorter expiration for sensitive data
   exp = int(time.time()) + 1800  # 30 minutes
   ```

3. **Add dashboard access validation**:
   ```python
   # Only allow public dashboards
   dashboard = db.session.query(Dashboard).filter_by(id=dashboard_id).first()
   if not dashboard or not dashboard.is_public:
       return self.response_403()
   ```

### Step 15: Performance Optimization

1. **Cache guest tokens** (reuse for same dashboard):
   ```typescript
   const tokenCache = new Map<string, string>();

   export async function fetchGuestToken(dashboardId: string): Promise<string> {
     if (tokenCache.has(dashboardId)) {
       return tokenCache.get(dashboardId)!;
     }

     const token = await /* fetch token */;
     tokenCache.set(dashboardId, token);
     return token;
   }
   ```

2. **Implement token refresh** before expiration

### Step 16: Error Handling

Add comprehensive error handling:
- Token generation failures
- Dashboard not found
- Network errors
- Invalid dashboard IDs

---

## Rollback Plan

If implementation fails, revert changes:

```bash
# Revert backend config
git checkout superset/config.py

# Revert frontend changes
git checkout superset-frontend/src/features/home/

# Restart services
superset run -p 8088
cd superset-frontend && npm run dev
```

---

## Success Criteria

- [ ] Public users can access dashboard without login
- [ ] All charts render correctly
- [ ] Native Superset filters are visible and functional
- [ ] External React filters can control dashboard (optional)
- [ ] No 401/403 authentication errors in console
- [ ] Cross-filtering works (if enabled)
- [ ] Guest tokens expire and refresh properly
- [ ] Performance is acceptable (< 3s initial load)

---

## Troubleshooting

### Common Issues

**Issue**: "Failed to fetch guest token"
- Check backend endpoint is registered
- Verify GUEST_TOKEN_JWT_SECRET is set
- Check CORS settings

**Issue**: "Dashboard not found"
- Verify dashboard ID is correct (use UUID, not integer ID)
- Check dashboard.is_public is True
- Ensure EMBEDDED_SUPERSET feature flag is enabled

**Issue**: "Token expired" errors
- Implement token refresh mechanism
- Increase token expiration time
- Check system time synchronization

**Issue**: Filters not applying
- Verify filter IDs match dashboard native filters
- Check filter format matches Superset expectations
- Use browser DevTools to inspect SDK calls

---

## References

- [Superset Embedded SDK Documentation](https://superset.apache.org/docs/installation/embedded-dashboard)
- [Guest Token API Reference](https://superset.apache.org/docs/api)
- [Feature Flags Configuration](https://superset.apache.org/docs/installation/configuration)

---

**Document Version**: 1.0
**Last Updated**: 2025-11-27
**Status**: Ready for Implementation
