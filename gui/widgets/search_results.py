"""Search results list panel."""
from __future__ import annotations

from textual.app import ComposeResult
from textual.widgets import ListView, ListItem, Label, Static
from textual.widget import Widget
from textual.reactive import reactive
from textual.message import Message

from ..vault_client import SearchResult


class SearchResultSelected(Message):
    def __init__(self, result: SearchResult) -> None:
        super().__init__()
        self.result = result


class SearchResultsPanel(Widget):
    """Collapsible bottom panel showing search results."""

    DEFAULT_CSS = """
    SearchResultsPanel {
        height: 12;
        border-top: solid $primary;
        display: none;
        layout: vertical;
    }
    SearchResultsPanel.active {
        display: block;
    }
    SearchResultsPanel #results-title {
        background: $primary-darken-3;
        color: $text;
        height: 1;
        padding: 0 1;
    }
    SearchResultsPanel #results-list {
        height: 1fr;
    }
    SearchResultsPanel .result-item {
        padding: 0 1;
        height: auto;
    }
    SearchResultsPanel .result-empty {
        padding: 1 2;
        color: $text-muted;
    }
    """

    results: reactive[list[SearchResult]] = reactive([], recompose=True)

    def compose(self) -> ComposeResult:
        count = len(self.results)
        title = f"Search Results ({count})" if self.results else "Search Results"
        yield Static(title, id="results-title")
        if not self.results:
            yield Static("No results.", classes="result-empty")
        else:
            with ListView(id="results-list"):
                for i, r in enumerate(self.results):
                    score_pct = f"{int(r.score * 100)}%"
                    snippet = r.snippet.replace("\n", " ")[:120]
                    label = f"{score_pct}  {r.docid}  {r.file} — {r.title}\n  {snippet}"
                    yield ListItem(Label(label), id=f"result-{i}", classes="result-item")

    def on_list_view_selected(self, event: ListView.Selected) -> None:
        item_id = event.item.id or ""
        if item_id.startswith("result-"):
            idx = int(item_id[7:])
            if 0 <= idx < len(self.results):
                self.post_message(SearchResultSelected(self.results[idx]))

    def show_results(self, results: list[SearchResult]) -> None:
        self.results = results
        self.add_class("active")

    def hide(self) -> None:
        self.results = []
        self.remove_class("active")
