"""MainScreen — three-panel vault browser with always-on search."""
from __future__ import annotations

from textual.app import ComposeResult
from textual.screen import Screen, ModalScreen
from textual.widgets import Footer, Header, Static, Button, Label
from textual.containers import Horizontal, Vertical
from textual import work, on

from ..vault_client import VaultClient, VaultUnavailable, FileInfo, AnswerResult
from ..widgets.collection_panel import CollectionPanel, CollectionSelected
from ..widgets.file_panel import FilePanel, FileSelected
from ..widgets.preview_panel import PreviewPanel
from ..widgets.search_bar import SearchBar, SearchQuery
from ..widgets.search_results import SearchResultsPanel, SearchResultSelected
from .import_dialog import ImportScreen, AddFilesScreen


class QuitConfirmScreen(ModalScreen[bool]):
    """Modal confirmation dialog for quitting."""

    DEFAULT_CSS = """
    QuitConfirmScreen {
        align: center middle;
    }
    QuitConfirmScreen #quit-dialog {
        width: 40;
        height: auto;
        border: solid $primary;
        background: $surface;
        padding: 1 2;
    }
    QuitConfirmScreen #quit-title {
        text-style: bold;
        margin-bottom: 1;
    }
    QuitConfirmScreen .quit-buttons {
        margin-top: 1;
        height: auto;
        align: center middle;
        layout: horizontal;
    }
    QuitConfirmScreen .quit-buttons Button {
        margin: 0 1;
    }
    """

    BINDINGS = [
        ("q", "confirm", "Quit"),
        ("y", "confirm", "Yes"),
        ("n", "cancel", "No"),
        ("escape", "cancel", "Cancel"),
    ]

    def compose(self) -> ComposeResult:
        with Vertical(id="quit-dialog"):
            yield Static("Quit Straja Vault?", id="quit-title")
            with Horizontal(classes="quit-buttons"):
                yield Button("Cancel", id="btn-quit-cancel", variant="default")
                yield Button("Quit", id="btn-quit-confirm", variant="error")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "btn-quit-confirm":
            self.dismiss(True)
        else:
            self.dismiss(False)

    def action_confirm(self) -> None:
        self.dismiss(True)

    def action_cancel(self) -> None:
        self.dismiss(False)


class MainScreen(Screen):
    BINDINGS = [
        ("ctrl+q", "request_quit", "Quit"),
        ("/", "focus_search", "Search"),
        ("escape", "unfocus", "Back"),
        ("a", "add_files", "Add Files"),
        ("ctrl+r", "refresh", "Refresh"),
        ("i", "import_collection", "Import"),
        ("d", "delete_selected", "Delete"),
        ("ctrl+u", "update_collection", "Re-index"),
    ]

    CSS_PATH = "../vault.tcss"

    def __init__(self, client: VaultClient) -> None:
        super().__init__()
        self._client = client
        self._selected_collection: str | None = None
        self._selected_file: FileInfo | None = None

    def compose(self) -> ComposeResult:
        yield Header(show_clock=False)
        with Vertical(id="main-layout"):
            yield SearchBar(id="search-bar")
            with Horizontal(id="panels"):
                yield CollectionPanel(id="collection-panel")
                yield FilePanel(id="file-panel")
                yield PreviewPanel(id="preview-panel")
            yield SearchResultsPanel(id="search-results")
        yield Footer()

    def on_mount(self) -> None:
        self._load_status()

    def action_request_quit(self) -> None:
        def on_dismiss(confirmed: bool | None) -> None:
            if confirmed:
                self.app.exit()
        self.app.push_screen(QuitConfirmScreen(), callback=on_dismiss)

    def action_focus_search(self) -> None:
        self.query_one("#search-bar", SearchBar).focus_input()

    def action_unfocus(self) -> None:
        """Move focus away from the search input back to the main screen."""
        self.set_focus(None)

    @work(exclusive=True)
    async def _load_status(self) -> None:
        try:
            status = await self._client.status()
        except VaultUnavailable:
            self._show_unavailable()
            return

        coll_panel = self.query_one("#collection-panel", CollectionPanel)
        coll_panel.refresh_collections(status.collections)
        coll_panel.update_embed_status(status.needs_embedding)

        self._update_footer(status.total_documents, status.needs_embedding)
        self._check_models()

    def _update_footer(self, total: int, pending: int) -> None:
        try:
            self.sub_title = f"{total} docs  |  {pending} pending embed"
        except Exception:
            pass

    def _show_unavailable(self) -> None:
        self.notify(
            "Vault daemon not running.\nStart it with: straja-vault mcp --http --daemon",
            title="Vault Unavailable",
            severity="error",
            timeout=0,
        )

    # ------------------------------------------------------------------
    # Collection selection
    # ------------------------------------------------------------------

    @on(CollectionSelected)
    def on_collection_selected(self, event: CollectionSelected) -> None:
        self._selected_collection = event.name
        self._selected_file = None
        self._load_files(event.name)

    @work(exclusive=True)
    async def _load_files(self, collection_name: str | None) -> None:
        file_panel = self.query_one("#file-panel", FilePanel)
        if collection_name is None:
            try:
                status = await self._client.status()
                all_files = []
                for coll in status.collections:
                    files = await self._client.list_files(coll.name)
                    all_files.extend(files)
                file_panel.set_files(all_files, None)
            except VaultUnavailable:
                self._show_unavailable()
        else:
            try:
                files = await self._client.list_files(collection_name)
                file_panel.set_files(files, collection_name)
            except VaultUnavailable:
                self._show_unavailable()

        await self.query_one("#preview-panel", PreviewPanel).clear()

    # ------------------------------------------------------------------
    # File selection → preview
    # ------------------------------------------------------------------

    @on(FileSelected)
    def on_file_selected(self, event: FileSelected) -> None:
        self._selected_file = event.file
        self._load_preview(event.file)

    @work(exclusive=True)
    async def _load_preview(self, file: FileInfo) -> None:
        parts = file.display_path.split("/", 1)
        if len(parts) != 2:
            return
        collection, path = parts
        try:
            data = await self._client.get_file(collection, path)
        except VaultUnavailable:
            self._show_unavailable()
            return
        if data:
            await self.query_one("#preview-panel", PreviewPanel).show_content(
                data.get("title", file.title),
                data.get("content", ""),
            )

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------

    @on(SearchQuery)
    def on_search_query(self, event: SearchQuery) -> None:
        self._run_search(event.query, event.detail_level)

    @work(exclusive=True)
    async def _run_search(self, query: str, detail_level: str = "balanced") -> None:
        preview = self.query_one("#preview-panel", PreviewPanel)
        await preview.show_content("Searching...", f"Retrieving and generating answer for:\n{query}")

        try:
            result = await self._client.answer(
                query,
                collections=[self._selected_collection] if self._selected_collection else None,
                limit=5,
                detail_level=detail_level,
            )
        except VaultUnavailable:
            self._show_unavailable()
            return

        # Show sources in bottom panel
        self.query_one("#search-results", SearchResultsPanel).show_results(result.sources)

        # Show LLM answer in preview panel
        sources_text = "\n".join(
            f"  [{i+1}] {s.title} ({s.file})" for i, s in enumerate(result.sources)
        )
        answer_text = f"{result.answer}\n\n---\nSources:\n{sources_text}"
        await preview.show_content(f"Q: {query}", answer_text)

    @on(SearchResultSelected)
    def on_search_result_selected(self, event: SearchResultSelected) -> None:
        """Load preview when a search result is clicked."""
        r = event.result
        parts = r.file.split("/", 1)
        if len(parts) == 2:
            self._load_search_result_preview(parts[0], parts[1], r.title)

    @work(exclusive=True)
    async def _load_search_result_preview(self, collection: str, path: str, title: str) -> None:
        try:
            data = await self._client.get_file(collection, path)
        except VaultUnavailable:
            self._show_unavailable()
            return
        if data:
            await self.query_one("#preview-panel", PreviewPanel).show_content(
                data.get("title", title),
                data.get("content", ""),
            )

    # ------------------------------------------------------------------
    # Collection actions
    # ------------------------------------------------------------------

    def action_import_collection(self) -> None:
        def on_dismiss(result: dict | None) -> None:
            if result:
                self._do_import(result["path"], result["name"], result["pattern"])
        self.app.push_screen(ImportScreen(), callback=on_dismiss)

    @work(exclusive=True)
    async def _do_import(self, path: str, name: str, pattern: str) -> None:
        self.notify(f"Importing and embedding '{name}'…", title="Importing")
        try:
            result = await self._client.add_collection(path, name, pattern)
        except VaultUnavailable:
            self._show_unavailable()
            return
        if result["ok"]:
            docs = result["data"].get("documents", 0)
            embedded = result["data"].get("embedded", False)
            embed_msg = " + embedded" if embedded else " (embedding pending)"
            self.notify(
                f"Imported '{name}' — {docs} documents{embed_msg}",
                title="Done", severity="information",
            )
            self._load_status()
        else:
            err = result["data"].get("error", "Unknown error")
            self.notify(err, title="Import Failed", severity="error")

    def action_add_files(self) -> None:
        if not self._selected_collection:
            self.notify("Select a collection first.", severity="warning")
            return
        def on_dismiss(result: dict | None) -> None:
            if result and self._selected_collection:
                self._do_add_files(self._selected_collection, result["paths"])
        self.app.push_screen(
            AddFilesScreen(self._selected_collection), callback=on_dismiss,
        )

    @work(exclusive=True)
    async def _do_add_files(self, collection: str, paths: list[str]) -> None:
        self.notify(
            f"Adding {len(paths)} file(s) to '{collection}'…", title="Adding Files",
        )
        try:
            result = await self._client.add_files(collection, paths)
        except VaultUnavailable:
            self._show_unavailable()
            return
        if result["ok"]:
            docs = result["data"].get("documents", 0)
            embedded = result["data"].get("embedded", False)
            embed_msg = " + embedded" if embedded else ""
            self.notify(
                f"Added files to '{collection}' — {docs} documents{embed_msg}",
                severity="information",
            )
            self._load_files(collection)
            self._load_status()
        else:
            err = result["data"].get("error", "Failed to add files")
            self.notify(err, title="Add Files Failed", severity="error")

    def action_update_collection(self) -> None:
        if not self._selected_collection:
            self.notify("Select a collection first.", severity="warning")
            return
        self._do_update(self._selected_collection)

    @work(exclusive=True)
    async def _do_update(self, name: str) -> None:
        self.notify(f"Re-indexing and embedding '{name}'…", title="Updating")
        try:
            result = await self._client.update_collection(name)
        except VaultUnavailable:
            self._show_unavailable()
            return
        if result["ok"]:
            docs = result["data"].get("documents", 0)
            embedded = result["data"].get("embedded", False)
            embed_msg = " + embedded" if embedded else " (embedding pending)"
            self.notify(
                f"Re-indexed '{name}' — {docs} documents{embed_msg}",
                severity="information",
            )
            self._load_files(name)
            self._load_status()
        else:
            err = result["data"].get("error", "Update failed")
            self.notify(err, title="Update Failed", severity="error")

    def action_refresh(self) -> None:
        self._load_status()
        if self._selected_collection:
            self._load_files(self._selected_collection)

    # ------------------------------------------------------------------
    # File / collection deletion
    # ------------------------------------------------------------------

    def action_delete_selected(self) -> None:
        file_panel = self.query_one("#file-panel", FilePanel)
        selected = file_panel.get_selected_file()
        if selected:
            self._delete_file(selected)
        elif self._selected_collection:
            self._delete_collection(self._selected_collection)
        else:
            self.notify("Select a file or collection to delete.", severity="warning")

    @work(exclusive=True)
    async def _delete_file(self, file: FileInfo) -> None:
        parts = file.display_path.split("/", 1)
        if len(parts) != 2:
            return
        collection, path = parts
        try:
            result = await self._client.delete_files(collection, [path])
        except VaultUnavailable:
            self._show_unavailable()
            return
        if result["ok"]:
            self.notify(f"Deleted {file.display_path}", severity="information")
            self._load_files(self._selected_collection)
            await self.query_one("#preview-panel", PreviewPanel).clear()
        else:
            self.notify("Delete failed.", severity="error")

    @work(exclusive=True)
    async def _delete_collection(self, name: str) -> None:
        try:
            result = await self._client.remove_collection(name)
        except VaultUnavailable:
            self._show_unavailable()
            return
        if result["ok"]:
            deleted = result["data"].get("deletedDocs", 0)
            self.notify(f"Removed '{name}' ({deleted} docs)", severity="information")
            self._selected_collection = None
            self._load_status()
            self.query_one("#file-panel", FilePanel).set_files([], None)
            await self.query_one("#preview-panel", PreviewPanel).clear()
        else:
            self.notify("Remove collection failed.", severity="error")

    # ------------------------------------------------------------------
    # Button presses from collection panel
    # ------------------------------------------------------------------

    def on_button_pressed(self, event: Button.Pressed) -> None:
        btn_id = event.button.id
        if btn_id == "btn-refresh":
            self.action_refresh()
        elif btn_id == "btn-import":
            self.action_import_collection()
        elif btn_id == "btn-add-files":
            self.action_add_files()
        elif btn_id == "btn-reindex":
            self.action_update_collection()
        elif btn_id == "btn-pull":
            self._do_pull()
        elif btn_id == "btn-embed":
            self._do_embed()
        elif btn_id == "btn-remove":
            if self._selected_collection:
                self._delete_collection(self._selected_collection)
            else:
                self.notify("Select a collection first.", severity="warning")

    # ------------------------------------------------------------------
    # Model pull & status
    # ------------------------------------------------------------------

    @work(exclusive=True, group="models")
    async def _check_models(self) -> None:
        coll_panel = self.query_one("#collection-panel", CollectionPanel)
        try:
            data = await self._client.models_status()
            coll_panel.update_model_status(data.get("downloaded", False))
        except VaultUnavailable:
            coll_panel.update_model_status(None)

    @work(exclusive=True, group="pull")
    async def _do_pull(self) -> None:
        self.notify("Downloading models… this may take a few minutes.", title="Pull")
        try:
            result = await self._client.pull()
        except VaultUnavailable:
            self._show_unavailable()
            return
        if result["ok"]:
            self.notify("Models downloaded.", severity="information")
            self.query_one("#collection-panel", CollectionPanel).update_model_status(True)
        else:
            err = result.get("data", {}).get("error", "Pull failed")
            self.notify(str(err), title="Pull Failed", severity="error")

    # ------------------------------------------------------------------
    # Embed
    # ------------------------------------------------------------------

    @work(exclusive=True, group="embed")
    async def _do_embed(self) -> None:
        self.notify("Running embedding pass…", title="Embed")
        try:
            result = await self._client.embed()
        except VaultUnavailable:
            self._show_unavailable()
            return
        if result["ok"]:
            self.notify("Embedding complete.", severity="information")
            self._load_status()
        else:
            self.notify("Embed failed.", severity="error")
