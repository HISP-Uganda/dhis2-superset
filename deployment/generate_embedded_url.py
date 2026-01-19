#!/usr/bin/env python3
"""
Generate embedded dashboard URL and guest token for embedding Superset dashboards.

This script helps you generate the correct embedded URL and guest token
for your Superset dashboards, automatically using the configured base URL.

Usage:
    python generate_embedded_url.py <dashboard_id>
    python generate_embedded_url.py <dashboard_id> --username guest --expiry 300

Examples:
    python generate_embedded_url.py 1
    python generate_embedded_url.py 5 --username guest --expiry 600
    python generate_embedded_url.py 3 --format html
"""

import sys
import argparse
import jwt
from datetime import datetime, timedelta


def generate_guest_token(username='guest', expiry_seconds=300, secret=None):
    """Generate a guest token for embedded dashboard access.

    Args:
        username: Username for the guest token (default: 'guest')
        expiry_seconds: Token expiry time in seconds (default: 300 = 5 minutes)
        secret: JWT secret (if None, reads from config)

    Returns:
        JWT token string
    """
    if secret is None:
        # Import from config
        try:
            from superset_config import GUEST_TOKEN_JWT_SECRET
            secret = GUEST_TOKEN_JWT_SECRET
        except ImportError:
            print("Error: Cannot import GUEST_TOKEN_JWT_SECRET from superset_config.py")
            print("Make sure superset_config.py exists and GUEST_TOKEN_JWT_SECRET is set")
            sys.exit(1)

    if secret == 'CHANGE_ME_TO_A_COMPLEX_RANDOM_SECRET':
        print("WARNING: GUEST_TOKEN_JWT_SECRET is not configured!")
        print("Edit superset_config.py and set a secure secret")
        sys.exit(1)

    payload = {
        'username': username,
        'exp': datetime.utcnow() + timedelta(seconds=expiry_seconds)
    }

    token = jwt.encode(payload, secret, algorithm='HS256')

    # jwt.encode returns bytes in older versions, string in newer versions
    if isinstance(token, bytes):
        token = token.decode('utf-8')

    return token


def get_base_url():
    """Get the configured base URL from config.

    Returns:
        Base URL string
    """
    try:
        from superset_config import SUPERSET_BASE_URL
        return SUPERSET_BASE_URL
    except ImportError:
        print("Warning: Cannot import SUPERSET_BASE_URL from superset_config.py")
        print("Using default: http://localhost:8088")
        return 'http://localhost:8088'


def generate_embedded_url(dashboard_id, base_url=None):
    """Generate embedded dashboard URL.

    Args:
        dashboard_id: Dashboard ID
        base_url: Base URL (if None, reads from config)

    Returns:
        Embedded dashboard URL
    """
    if base_url is None:
        base_url = get_base_url()

    # Remove trailing slash if present
    base_url = base_url.rstrip('/')

    return f"{base_url}/embedded/{dashboard_id}"


def print_html_example(dashboard_id, embedded_url, guest_token):
    """Print HTML iframe example.

    Args:
        dashboard_id: Dashboard ID
        embedded_url: Embedded dashboard URL
        guest_token: Guest token
    """
    html = f'''
<!-- Embedded Superset Dashboard -->
<div id="superset-dashboard-{dashboard_id}">
    <iframe
        id="superset-iframe-{dashboard_id}"
        src="{embedded_url}"
        width="100%"
        height="800"
        frameborder="0"
        allowfullscreen
    ></iframe>
</div>

<script>
// Send guest token to embedded dashboard
(function() {{
    const iframe = document.getElementById('superset-iframe-{dashboard_id}');

    // Wait for iframe to load
    iframe.addEventListener('load', function() {{
        // Send guest token via postMessage
        iframe.contentWindow.postMessage({{
            guestToken: '{guest_token}'
        }}, '*');
    }});
}})();
</script>
'''
    print(html)


def print_react_example(dashboard_id, embedded_url, guest_token):
    """Print React component example.

    Args:
        dashboard_id: Dashboard ID
        embedded_url: Embedded dashboard URL
        guest_token: Guest token
    """
    react = f'''
import React, {{ useEffect, useRef }} from 'react';

const SupersetDashboard = () => {{
    const iframeRef = useRef(null);
    const guestToken = '{guest_token}';

    useEffect(() => {{
        const iframe = iframeRef.current;

        const handleLoad = () => {{
            // Send guest token to embedded dashboard
            iframe.contentWindow.postMessage({{
                guestToken: guestToken
            }}, '*');
        }};

        iframe.addEventListener('load', handleLoad);

        return () => {{
            iframe.removeEventListener('load', handleLoad);
        }};
    }}, []);

    return (
        <div className="superset-dashboard-container">
            <iframe
                ref={{iframeRef}}
                src="{embedded_url}"
                width="100%"
                height="800"
                frameBorder="0"
                allowFullScreen
            />
        </div>
    );
}};

export default SupersetDashboard;
'''
    print(react)


def print_curl_example(embedded_url, guest_token):
    """Print curl example for testing.

    Args:
        embedded_url: Embedded dashboard URL
        guest_token: Guest token
    """
    curl = f'''
# Test embedded dashboard access with curl
curl -X GET "{embedded_url}" \\
  -H "X-GuestToken: {guest_token}" \\
  -H "Accept: application/json"
'''
    print(curl)


def main():
    """Main function."""
    parser = argparse.ArgumentParser(
        description='Generate embedded dashboard URL and guest token',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  %(prog)s 1
  %(prog)s 5 --username guest --expiry 600
  %(prog)s 3 --format html
  %(prog)s 7 --format react
  %(prog)s 2 --format curl
        '''
    )

    parser.add_argument('dashboard_id', type=int, help='Dashboard ID to embed')
    parser.add_argument('--username', default='guest', help='Guest username (default: guest)')
    parser.add_argument('--expiry', type=int, default=300, help='Token expiry in seconds (default: 300)')
    parser.add_argument('--format', choices=['simple', 'html', 'react', 'curl'],
                        default='simple', help='Output format (default: simple)')
    parser.add_argument('--base-url', help='Override base URL from config')

    args = parser.parse_args()

    # Generate embedded URL
    embedded_url = generate_embedded_url(args.dashboard_id, args.base_url)

    # Generate guest token
    guest_token = generate_guest_token(args.username, args.expiry)

    # Output based on format
    if args.format == 'simple':
        print("=" * 80)
        print(f"Embedded Dashboard URL Generator")
        print("=" * 80)
        print(f"Dashboard ID:    {args.dashboard_id}")
        print(f"Base URL:        {get_base_url() if not args.base_url else args.base_url}")
        print(f"Embedded URL:    {embedded_url}")
        print()
        print(f"Guest Token (expires in {args.expiry}s):")
        print(guest_token)
        print()
        print("=" * 80)
        print("Usage:")
        print("1. Copy the embedded URL and guest token")
        print("2. Use in your application (see examples with --format html|react|curl)")
        print("=" * 80)

    elif args.format == 'html':
        print_html_example(args.dashboard_id, embedded_url, guest_token)

    elif args.format == 'react':
        print_react_example(args.dashboard_id, embedded_url, guest_token)

    elif args.format == 'curl':
        print_curl_example(embedded_url, guest_token)


if __name__ == '__main__':
    main()
