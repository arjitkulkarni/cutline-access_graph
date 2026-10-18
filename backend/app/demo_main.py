"""Entry point of the `demo_app` Vercel service: only the synthetic Customer Ops app (/demo/*).

Runtime verification sends real HTTP requests to this app. Locally and in Docker the API serves /demo/* itself;
on Vercel a service cannot bind to itself, so the API reaches this separate service over the binding declared
in vercel.json, which injects DEMO_API_BASE_URL.
"""

from __future__ import annotations

from .main import create_app

app = create_app(demo_only=True)
