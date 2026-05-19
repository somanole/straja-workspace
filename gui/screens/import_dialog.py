"""Import dialogs — add collections or individual files."""
from __future__ import annotations

import os
import subprocess
import sys

from textual.app import ComposeResult
from textual.screen import ModalScreen
from textual.widgets import Button, Input, Label, Static
from textual.containers import Vertical, Horizontal
from textual.message import Message
from textual import work


class CollectionImported(Message):
    def __init__(self, path: str, name: str, pattern: str) -> None:
        super().__init__()
        self.path = path
        self.name = name
        self.pattern = pattern


def _pick_directory() -> str | None:
    """Open a native directory picker dialog. Returns path or None."""
    if sys.platform == "darwin":
        script = (
            'tell application "System Events"\n'
            '  activate\n'
            '  set theFolder to choose folder with prompt "Select directory to import"\n'
            '  return POSIX path of theFolder\n'
            'end tell'
        )
        try:
            result = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True, text=True, timeout=120,
            )
            path = result.stdout.strip().rstrip("/")
            return path if path else None
        except (subprocess.TimeoutExpired, FileNotFoundError):
            return None
    elif sys.platform == "linux":
        for cmd in [
            ["zenity", "--file-selection", "--directory", "--title=Select directory to import"],
            ["kdialog", "--getexistingdirectory", os.path.expanduser("~")],
        ]:
            try:
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
                path = result.stdout.strip()
                return path if result.returncode == 0 and path else None
            except FileNotFoundError:
                continue
        return None
    return None


def _pick_files() -> list[str] | None:
    """Open a native multi-file picker dialog. Returns list of paths or None."""
    if sys.platform == "darwin":
        script = (
            'tell application "System Events"\n'
            '  activate\n'
            '  set theFiles to choose file with prompt '
            '"Select files to add" with multiple selections allowed\n'
            '  set thePaths to {}\n'
            '  repeat with f in theFiles\n'
            '    set end of thePaths to POSIX path of f\n'
            '  end repeat\n'
            '  set AppleScript\'s text item delimiters to "\\n"\n'
            '  return thePaths as string\n'
            'end tell'
        )
        try:
            result = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True, text=True, timeout=120,
            )
            paths = result.stdout.strip().split("\n")
            return [p.rstrip("/") for p in paths if p.strip()] or None
        except (subprocess.TimeoutExpired, FileNotFoundError):
            return None
    elif sys.platform == "linux":
        try:
            result = subprocess.run(
                ["zenity", "--file-selection", "--multiple", "--separator=\n",
                 "--title=Select files to add"],
                capture_output=True, text=True, timeout=120,
            )
            if result.returncode == 0:
                paths = result.stdout.strip().split("\n")
                return [p for p in paths if p.strip()] or None
        except FileNotFoundError:
            pass
        return None
    return None


# ---------------------------------------------------------------------------
# Import Collection dialog (existing)
# ---------------------------------------------------------------------------

class ImportScreen(ModalScreen):
    """Modal dialog for importing a new collection."""

    DEFAULT_CSS = """
    ImportScreen {
        align: center middle;
    }
    ImportScreen #dialog {
        width: 70;
        height: auto;
        border: solid $primary;
        background: $surface;
        padding: 1 2;
    }
    ImportScreen #dialog-title {
        text-style: bold;
        margin-bottom: 1;
    }
    ImportScreen .field-label {
        margin-top: 1;
        color: $text-muted;
    }
    ImportScreen .path-row {
        height: auto;
        layout: horizontal;
    }
    ImportScreen .path-row #input-path {
        width: 1fr;
    }
    ImportScreen .path-row #btn-browse {
        width: auto;
        min-width: 10;
        margin-left: 1;
    }
    ImportScreen .dialog-buttons {
        margin-top: 1;
        height: auto;
        align: right middle;
    }
    ImportScreen .dialog-buttons Button {
        margin-left: 1;
    }
    ImportScreen #error-msg {
        color: $error;
        height: auto;
        margin-top: 1;
        display: none;
    }
    ImportScreen #error-msg.visible {
        display: block;
    }
    """

    def compose(self) -> ComposeResult:
        with Vertical(id="dialog"):
            yield Static("Import Collection", id="dialog-title")
            yield Label("Directory path:", classes="field-label")
            with Horizontal(classes="path-row"):
                yield Input(placeholder="/path/to/documents", id="input-path")
                yield Button("Browse", id="btn-browse", variant="default")
            yield Label("Collection name:", classes="field-label")
            yield Input(placeholder="my-docs", id="input-name")
            yield Label("File pattern:", classes="field-label")
            yield Input(value="**/*.{md,txt,org,pdf}", id="input-pattern")
            yield Static("", id="error-msg")
            with Horizontal(classes="dialog-buttons"):
                yield Button("Cancel", id="btn-cancel", variant="default")
                yield Button("Import", id="btn-import", variant="primary")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "btn-cancel":
            self.dismiss()
            return

        if event.button.id == "btn-browse":
            self._open_directory_picker()
            return

        path = self.query_one("#input-path", Input).value.strip()
        name = self.query_one("#input-name", Input).value.strip()
        pattern = self.query_one("#input-pattern", Input).value.strip() or "**/*.{md,txt,org,pdf}"
        error = self.query_one("#error-msg", Static)

        if not path:
            error.update("Directory path is required.")
            error.add_class("visible")
            return
        if not name:
            error.update("Collection name is required.")
            error.add_class("visible")
            return

        error.remove_class("visible")
        self.dismiss({"path": path, "name": name, "pattern": pattern})

    @work(thread=True)
    def _open_directory_picker(self) -> None:
        selected = _pick_directory()
        if selected:
            path_input = self.query_one("#input-path", Input)
            name_input = self.query_one("#input-name", Input)
            self.app.call_from_thread(self._set_path, selected, path_input, name_input)

    @staticmethod
    def _set_path(path: str, path_input: Input, name_input: Input) -> None:
        path_input.value = path
        # Auto-fill collection name from directory basename if empty
        if not name_input.value.strip():
            name_input.value = os.path.basename(path)


# ---------------------------------------------------------------------------
# Add Files dialog (new)
# ---------------------------------------------------------------------------

class AddFilesScreen(ModalScreen):
    """Modal dialog for adding files to an existing collection."""

    DEFAULT_CSS = """
    AddFilesScreen {
        align: center middle;
    }
    AddFilesScreen #dialog {
        width: 70;
        height: auto;
        max-height: 24;
        border: solid $primary;
        background: $surface;
        padding: 1 2;
    }
    AddFilesScreen #dialog-title {
        text-style: bold;
        margin-bottom: 1;
    }
    AddFilesScreen .field-label {
        margin-top: 1;
        color: $text-muted;
    }
    AddFilesScreen #files-display {
        height: auto;
        max-height: 10;
        padding: 0 1;
        color: $text;
        border: solid $primary-darken-3;
        overflow-y: auto;
    }
    AddFilesScreen .dialog-buttons {
        margin-top: 1;
        height: auto;
        align: right middle;
    }
    AddFilesScreen .dialog-buttons Button {
        margin-left: 1;
    }
    AddFilesScreen #error-msg {
        color: $error;
        height: auto;
        margin-top: 1;
        display: none;
    }
    AddFilesScreen #error-msg.visible {
        display: block;
    }
    """

    def __init__(self, collection_name: str) -> None:
        super().__init__()
        self._collection_name = collection_name
        self._selected_paths: list[str] = []

    def compose(self) -> ComposeResult:
        with Vertical(id="dialog"):
            yield Static(
                f"Add Files to '{self._collection_name}'", id="dialog-title",
            )
            yield Label("Selected files:", classes="field-label")
            yield Static("No files selected. Click Browse to choose files.", id="files-display")
            yield Static("", id="error-msg")
            with Horizontal(classes="dialog-buttons"):
                yield Button("Cancel", id="btn-cancel", variant="default")
                yield Button("Browse", id="btn-browse", variant="default")
                yield Button("Add", id="btn-add", variant="primary")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "btn-cancel":
            self.dismiss()
            return

        if event.button.id == "btn-browse":
            self._open_file_picker()
            return

        # btn-add
        error = self.query_one("#error-msg", Static)
        if not self._selected_paths:
            error.update("No files selected. Click Browse to choose files.")
            error.add_class("visible")
            return

        error.remove_class("visible")
        self.dismiss({"paths": self._selected_paths})

    @work(thread=True)
    def _open_file_picker(self) -> None:
        selected = _pick_files()
        if selected:
            self.app.call_from_thread(self._set_files, selected)

    def _set_files(self, paths: list[str]) -> None:
        self._selected_paths = paths
        display = self.query_one("#files-display", Static)
        text = "\n".join(os.path.basename(p) for p in paths)
        count = len(paths)
        display.update(f"{count} file(s) selected:\n{text}")
        # Clear error if any
        self.query_one("#error-msg", Static).remove_class("visible")
