"""Translation memory search engine.

Orchestrates fuzzy matching over MemoryStore records.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..core.match_maker import MatchConfig, MatchResult, glossary_match_score, match_score
from ..core.segment import Segment
from .record import Record
from .store import MemoryStore


@dataclass
class SearchResult:
    """Container for ranked search results."""
    matches: list[MatchResult] = field(default_factory=list)
    query: str = ""
    total_searched: int = 0


class SearchEngine:
    """TM search engine with fuzzy matching."""

    def __init__(self, store: MemoryStore, config: MatchConfig | None = None) -> None:
        self._store = store
        self._config = config or MatchConfig()

    @property
    def config(self) -> MatchConfig:
        return self._config

    @config.setter
    def config(self, value: MatchConfig) -> None:
        self._config = value

    def fuzzy_search(
        self,
        query: str,
        min_score: float | None = None,
        max_results: int = 10,
    ) -> SearchResult:
        """Search TM for fuzzy matches to query.

        Args:
            query: Source text to look up.
            min_score: Override config min_score.
            max_results: Maximum number of results to return.

        Returns:
            SearchResult with ranked matches.
        """
        config = MatchConfig(
            min_score=min_score if min_score is not None else self._config.min_score,
            ignore_case=self._config.ignore_case,
            ignore_width=self._config.ignore_width,
            ignore_hira_kata=self._config.ignore_hira_kata,
            assess_format_penalty=self._config.assess_format_penalty,
        )

        query_seg = Segment(
            query,
            ignore_case=config.ignore_case,
            ignore_width=config.ignore_width,
            ignore_hira_kata=config.ignore_hira_kata,
        )

        records = self._store.all_records()
        matches: list[MatchResult] = []

        for rec in records:
            source_seg = Segment(
                rec.source,
                ignore_case=config.ignore_case,
                ignore_width=config.ignore_width,
                ignore_hira_kata=config.ignore_hira_kata,
            )

            score = match_score(query_seg, source_seg, config)
            if score >= config.min_score:
                matches.append(MatchResult(
                    score=score,
                    record_id=rec.id,
                    source=rec.source,
                    target=rec.target,
                    context=rec.context,
                    reliability=rec.reliability,
                    validated=rec.validated,
                    refcount=rec.refcount,
                ))

        # Sort by score (desc), then refcount (desc), reliability (desc)
        matches.sort(
            key=lambda m: (m.score, m.refcount, m.reliability, m.validated),
            reverse=True,
        )

        return SearchResult(
            matches=matches[:max_results],
            query=query,
            total_searched=len(records),
        )

    def exact_search(self, query: str) -> SearchResult:
        """Search for exact matches only."""
        return self.fuzzy_search(query, min_score=1.0)

    def reverse_search(
        self,
        query: str,
        min_score: float | None = None,
        max_results: int = 10,
    ) -> SearchResult:
        """Search by target text (reverse lookup)."""
        config = self._config
        min_sc = min_score if min_score is not None else config.min_score

        query_seg = Segment(
            query,
            ignore_case=config.ignore_case,
            ignore_width=config.ignore_width,
            ignore_hira_kata=config.ignore_hira_kata,
        )

        records = self._store.all_records()
        matches: list[MatchResult] = []

        for rec in records:
            target_seg = Segment(
                rec.target,
                ignore_case=config.ignore_case,
                ignore_width=config.ignore_width,
                ignore_hira_kata=config.ignore_hira_kata,
            )

            score = match_score(query_seg, target_seg, MatchConfig(min_score=min_sc))
            if score >= min_sc:
                matches.append(MatchResult(
                    score=score,
                    record_id=rec.id,
                    source=rec.source,
                    target=rec.target,
                    context=rec.context,
                    reliability=rec.reliability,
                    validated=rec.validated,
                    refcount=rec.refcount,
                ))

        matches.sort(
            key=lambda m: (m.score, m.refcount, m.reliability),
            reverse=True,
        )

        return SearchResult(
            matches=matches[:max_results],
            query=query,
            total_searched=len(records),
        )

    def concordance_search(
        self,
        query: str,
        field: str = "source",
    ) -> SearchResult:
        """Substring search using FTS5."""
        records = self._store.concordance(query, field=field)
        matches = [
            MatchResult(
                score=1.0,
                record_id=rec.id,
                source=rec.source,
                target=rec.target,
                context=rec.context,
                reliability=rec.reliability,
                validated=rec.validated,
                refcount=rec.refcount,
            )
            for rec in records
        ]
        return SearchResult(
            matches=matches,
            query=query,
            total_searched=self._store.count(),
        )

    def glossary_search(
        self,
        query: str,
        min_score: float = 0.9,
        max_results: int = 20,
    ) -> SearchResult:
        """Search for glossary terms within query text."""
        config = self._config

        query_seg = Segment(
            query,
            ignore_case=config.ignore_case,
            ignore_width=config.ignore_width,
            ignore_hira_kata=config.ignore_hira_kata,
        )

        records = self._store.all_records()
        matches: list[MatchResult] = []

        for rec in records:
            term_seg = Segment(
                rec.source,
                ignore_case=config.ignore_case,
                ignore_width=config.ignore_width,
                ignore_hira_kata=config.ignore_hira_kata,
            )

            score = glossary_match_score(query_seg, term_seg, min_score=min_score)
            if score >= min_score:
                matches.append(MatchResult(
                    score=score,
                    record_id=rec.id,
                    source=rec.source,
                    target=rec.target,
                    context=rec.context,
                    reliability=rec.reliability,
                    validated=rec.validated,
                    refcount=rec.refcount,
                ))

        matches.sort(key=lambda m: m.score, reverse=True)

        return SearchResult(
            matches=matches[:max_results],
            query=query,
            total_searched=len(records),
        )
