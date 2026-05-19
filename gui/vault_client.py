"""Async HTTP client for the Straja Vault daemon REST API."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

try:
    import httpx
except ImportError:
    raise ImportError("Please install httpx: pip install httpx")


class VaultUnavailable(Exception):
    """Raised when the vault daemon is not reachable."""


@dataclass
class SearchResult:
    docid: str
    file: str
    title: str
    score: float
    context: Optional[str]
    snippet: str


@dataclass
class AnswerResult:
    answer: str
    sources: list[SearchResult]


@dataclass
class FileInfo:
    path: str
    display_path: str
    title: str
    size: int
    modified_at: str
    docid: str


@dataclass
class CollectionInfo:
    name: str
    path: str
    pattern: str
    documents: int
    last_updated: str


@dataclass
class VaultStatus:
    total_documents: int
    needs_embedding: int
    has_vector_index: bool
    collections: list[CollectionInfo] = field(default_factory=list)


class VaultClient:
    def __init__(self, port: int = 8181) -> None:
        self._base = f"http://localhost:{port}"
        self._client = httpx.AsyncClient(base_url=self._base, timeout=120.0)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def health(self) -> bool:
        try:
            resp = await self._client.get("/health")
            return resp.status_code == 200
        except (httpx.ConnectError, httpx.TimeoutException):
            return False

    async def status(self) -> VaultStatus:
        try:
            resp = await self._client.get("/status")
            resp.raise_for_status()
        except (httpx.ConnectError, httpx.TimeoutException) as e:
            raise VaultUnavailable(str(e)) from e
        data = resp.json()
        collections = [
            CollectionInfo(
                name=c["name"],
                path=c["path"],
                pattern=c["pattern"],
                documents=c["documents"],
                last_updated=c.get("lastUpdated", ""),
            )
            for c in data.get("collections", [])
        ]
        return VaultStatus(
            total_documents=data["totalDocuments"],
            needs_embedding=data["needsEmbedding"],
            has_vector_index=data["hasVectorIndex"],
            collections=collections,
        )

    async def query(
        self,
        q: str,
        collections: Optional[list[str]] = None,
        limit: int = 20,
        hybrid: bool = True,
    ) -> list[SearchResult]:
        if hybrid:
            # Full pipeline: lex + vec + hyde → fusion → reranking
            searches = [
                {"type": "lex", "query": q},
                {"type": "vec", "query": q},
                {"type": "hyde", "query": q},
            ]
        else:
            searches = [{"type": "lex", "query": q}]
        payload: dict = {
            "searches": searches,
            "limit": limit,
        }
        if collections:
            payload["collections"] = collections
        try:
            resp = await self._client.post("/query", json=payload)
            resp.raise_for_status()
        except (httpx.ConnectError, httpx.TimeoutException) as e:
            raise VaultUnavailable(str(e)) from e
        return [
            SearchResult(
                docid=r["docid"],
                file=r["file"],
                title=r["title"],
                score=r["score"],
                context=r.get("context"),
                snippet=r["snippet"],
            )
            for r in resp.json().get("results", [])
        ]

    async def list_files(self, collection: str) -> list[FileInfo]:
        try:
            resp = await self._client.get(f"/collections/{collection}/files")
            if resp.status_code == 404:
                return []
            resp.raise_for_status()
        except (httpx.ConnectError, httpx.TimeoutException) as e:
            raise VaultUnavailable(str(e)) from e
        return [
            FileInfo(
                path=f["path"],
                display_path=f["displayPath"],
                title=f["title"],
                size=f["size"],
                modified_at=f["modifiedAt"],
                docid=f["docid"],
            )
            for f in resp.json()
        ]

    async def get_file(self, collection: str, path: str) -> dict:
        """Returns dict with keys: path, displayPath, title, content, docid."""
        try:
            resp = await self._client.get(f"/collections/{collection}/files/{path}")
            if resp.status_code == 404:
                return {}
            resp.raise_for_status()
        except (httpx.ConnectError, httpx.TimeoutException) as e:
            raise VaultUnavailable(str(e)) from e
        return resp.json()

    async def add_collection(
        self,
        path: str,
        name: str,
        pattern: str = "**/*.md",
    ) -> dict:
        try:
            resp = await self._client.post(
                "/collections",
                json={"path": path, "name": name, "pattern": pattern},
                timeout=600.0,  # includes auto-embed
            )
            return {"ok": resp.status_code in (200, 201), "data": resp.json(), "status": resp.status_code}
        except (httpx.ConnectError, httpx.TimeoutException) as e:
            raise VaultUnavailable(str(e)) from e

    async def update_collection(self, name: str) -> dict:
        try:
            resp = await self._client.post(
                f"/collections/{name}/update",
                timeout=600.0,  # includes auto-embed
            )
            return {"ok": resp.is_success, "data": resp.json(), "status": resp.status_code}
        except (httpx.ConnectError, httpx.TimeoutException) as e:
            raise VaultUnavailable(str(e)) from e

    async def add_files(self, collection: str, paths: list[str]) -> dict:
        """Add specific files to an existing collection (indexes + embeds)."""
        try:
            resp = await self._client.post(
                f"/collections/{collection}/files",
                json={"paths": paths},
                timeout=300.0,  # includes auto-embed
            )
            return {"ok": resp.is_success, "data": resp.json(), "status": resp.status_code}
        except (httpx.ConnectError, httpx.TimeoutException) as e:
            raise VaultUnavailable(str(e)) from e

    async def remove_collection(self, name: str) -> dict:
        try:
            resp = await self._client.delete(f"/collections/{name}")
            return {"ok": resp.is_success, "data": resp.json(), "status": resp.status_code}
        except (httpx.ConnectError, httpx.TimeoutException) as e:
            raise VaultUnavailable(str(e)) from e

    async def delete_files(self, collection: str, paths: list[str]) -> dict:
        try:
            resp = await self._client.request(
                "DELETE",
                f"/collections/{collection}/files",
                json={"paths": paths},
            )
            return {"ok": resp.is_success, "data": resp.json(), "status": resp.status_code}
        except (httpx.ConnectError, httpx.TimeoutException) as e:
            raise VaultUnavailable(str(e)) from e

    async def embed(self, force: bool = False) -> dict:
        try:
            resp = await self._client.post("/embed", json={"force": force})
            try:
                data = resp.json()
            except Exception:
                data = {"error": resp.text or "Unknown error"}
            return {"ok": resp.is_success, "data": data, "status": resp.status_code}
        except (httpx.ConnectError, httpx.TimeoutException) as e:
            raise VaultUnavailable(str(e)) from e

    async def pull(self, refresh: bool = False) -> dict:
        try:
            resp = await self._client.post(
                "/pull", json={"refresh": refresh}, timeout=600.0,
            )
            try:
                data = resp.json()
            except Exception:
                data = {"error": resp.text or "Unknown error"}
            return {"ok": resp.is_success, "data": data, "status": resp.status_code}
        except (httpx.ConnectError, httpx.TimeoutException) as e:
            raise VaultUnavailable(str(e)) from e

    async def models_status(self) -> dict:
        """Returns {"downloaded": bool, "models": [...]}."""
        try:
            resp = await self._client.get("/models/status", timeout=30.0)
            resp.raise_for_status()
            return resp.json()
        except (httpx.ConnectError, httpx.TimeoutException) as e:
            raise VaultUnavailable(str(e)) from e
        except httpx.HTTPStatusError:
            # Endpoint not available (old daemon version)
            return {"downloaded": False, "models": []}

    async def answer(
        self,
        question: str,
        collections: Optional[list[str]] = None,
        limit: int = 5,
        detail_level: str = "balanced",
    ) -> AnswerResult:
        """RAG: retrieve chunks + generate answer with LLM."""
        payload: dict = {"question": question, "limit": limit, "detailLevel": detail_level}
        if collections:
            payload["collections"] = collections
        try:
            resp = await self._client.post(
                "/answer", json=payload, timeout=300.0,
            )
            resp.raise_for_status()
        except (httpx.ConnectError, httpx.TimeoutException) as e:
            raise VaultUnavailable(str(e)) from e
        except httpx.HTTPStatusError:
            # Server returned an error (e.g. 500) — try to extract error JSON
            try:
                data = resp.json()
            except Exception:
                data = {}
            return AnswerResult(
                answer=data.get("answer", "Server error — please try again."),
                sources=[],
            )
        data = resp.json()
        sources = [
            SearchResult(
                docid=s.get("docid", ""),
                file=s.get("file", ""),
                title=s.get("title", ""),
                score=s.get("score", 0),
                context=s.get("context"),
                snippet=s.get("snippet", ""),
            )
            for s in data.get("sources", [])
        ]
        return AnswerResult(answer=data.get("answer", ""), sources=sources)
