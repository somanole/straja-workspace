"""Left panel: collection list with action buttons."""
from __future__ import annotations

from textual.app import ComposeResult
from textual.widgets import Button, ListView, ListItem, Label, Static
from textual.widget import Widget
from textual.reactive import reactive
from textual.message import Message

from ..vault_client import CollectionInfo


class CollectionSelected(Message):
    def __init__(self, name: str | None) -> None:
        super().__init__()
        self.name = name  # None = "All"


class CollectionPanel(Widget):
    """Left panel showing collection list + action buttons."""

    DEFAULT_CSS = """
    CollectionPanel {
        width: 24;
        border-right: solid $primary;
        layout: vertical;
    }
    CollectionPanel #coll-title {
        background: $primary;
        color: $text;
        text-align: center;
        height: 1;
        padding: 0 1;
    }
    CollectionPanel #coll-list {
        height: 1fr;
    }
    CollectionPanel .coll-actions {
        height: auto;
        border-top: solid $primary-darken-3;
        padding: 0;
    }
    CollectionPanel .coll-btn {
        width: 1fr;
        height: 1;
        margin: 0;
        border: none;
    }
    CollectionPanel #model-status {
        height: 1;
        padding: 0 1;
        color: $text-muted;
        text-align: center;
        border-top: solid $primary-darken-3;
    }
    """

    collections: reactive[list[CollectionInfo]] = reactive([], recompose=True)
    selected: reactive[str | None] = reactive(None)
    models_downloaded: reactive[bool | None] = reactive(None)
    needs_embedding: reactive[int] = reactive(0)

    def compose(self) -> ComposeResult:
        yield Static("Collections", id="coll-title")
        with ListView(id="coll-list"):
            # "All" pseudo-collection
            total = sum(c.documents for c in self.collections)
            yield ListItem(Label(f"● All ({total})"), id="coll-all")
            for coll in self.collections:
                yield ListItem(
                    Label(f"  {coll.name}  {coll.documents}"),
                    id=f"coll-{coll.name}",
                )
        # Model status line
        status_text = self._model_status_text()
        yield Static(status_text, id="model-status")
        from textual.containers import Vertical
        with Vertical(classes="coll-actions"):
            yield Button("⟳ Refresh", id="btn-refresh", classes="coll-btn")
            yield Button("+ Import", id="btn-import", classes="coll-btn")
            yield Button("+ Add Files", id="btn-add-files", classes="coll-btn")
            yield Button("↻ Re-index", id="btn-reindex", classes="coll-btn")
            pull_label = self._pull_button_label()
            yield Button(pull_label, id="btn-pull", classes="coll-btn")
            embed_label = self._embed_button_label()
            yield Button(embed_label, id="btn-embed", classes="coll-btn")
            yield Button("✕ Remove", id="btn-remove", classes="coll-btn")

    def _model_status_text(self) -> str:
        if self.models_downloaded is None:
            return "Models: checking..."
        elif self.models_downloaded:
            return "Models: ready"
        else:
            return "Models: not downloaded"

    def _pull_button_label(self) -> str:
        if self.models_downloaded is None:
            return "↓ Pull Models (?)"
        elif self.models_downloaded:
            return "↓ Pull Models (ok)"
        else:
            return "↓ Pull Models (!)"

    def _embed_button_label(self) -> str:
        if self.needs_embedding > 0:
            return f"⬡ Embed ({self.needs_embedding})"
        return "⬡ Embed"

    def on_list_view_selected(self, event: ListView.Selected) -> None:
        item_id = event.item.id or ""
        if item_id == "coll-all":
            self.selected = None
            self.post_message(CollectionSelected(None))
        elif item_id.startswith("coll-"):
            name = item_id[5:]
            self.selected = name
            self.post_message(CollectionSelected(name))

    def refresh_collections(self, collections: list[CollectionInfo]) -> None:
        self.collections = collections

    def update_model_status(self, downloaded: bool | None) -> None:
        self.models_downloaded = downloaded

    def update_embed_status(self, needs_embedding: int) -> None:
        self.needs_embedding = needs_embedding
