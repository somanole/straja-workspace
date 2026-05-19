"""Middle panel: file list for selected collection."""
from __future__ import annotations

from textual.app import ComposeResult
from textual.widgets import ListView, ListItem, Label, Static
from textual.widget import Widget
from textual.reactive import reactive
from textual.message import Message

from ..vault_client import FileInfo


class FileSelected(Message):
    def __init__(self, file: FileInfo) -> None:
        super().__init__()
        self.file = file


class FilePanel(Widget):
    """Middle panel showing files in the selected collection."""

    DEFAULT_CSS = """
    FilePanel {
        width: 1fr;
        border-right: solid $primary;
        layout: vertical;
    }
    FilePanel #file-title {
        background: $primary-darken-1;
        color: $text;
        height: 1;
        padding: 0 1;
    }
    FilePanel #file-list {
        height: 1fr;
    }
    FilePanel .file-item {
        padding: 0 1;
    }
    FilePanel .file-item Label {
        color: $text;
    }
    FilePanel .file-empty {
        padding: 1 2;
        color: $text-muted;
    }
    """

    files: reactive[list[FileInfo]] = reactive([], recompose=True)
    collection_name: reactive[str | None] = reactive(None, recompose=True)

    def compose(self) -> ComposeResult:
        title = self.collection_name or "All Collections"
        yield Static(f"Files — {title}", id="file-title")
        if not self.files:
            yield Static("No files. Select a collection or import documents.", classes="file-empty")
        else:
            with ListView(id="file-list"):
                for i, f in enumerate(self.files):
                    size_kb = f.size / 1024
                    size_str = f"{size_kb:.1f} KB" if size_kb >= 1 else f"{f.size} B"
                    label = f"{f.display_path}\n  {f.modified_at[:10]}  {size_str}"
                    yield ListItem(Label(label), id=f"file-{i}", classes="file-item")

    def on_list_view_selected(self, event: ListView.Selected) -> None:
        item_id = event.item.id or ""
        if item_id.startswith("file-"):
            try:
                idx = int(item_id[5:])
                if 0 <= idx < len(self.files):
                    self.post_message(FileSelected(self.files[idx]))
            except ValueError:
                pass

    def set_files(self, files: list[FileInfo], collection_name: str | None) -> None:
        self.collection_name = collection_name
        self.files = files

    def get_selected_file(self) -> FileInfo | None:
        """Return the currently highlighted file, if any."""
        try:
            lv = self.query_one("#file-list", ListView)
            if lv.highlighted_child is None:
                return None
            item_id = lv.highlighted_child.id or ""
            if item_id.startswith("file-"):
                idx = int(item_id[5:])
                if 0 <= idx < len(self.files):
                    return self.files[idx]
        except Exception:
            pass
        return None
