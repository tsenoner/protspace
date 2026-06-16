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
        """Serialize to a .npz sidecar.

        Embeddings are stored as float32 (lossless round-trip); ids/labels are
        stored as unicode arrays rather than pickled object arrays so the sidecar
        can be loaded with ``allow_pickle=False`` (no arbitrary-code-execution
        surface on load). ids/labels must not contain trailing NUL bytes, which
        numpy's fixed-width unicode arrays strip on round-trip.
        """
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        np.savez(
            path,
            embeddings=self.embeddings.astype(np.float32),
            ids=np.asarray(self.ids, dtype=np.str_),
            labels=np.asarray(self.labels, dtype=np.str_),
            metric=np.asarray(self.metric, dtype=np.str_),
            model=np.asarray(self.model, dtype=np.str_),
        )

    @classmethod
    def load(cls, path: Path) -> Lookup:
        """Load a .npz sidecar (with pickling disabled)."""
        with np.load(path, allow_pickle=False) as data:
            return cls(
                embeddings=data["embeddings"].astype(np.float32),
                ids=[str(x) for x in data["ids"]],
                labels=[str(x) for x in data["labels"]],
                metric=str(data["metric"]),
                model=str(data["model"]),
            )
