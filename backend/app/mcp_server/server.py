"""Standalone MCP stdio server that exposes XHS agent tools.

Run with:
    python -m app.mcp_server.server

External MCP clients (Claude Desktop, Cursor, etc.) can attach to this
to call create/read/update/rewrite/optimize/score/image tools directly.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

from ..agents.tools import TOOLS, call_tool
from ..database import init_db


def _to_mcp_tool(name: str, entry: dict) -> Tool:
    schema = entry["schema"]["function"]
    return Tool(
        name=name,
        description=schema.get("description", ""),
        inputSchema=schema.get("parameters", {"type": "object", "properties": {}}),
    )


async def main() -> None:
    await init_db()
    server = Server("xhs-agent")

    @server.list_tools()
    async def list_tools() -> list[Tool]:
        return [_to_mcp_tool(n, e) for n, e in TOOLS.items()]

    @server.call_tool()
    async def call(name: str, arguments: dict[str, Any] | None) -> list[TextContent]:
        result = await call_tool(name, arguments or {})
        return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False))]

    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
