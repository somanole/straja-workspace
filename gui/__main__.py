"""Entry point: python -m gui [--port N] [--web]"""
from __future__ import annotations

import argparse
import os
import sys

from .app import VaultApp


def main() -> None:
    parser = argparse.ArgumentParser(description="Straja Vault Manager")
    parser.add_argument("--port", type=int, default=8181, help="Vault daemon port (default: 8181)")
    parser.add_argument("--web", action="store_true", help="Serve the TUI in a web browser")
    parser.add_argument("--web-port", type=int, default=8080, help="Web server port (default: 8080)")
    args = parser.parse_args()

    if args.web:
        from textual_serve.server import Server

        os.environ["VAULT_PORT"] = str(args.port)
        server = Server(
            command=f"{sys.executable} -m gui._web_app",
            host="localhost",
            port=args.web_port,
            title="Straja Vault",
        )
        print(f"Serving Straja Vault on http://localhost:{args.web_port}")
        server.serve()
    else:
        app = VaultApp(port=args.port)
        app.run()


if __name__ == "__main__":
    main()
