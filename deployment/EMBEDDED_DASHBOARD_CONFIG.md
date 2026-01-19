# Embedded Dashboard Configuration Guide

## Overview

This guide explains how to configure embedded Superset dashboards with the correct URLs for different environments (development, staging, production).

---

## Base URL Configuration

### Setting the Base URL

The base URL determines where your embedded dashboards will point to. It's configured in `superset_config.py`:

```python
# Development (local)
SUPERSET_BASE_URL = 'http://localhost:8088'

# Staging
SUPERSET_BASE_URL = 'https://staging.superset.yourdomain.com'

# Production
SUPERSET_BASE_URL = 'https://superset.yourdomain.com'
```

### Using Environment Variables

For maximum flexibility, use environment variables:

```python
# In superset_config.py
SUPERSET_BASE_URL = os.environ.get('SUPERSET_BASE_URL', 'http://localhost:8088')
```

Then set the environment variable:

```bash
# Development
export SUPERSET_BASE_URL='http://localhost:8088'

# Production
export SUPERSET_BASE_URL='https://superset.yourdomain.com'

# Start Superset
./deploy.sh start
```

---

## Generating Embedded URLs

### Using the Helper Script

We've created a helper script to generate embedded dashboard URLs and guest tokens:

#### Basic Usage

```bash
# Generate URL and token for dashboard ID 1
python generate_embedded_url.py 1
```

**Output:**
```
================================================================================
Embedded Dashboard URL Generator
================================================================================
Dashboard ID:    1
Base URL:        http://localhost:8088
Embedded URL:    http://localhost:8088/embedded/1

Guest Token (expires in 300s):
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
================================================================================
```

#### Generate HTML Example

```bash
python generate_embedded_url.py 1 --format html
```

**Output:**
```html
<!-- Embedded Superset Dashboard -->
<div id="superset-dashboard-1">
    <iframe
        id="superset-iframe-1"
        src="http://localhost:8088/embedded/1"
        width="100%"
        height="800"
        frameborder="0"
        allowfullscreen
    ></iframe>
</div>

<script>
(function() {
    const iframe = document.getElementById('superset-iframe-1');
    iframe.addEventListener('load', function() {
        iframe.contentWindow.postMessage({
            guestToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
        }, '*');
    });
})();
</script>
```

#### Generate React Component

```bash
python generate_embedded_url.py 1 --format react
```

#### Custom Token Expiry

```bash
# Token expires in 10 minutes (600 seconds)
python generate_embedded_url.py 1 --expiry 600
```

#### Override Base URL

```bash
# Use production URL even in development
python generate_embedded_url.py 1 --base-url https://superset.yourdomain.com
```

---

## Environment-Specific Configuration

### Development Environment

**File:** `superset_config.py`
```python
SUPERSET_BASE_URL = 'http://localhost:8088'

EMBEDDED_ALLOWED_DOMAINS = [
    'localhost',
    '127.0.0.1',
]
```

**Usage:**
```bash
python generate_embedded_url.py 1
# URL: http://localhost:8088/embedded/1
```

### Staging Environment

**File:** `superset_config.py` (on staging server)
```python
SUPERSET_BASE_URL = 'https://staging.superset.yourdomain.com'

EMBEDDED_ALLOWED_DOMAINS = [
    'staging.yourdomain.com',
    'staging-app.yourdomain.com',
]
```

**Usage:**
```bash
python generate_embedded_url.py 1
# URL: https://staging.superset.yourdomain.com/embedded/1
```

### Production Environment

**File:** `superset_config.py` (on production server)
```python
SUPERSET_BASE_URL = 'https://superset.yourdomain.com'

EMBEDDED_ALLOWED_DOMAINS = [
    'yourdomain.com',
    'www.yourdomain.com',
    'app.yourdomain.com',
]
```

**Usage:**
```bash
python generate_embedded_url.py 1
# URL: https://superset.yourdomain.com/embedded/1
```

---

## Multi-Environment Setup with Docker

If using Docker for deployment:

**docker-compose.yml:**
```yaml
version: '3.8'

services:
  superset:
    image: your-superset-image
    environment:
      - SUPERSET_BASE_URL=${SUPERSET_BASE_URL}
      - SUPERSET_SECRET_KEY=${SUPERSET_SECRET_KEY}
      - GUEST_TOKEN_JWT_SECRET=${GUEST_TOKEN_JWT_SECRET}
    ports:
      - "8088:8088"
```

**.env.development:**
```bash
SUPERSET_BASE_URL=http://localhost:8088
SUPERSET_SECRET_KEY=dev-secret-key
GUEST_TOKEN_JWT_SECRET=dev-guest-token-secret
```

**.env.production:**
```bash
SUPERSET_BASE_URL=https://superset.yourdomain.com
SUPERSET_SECRET_KEY=prod-secret-key-xyz123
GUEST_TOKEN_JWT_SECRET=prod-guest-token-secret-abc456
```

**Run:**
```bash
# Development
docker-compose --env-file .env.development up

# Production
docker-compose --env-file .env.production up
```

---

## Backend Token Generation

For your application backend, generate guest tokens programmatically:

### Python Backend

```python
import jwt
from datetime import datetime, timedelta
import os

def generate_guest_token(username='guest', expiry_minutes=5):
    """Generate guest token for embedded dashboard."""
    secret = os.environ.get('GUEST_TOKEN_JWT_SECRET')

    payload = {
        'username': username,
        'exp': datetime.utcnow() + timedelta(minutes=expiry_minutes)
    }

    token = jwt.encode(payload, secret, algorithm='HS256')

    if isinstance(token, bytes):
        token = token.decode('utf-8')

    return token

def get_embedded_url(dashboard_id):
    """Get embedded dashboard URL."""
    base_url = os.environ.get('SUPERSET_BASE_URL', 'http://localhost:8088')
    return f"{base_url}/embedded/{dashboard_id}"

# Usage in your API endpoint
@app.route('/dashboard/<int:dashboard_id>')
def get_dashboard(dashboard_id):
    return {
        'url': get_embedded_url(dashboard_id),
        'guestToken': generate_guest_token()
    }
```

### Node.js Backend

```javascript
const jwt = require('jsonwebtoken');

function generateGuestToken(username = 'guest', expiryMinutes = 5) {
    const secret = process.env.GUEST_TOKEN_JWT_SECRET;

    const payload = {
        username: username,
        exp: Math.floor(Date.now() / 1000) + (expiryMinutes * 60)
    };

    return jwt.sign(payload, secret, { algorithm: 'HS256' });
}

function getEmbeddedUrl(dashboardId) {
    const baseUrl = process.env.SUPERSET_BASE_URL || 'http://localhost:8088';
    return `${baseUrl}/embedded/${dashboardId}`;
}

// Usage in Express.js
app.get('/api/dashboard/:id', (req, res) => {
    const dashboardId = req.params.id;

    res.json({
        url: getEmbeddedUrl(dashboardId),
        guestToken: generateGuestToken()
    });
});
```

### PHP Backend

```php
<?php
use Firebase\JWT\JWT;

function generateGuestToken($username = 'guest', $expiryMinutes = 5) {
    $secret = getenv('GUEST_TOKEN_JWT_SECRET');

    $payload = [
        'username' => $username,
        'exp' => time() + ($expiryMinutes * 60)
    ];

    return JWT::encode($payload, $secret, 'HS256');
}

function getEmbeddedUrl($dashboardId) {
    $baseUrl = getenv('SUPERSET_BASE_URL') ?: 'http://localhost:8088';
    return "$baseUrl/embedded/$dashboardId";
}

// Usage
$dashboardId = $_GET['id'];
echo json_encode([
    'url' => getEmbeddedUrl($dashboardId),
    'guestToken' => generateGuestToken()
]);
?>
```

---

## Frontend Integration

### React Component (Production-Ready)

```jsx
import React, { useEffect, useRef, useState } from 'react';

const SupersetDashboard = ({ dashboardId }) => {
    const iframeRef = useRef(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        // Fetch embedded URL and guest token from your backend
        fetch(`/api/dashboard/${dashboardId}`)
            .then(res => res.json())
            .then(data => {
                const iframe = iframeRef.current;

                const handleLoad = () => {
                    // Send guest token to embedded dashboard
                    iframe.contentWindow.postMessage({
                        guestToken: data.guestToken
                    }, '*');
                    setLoading(false);
                };

                iframe.src = data.url;
                iframe.addEventListener('load', handleLoad);

                return () => {
                    iframe.removeEventListener('load', handleLoad);
                };
            })
            .catch(err => {
                setError(err.message);
                setLoading(false);
            });
    }, [dashboardId]);

    if (error) {
        return <div className="error">Error loading dashboard: {error}</div>;
    }

    return (
        <div className="superset-dashboard-container">
            {loading && <div className="loading">Loading dashboard...</div>}
            <iframe
                ref={iframeRef}
                width="100%"
                height="800"
                frameBorder="0"
                allowFullScreen
                style={{ display: loading ? 'none' : 'block' }}
            />
        </div>
    );
};

export default SupersetDashboard;
```

### Vue.js Component

```vue
<template>
  <div class="superset-dashboard-container">
    <div v-if="loading" class="loading">Loading dashboard...</div>
    <div v-if="error" class="error">Error: {{ error }}</div>
    <iframe
      ref="iframe"
      :src="embeddedUrl"
      width="100%"
      height="800"
      frameborder="0"
      allowfullscreen
      :style="{ display: loading ? 'none' : 'block' }"
      @load="onIframeLoad"
    ></iframe>
  </div>
</template>

<script>
export default {
  props: {
    dashboardId: {
      type: Number,
      required: true
    }
  },
  data() {
    return {
      embeddedUrl: '',
      guestToken: '',
      loading: true,
      error: null
    };
  },
  async mounted() {
    try {
      const response = await fetch(`/api/dashboard/${this.dashboardId}`);
      const data = await response.json();

      this.embeddedUrl = data.url;
      this.guestToken = data.guestToken;
    } catch (err) {
      this.error = err.message;
      this.loading = false;
    }
  },
  methods: {
    onIframeLoad() {
      this.$refs.iframe.contentWindow.postMessage({
        guestToken: this.guestToken
      }, '*');
      this.loading = false;
    }
  }
};
</script>
```

---

## Testing Embedded Dashboards

### Test with curl

```bash
# Generate test URL and token
python generate_embedded_url.py 1 --format curl

# Or manually
curl -X GET "http://localhost:8088/embedded/1" \
  -H "X-GuestToken: YOUR_GUEST_TOKEN" \
  -H "Accept: application/json"
```

### Test in Browser Console

```javascript
// Generate guest token (replace with your actual secret)
const payload = {
    username: 'guest',
    exp: Math.floor(Date.now() / 1000) + 300 // 5 minutes
};

// Note: In production, generate token on backend!
// This is just for testing

// Open embedded dashboard
window.open('http://localhost:8088/embedded/1');

// Send token via postMessage (in iframe parent page)
const iframe = document.querySelector('iframe');
iframe.contentWindow.postMessage({
    guestToken: 'YOUR_GUEST_TOKEN'
}, '*');
```

---

## Troubleshooting

### Issue: Embedded dashboard shows "Access Denied"

**Cause:** Domain not in `EMBEDDED_ALLOWED_DOMAINS`

**Fix:**
```python
# In superset_config.py
EMBEDDED_ALLOWED_DOMAINS = [
    'localhost',
    'yourdomain.com',
    'app.yourdomain.com',  # Add your domain
]
```

### Issue: Wrong base URL in generated URLs

**Cause:** `SUPERSET_BASE_URL` not configured

**Fix:**
```python
# In superset_config.py
SUPERSET_BASE_URL = 'https://superset.yourdomain.com'  # Update this
```

### Issue: Guest token invalid

**Cause:** Token secret mismatch

**Fix:**
Ensure backend and Superset use same `GUEST_TOKEN_JWT_SECRET`:

```bash
# Backend .env file
GUEST_TOKEN_JWT_SECRET=same-secret-as-superset-config

# Superset superset_config.py
GUEST_TOKEN_JWT_SECRET = 'same-secret-as-superset-config'
```

---

## Security Best Practices

1. **Use HTTPS in Production**
   ```python
   SUPERSET_BASE_URL = 'https://superset.yourdomain.com'  # Not http://
   ```

2. **Set Strong Secrets**
   ```bash
   python3 -c "import secrets; print(secrets.token_urlsafe(64))"
   ```

3. **Limit Allowed Domains**
   ```python
   EMBEDDED_ALLOWED_DOMAINS = [
       'yourdomain.com',        # Only your domain
       # 'example.com',         # Don't allow other domains
   ]
   ```

4. **Short Token Expiry**
   ```python
   GUEST_TOKEN_JWT_EXP_SECONDS = 300  # 5 minutes
   ```

5. **Regenerate Tokens Server-Side**
   Never generate tokens on the frontend!

---

## Summary

### Development Setup

```bash
# 1. Configure base URL
echo "SUPERSET_BASE_URL='http://localhost:8088'" >> .env

# 2. Generate embedded URL
python generate_embedded_url.py 1 --format html

# 3. Copy HTML to your app
```

### Production Setup

```bash
# 1. Configure base URL on server
nano superset_config.py
# Set: SUPERSET_BASE_URL = 'https://superset.yourdomain.com'

# 2. Add allowed domains
# Set: EMBEDDED_ALLOWED_DOMAINS = ['yourdomain.com']

# 3. Generate tokens in your backend
# Use Python/Node/PHP examples above

# 4. Restart Superset
./deploy.sh restart
```

**With this configuration, your embedded dashboards will use the correct URL for each environment!** 🎯
