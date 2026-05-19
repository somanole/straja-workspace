"""Right panel: file content preview with copy support."""
from __future__ import annotations

from textual.app import ComposeResult
from textual.widgets import Button, Markdown, Static
from textual.widget import Widget
from textual.containers import Horizontal, VerticalScroll


class PreviewPanel(Widget):
    """Right panel showing file content as Markdown with a Copy button."""

    DEFAULT_CSS = """
    PreviewPanel {
        width: 2fr;
        layout: vertical;
    }
    PreviewPanel #preview-header {
        height: 1;
        layout: horizontal;
        background: $primary-darken-2;
    }
    PreviewPanel #preview-title {
        width: 1fr;
        color: $text;
        height: 1;
        padding: 0 1;
    }
    PreviewPanel #btn-copy {
        width: auto;
        min-width: 8;
        height: 1;
        margin: 0;
        border: none;
        background: $primary-darken-2;
        color: $text-muted;
    }
    PreviewPanel #btn-copy:hover {
        color: $text;
        background: $primary-darken-1;
    }
    PreviewPanel #preview-scroll {
        height: 1fr;
        padding: 0 1;
    }
    PreviewPanel #preview-empty {
        padding: 1 2;
        color: $text-muted;
    }
    """

    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)
        self._raw_content: str = ""

    def compose(self) -> ComposeResult:
        with Horizontal(id="preview-header"):
            yield Static("Preview", id="preview-title")
            yield Button("Copy", id="btn-copy")
        with VerticalScroll(id="preview-scroll"):
            yield Static("Select a file to preview its contents.", id="preview-empty")
            yield Markdown("", id="preview-content")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "btn-copy" and self._raw_content:
            self.app.copy_to_clipboard(self._raw_content)
            self.app.notify("Copied to clipboard", severity="information", timeout=2)

    async def show_content(self, title: str, content: str) -> None:
        self._raw_content = content
        self.query_one("#preview-title", Static).update(f"Preview — {title}")
        empty = self.query_one("#preview-empty", Static)
        md = self.query_one("#preview-content", Markdown)
        if content:
            empty.display = False
            await md.update(content)
        else:
            empty.display = True
            await md.update("")

    async def clear(self) -> None:
        self._raw_content = ""
        self.query_one("#preview-title", Static).update("Preview")
        empty = self.query_one("#preview-empty", Static)
        md = self.query_one("#preview-content", Markdown)
        empty.display = True
        await md.update("")
