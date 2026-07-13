# protlabel

**Embedding Annotation Transfer (EAT) engine** — nearest-neighbour label transfer in
protein-language-model (pLM) embedding space, with the goPredSim reliability index.

`protlabel` is a small, dependency-light library (numpy only). It is
ProtSpace-agnostic by design — it imports nothing from `protspace` — so it is
independently testable and reusable from notebooks, `protspace_uniprot`, or any
other project. The `protspace transfer` CLI is a thin consumer of this engine.

## Install

```bash
pip install protlabel
```

## Use

```python
import numpy as np
from protlabel import eat, Lookup

preds = eat(
    query_emb=np.random.rand(3, 1024).astype("float32"),
    query_ids=["Q1", "Q2", "Q3"],
    ref_emb=np.random.rand(100, 1024).astype("float32"),
    ref_ids=[f"R{i}" for i in range(100)],
    ref_labels=["toxin", "enzyme"] * 50,
    k=1,
    metric="cosine",          # or "euclidean" (the goPredSim default)
)
for p in preds:
    print(p.query_id, p.label, round(p.reliability, 3))
```

`Lookup` builds and serialises a reusable reference set (`.npz` sidecar) so the
reference matrix can be rebuilt on demand rather than shipped.

## Method

Nearest-neighbour transfer in the *original* pLM embedding space (not a 2-D/3-D
projection), with the goPredSim reliability index — see Littmann et al.,
*Sci Rep* 2021 (Eq. 5) and Heinzinger et al., *NAR Genom Bioinform* 2022.

Distances are computed with an exact, chunked brute-force search (numpy BLAS GEMM
+ `argpartition`); queries are processed in batches. No approximate-nearest-neighbour
index is needed at Swiss-Prot scale.

## License

GPL-3.0 — part of the [ProtSpace](https://github.com/tsenoner/protspace) project.
