"""A persistable reference lookup: embeddings + ids + labels, plus query().

Serialized as a single .npz sidecar so it can live next to a bundle or in a
cache dir and be rebuilt on demand from the source HDF5.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from protlabel.transfer import Prediction, eat


@dataclass
class Lookup:
    """Reference set for embedding annotation transfer."""

    embeddings: np.ndarray  # (N, D) float32
    ids: list[str]
    labels: list[str]
    metric: str = "euclidean"
    model: str = field(default="")

    def query(
        self, query_emb: np.ndarray, query_ids: list[str], *, k: int = 1
    ) -> list[Prediction]:
        """Transfer labels to query embeddings from this lookup."""
        return eat(
            query_emb,
            query_ids,
            self.embeddings,
            self.ids,
            self.labels,
            k=k,
            metric=self.metric,
        )

    def save(self, path: Path) -> None:
        """Serialize to a .npz sidecar."""
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        np.savez(
            path,
            embeddings=self.embeddings.astype(np.float16),
            ids=np.array(self.ids, dtype=object),
            labels=np.array(self.labels, dtype=object),
            metric=self.metric,
            model=self.model,
        )

    @classmethod
    def load(cls, path: Path) -> Lookup:
        """Load a .npz sidecar (re-upcasts embeddings to float32)."""
        with np.load(path, allow_pickle=True) as data:
            return cls(
                embeddings=data["embeddings"].astype(np.float32),
                ids=list(data["ids"]),
                labels=list(data["labels"]),
                metric=str(data["metric"]),
                model=str(data["model"]),
            )
