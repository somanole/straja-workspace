"""Entrypoint for textual-serve: runs VaultApp as a standalone script."""
from gui.app import VaultApp

app = VaultApp()
app.run()
