from __future__ import annotations

import asyncio
import hmac

from aiohttp import web

from appeal_bot.models import Trigger


def build_app(orchestrator, secret: str) -> web.Application:
    if not secret:
        raise ValueError("webhook secret must be non-empty")
    app = web.Application()
    app["_tasks"] = set()

    async def handle_appeal(request: web.Request) -> web.Response:
        token = request.headers.get("X-Auth-Token", "")
        if not hmac.compare_digest(token, secret):
            return web.json_response({"error": "unauthorized"}, status=401)
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "bad json"}, status=400)
        account_id = body.get("account_id")
        if not account_id:
            return web.json_response({"error": "account_id required"}, status=400)

        # Run the (slow) appeal in the background; ack immediately.
        task = asyncio.create_task(
            orchestrator.appeal(account_id, Trigger.WEBHOOK)
        )
        app["_tasks"].add(task)
        task.add_done_callback(app["_tasks"].discard)
        return web.json_response({"status": "accepted"}, status=202)

    app.router.add_post("/appeal", handle_appeal)
    return app


class WebhookServer:
    def __init__(self, orchestrator, secret: str, host: str, port: int):
        self._app = build_app(orchestrator, secret)
        self._host = host
        self._port = port
        self._runner: web.AppRunner | None = None

    async def start(self) -> None:
        self._runner = web.AppRunner(self._app)
        await self._runner.setup()
        site = web.TCPSite(self._runner, self._host, self._port)
        await site.start()

    async def stop(self) -> None:
        if self._runner:
            await self._runner.cleanup()
