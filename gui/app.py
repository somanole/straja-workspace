"""VaultApp — top-level Textual application."""
from __future__ import annotations

import os

from textual.app import App

from .vault_client import VaultClient
from .screens.main import MainScreen


class VaultApp(App):
    """Straja Vault Manager TUI application."""

    TITLE = "Straja Vault"
    CSS_PATH = "vault.tcss"
    ALLOW_SELECT = True

    def __init__(self, port: int | None = None) -> None:
        super().__init__()
        # When launched via `textual serve`, port comes from VAULT_PORT env var
        self._port = port or int(os.environ.get("VAULT_PORT", "8181"))
        self._client: VaultClient | None = None

    def on_mount(self) -> None:
        self._client = VaultClient(port=self._port)
        self.push_screen(MainScreen(self._client))

    async def on_unmount(self) -> None:
        if self._client is not None:
            await self._client.aclose()
