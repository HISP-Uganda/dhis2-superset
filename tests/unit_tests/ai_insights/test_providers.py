from __future__ import annotations

import json

from superset.ai_insights.providers import MockProvider


def test_mock_provider_uses_first_registered_mart_table_for_sql_generation() -> None:
    provider = MockProvider(
        "mock",
        {
            "enabled": True,
            "models": ["mock-1"],
        },
    )

    response = provider.generate(
        messages=[
            {
                "role": "system",
                "content": 'Return a strict JSON object with the keys "sql", "explanation", "assumptions", and "follow_ups".',
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "question": "Show admissions by region",
                        "mart_tables": [
                            {
                                "schema": "public",
                                "table": "admissions_mart",
                                "columns": [{"name": "region", "type": "STRING"}],
                            }
                        ],
                    }
                ),
            },
        ],
        model=None,
        timeout=30,
        max_tokens=1000,
        temperature=0.1,
    )

    payload = json.loads(response.text)
    assert payload["sql"] == "SELECT * FROM public.admissions_mart LIMIT 100"
