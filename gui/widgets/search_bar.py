"""Always-on search bar with Enter-to-search and detail level selector."""
from __future__ import annotations

from textual.app import ComposeResult
from textual.widgets import Input, Select, Static
from textual.widget import Widget
from textual.message import Message
from textual import on


DETAIL_LEVELS = [
    ("Concise", "concise"),
    ("Balanced", "balanced"),
    ("Detailed", "detailed"),
]


class SearchQuery(Message):
    def __init__(self, query: str, detail_level: str = "balanced") -> None:
        super().__init__()
        self.query = query
        self.detail_level = detail_level


class SearchBar(Widget):
    """Top search bar; fires SearchQuery on Enter."""

    DEFAULT_CSS = """
    SearchBar {
        height: 3;
        layout: horizontal;
        padding: 0 1;
        background: $surface;
        border-bottom: solid $primary;
    }
    SearchBar #search-icon {
        width: auto;
        padding: 1 1 0 0;
        color: $text-muted;
    }
    SearchBar #search-input {
        width: 1fr;
    }
    SearchBar #detail-level {
        width: 16;
    }
    """

    def compose(self) -> ComposeResult:
        yield Static("Search:", id="search-icon")
        yield Input(placeholder="Ask a question about your documents…", id="search-input")
        yield Select(DETAIL_LEVELS, value="balanced", allow_blank=False, id="detail-level")

    def focus_input(self) -> None:
        self.query_one("#search-input", Input).focus()

    def clear(self) -> None:
        self.query_one("#search-input", Input).value = ""

    @on(Input.Submitted, "#search-input")
    def on_search_submitted(self, event: Input.Submitted) -> None:
        query = event.value.strip()
        if query:
            detail = self.query_one("#detail-level", Select).value
            self.post_message(SearchQuery(query, detail_level=str(detail)))
