"""Translation memory record.

Ported from Felix CAT record_local.h.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class Record:
    """A single translation memory record."""
    id: int = 0
    source: str = ""
    target: str = ""
    context: str = ""
    reliability: int = 0       # 0-9
    validated: bool = False
    refcount: int = 0
    created: datetime = field(default_factory=datetime.now)
    modified: datetime = field(default_factory=datetime.now)
    created_by: str = ""
    modified_by: str = ""

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "source": self.source,
            "target": self.target,
            "context": self.context,
            "reliability": self.reliability,
            "validated": self.validated,
            "refcount": self.refcount,
            "created": self.created.isoformat(),
            "modified": self.modified.isoformat(),
            "created_by": self.created_by,
            "modified_by": self.modified_by,
        }
