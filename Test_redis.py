#!/usr/bin/env python3
"""
Quick timing script for Superset public dashboards + API endpoints.

Usage examples:
  python Test_redis.py \
    --base-url http://localhost:8088 \
    --uuid 873e95d4-2512-40e8-ad33-e7354968fa34 \
    --runs 5 --warmup 1

  # Add/override endpoints:
  python Test_redis.py \
    --base-url http://localhost:8088 \
    --uuid 873e95d4-2512-40e8-ad33-e7354968fa34 \
    --endpoint /api/v1/public/dashboard/{uuid}/ \
    --endpoint /api/v1/dashboard/{uuid}/charts
"""
from __future__ import annotations

import argparse
import json
import time
import urllib.request
import urllib.error
from typing import Dict, List, Tuple

DEFAULT_ENDPOINTS = [
    "/superset/public/dashboard/{uuid}/",
    "/api/v1/public/dashboard/{uuid}/",
    "/api/v1/dashboard/{uuid}/",
    "/api/v1/dashboard/{uuid}/charts",
]


def build_url(base_url: str, endpoint: str, uuid: str) -> str:
    base = base_url.rstrip("/")
    path = endpoint.format(uuid=uuid)
    if not path.startswith("/"):
        path = "/" + path
    return base + path


def time_request(url: str, headers: Dict[str, str]) -> Tuple[int, float, int]:
    req = urllib.request.Request(url, headers=headers)
    start = time.perf_counter()
    status_code = 0
    size = 0
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            status_code = response.getcode()
            body = response.read()
            size = len(body)
    except urllib.error.HTTPError as exc:
        status_code = exc.code
    except Exception:
        status_code = 0
    elapsed = time.perf_counter() - start
    return status_code, elapsed, size


def summarize(times: List[float]) -> Dict[str, float]:
    if not times:
        return {"min": 0.0, "max": 0.0, "avg": 0.0}
    return {
        "min": min(times),
        "max": max(times),
        "avg": sum(times) / len(times),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Test Superset public dashboard load times.")
    parser.add_argument("--base-url", required=True, help="Base URL, e.g. http://localhost:8088")
    parser.add_argument("--uuid", required=True, help="Public dashboard UUID")
    parser.add_argument("--runs", type=int, default=5, help="Number of timed runs per endpoint")
    parser.add_argument("--warmup", type=int, default=1, help="Number of warmup requests per endpoint")
    parser.add_argument(
        "--endpoint",
        action="append",
        dest="endpoints",
        help="Endpoint to test (can be used multiple times). Use {uuid} placeholder.",
    )
    parser.add_argument(
        "--no-cache",
        action="store_true",
        help="Send Cache-Control: no-cache header to bypass caches",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print JSON output summary",
    )
    args = parser.parse_args()

    endpoints = args.endpoints or DEFAULT_ENDPOINTS
    headers = {"User-Agent": "SupersetCacheTester/1.0"}
    if args.no_cache:
        headers.update({"Cache-Control": "no-cache", "Pragma": "no-cache"})

    results = {}

    for endpoint in endpoints:
        url = build_url(args.base_url, endpoint, args.uuid)
        times = []
        status_codes = []
        sizes = []

        # Warmup
        for _ in range(max(args.warmup, 0)):
            time_request(url, headers)

        # Timed runs
        for _ in range(max(args.runs, 1)):
            status, elapsed, size = time_request(url, headers)
            status_codes.append(status)
            times.append(elapsed)
            sizes.append(size)

        results[url] = {
            "status_codes": status_codes,
            "sizes": sizes,
            "timings": times,
            "summary": summarize(times),
        }

    if args.json:
        print(json.dumps(results, indent=2))
        return

    print("\nSuperset public dashboard timing results:\n")
    for url, data in results.items():
        summary = data["summary"]
        print(f"- {url}")
        print(f"  status: {data['status_codes']}")
        print(f"  sizes:  {data['sizes']}")
        print(
            f"  time:   min {summary['min']:.3f}s | avg {summary['avg']:.3f}s | max {summary['max']:.3f}s"
        )
        print()


if __name__ == "__main__":
    main()
