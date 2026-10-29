"""The Colab notebooks have to survive IPython's cell transformation.

A cell magic (`%%capture`) is only recognised on the first line of a cell. Put
one below the `# @title` line that Colab needs there, and IPython parses it as
the line magic `%capture`, which does not exist: the cell raises `UsageError`
and aborts before the `pip install` and every import under it, taking all later
cells down with `NameError`. That shipped silently broken in two notebooks for
months, and the only thing keeping it fixed is a comment in each install cell
asking the next reader not to "simplify" the `subprocess.run` call back.

These tests are that comment's teeth. They glob the notebook directory rather
than naming files, so a notebook added later is covered without touching this
file.
"""

from __future__ import annotations

import ast
import json
from pathlib import Path

import pytest

NOTEBOOK_DIR = Path(__file__).resolve().parents[1] / "notebooks"
NOTEBOOKS = sorted(NOTEBOOK_DIR.glob("*.ipynb"))


def _code_cells(path: Path):
    """Yield (index, source) for every code cell, source joined to one string."""
    nb = json.loads(path.read_text())
    for i, cell in enumerate(nb["cells"]):
        if cell.get("cell_type") != "code":
            continue
        source = cell["source"]
        yield i, source if isinstance(source, str) else "".join(source)


def test_notebook_directory_is_not_empty():
    """Guard the glob: an empty match would make every test below vacuous."""
    assert NOTEBOOKS, f"no notebooks found under {NOTEBOOK_DIR}"


@pytest.mark.parametrize("path", NOTEBOOKS, ids=lambda p: p.name)
def test_cell_magics_stay_on_the_first_line(path: Path):
    for index, source in _code_cells(path):
        for lineno, line in enumerate(source.splitlines()):
            if line.lstrip().startswith("%%") and lineno != 0:
                pytest.fail(
                    f"{path.name} cell {index}: cell magic {line.strip()!r} on line "
                    f"{lineno + 1}. Only line 1 is parsed as a cell magic; anywhere "
                    "else IPython reads it as a line magic and the cell aborts. Use "
                    "subprocess.run(..., capture_output=True) instead."
                )


@pytest.mark.parametrize("path", NOTEBOOKS, ids=lambda p: p.name)
def test_code_cells_compile_after_ipython_transformation(path: Path):
    """Catches the syntax errors a raw `compile()` would miss, and vice versa.

    Notebook cells are not plain Python: `!cmd` and `%magic` are rewritten
    before execution. Transforming first is what the real runtime does.

    `TransformerManager` is the transformer on its own, deliberately in place of
    `InteractiveShell.instance().input_transformer_manager`: the shell is a
    process-wide singleton that is never torn down, and building it sets
    `builtins.__IPYTHON__` and installs a `warnings` filter that would then
    outlive this test for the rest of the pytest session.
    """
    transform = pytest.importorskip(
        "IPython.core.inputtransformer2",
        reason="IPython is a dev-group dependency (via jupyter)",
    ).TransformerManager()

    for index, source in _code_cells(path):
        try:
            compile(transform.transform_cell(source), f"{path.name}:{index}", "exec")
        except SyntaxError as exc:
            pytest.fail(f"{path.name} cell {index} does not compile: {exc}")


def _literal_set(node: ast.expr) -> frozenset | None:
    """`frozenset({...})`, `frozenset()`, `set()` or a bare `{...}` → a frozenset.

    Anything else is None, i.e. "not a readable literal" — which the caller must
    treat as a failure rather than a skip, or the pin becomes vacuous.
    """
    if isinstance(node, ast.Set):
        return frozenset(ast.literal_eval(node))
    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id in {"frozenset", "set"}
        and not node.keywords
    ):
        if not node.args:
            return frozenset()
        if len(node.args) == 1:
            return frozenset(ast.literal_eval(node.args[0]))
    return None


def _assignments(node: ast.AST):
    """(name, value) for plain and annotated assignments alike.

    The package declares both constants as annotated assignments, so a fallback
    written in that style must not slip past.
    """
    if isinstance(node, ast.Assign):
        for target in node.targets:
            if isinstance(target, ast.Name):
                yield target.id, node.value
    elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
        if node.value is not None:
            yield node.target.id, node.value


def _guarded_import_fallbacks(tree: ast.AST, names: set[str]) -> dict[str, frozenset]:
    """Read the `except ImportError` fallback for every guarded import of *names*.

    Keys off the `try`/`except` structure rather than scanning for assignments,
    so "the fallback is missing" is a failure instead of an empty result. A name
    in *names* that is not imported under a guard at all contributes nothing —
    there is no second copy to drift.
    """
    found = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.Try):
            continue
        guarded = {
            alias.asname or alias.name
            for stmt in node.body
            for sub in ast.walk(stmt)
            if isinstance(sub, ast.ImportFrom)
            for alias in sub.names
        } & names
        if not guarded:
            continue
        for handler in node.handlers:
            for stmt in handler.body:
                for sub in ast.walk(stmt):
                    for name, value in _assignments(sub):
                        if name not in guarded:
                            continue
                        literal = _literal_set(value)
                        assert literal is not None, (
                            f"fallback {name} is not a literal set, so nothing can "
                            "check it against the package. Write it as "
                            "`frozenset({...})`."
                        )
                        found[name] = literal
        missing = guarded - set(found)
        assert not missing, (
            f"{', '.join(sorted(missing))} imported under `try`/`except ImportError` "
            "with no fallback assigned in the handler — the notebook would NameError "
            "on exactly the released-package lag the guard exists for."
        )
    return found


@pytest.mark.parametrize("path", NOTEBOOKS, ids=lambda p: p.name)
def test_notebook_fallback_sets_match_the_package(path: Path):
    """The `except ImportError` copies must equal the constants they stand in for.

    Cell 1 installs the *released* protspace while the notebook is served from
    `main`, so the panel falls back to inline literals for one release. That
    fallback is deliberate — but nothing else pins it, and it is exactly the
    copy that runs during the lag it exists for. Left undefended, emptying
    BIOCENTRAL_INVALID (when Biocentral is fixed) or adding a name to
    COLAB_OVERSIZED would leave the notebook gating on stale policy silently.

    Deliberately structural: it reads the fallback out of the `try`/`except`
    that guards the import, so a fallback that is missing, emptied, or written
    in a shape the reader does not understand *fails* rather than quietly
    matching nothing. A guard that can silently disarm itself is worse than no
    guard, because the notebook comment claims protection either way.
    """
    from protspace.data.embedding.biocentral import BIOCENTRAL_INVALID
    from protspace.data.embedding.local import COLAB_OVERSIZED

    expected = {
        "BIOCENTRAL_INVALID": BIOCENTRAL_INVALID,
        "COLAB_OVERSIZED": COLAB_OVERSIZED,
    }
    # Transform first, for the reason this module exists: cell source is not
    # plain Python, and a `!cmd` line anywhere in a matched cell would otherwise
    # raise SyntaxError from a test that has nothing to say about shell lines.
    transform = pytest.importorskip(
        "IPython.core.inputtransformer2",
        reason="IPython is a dev-group dependency (via jupyter)",
    ).TransformerManager()

    for index, source in _code_cells(path):
        tree = ast.parse(transform.transform_cell(source))
        for name, value in _guarded_import_fallbacks(tree, set(expected)).items():
            assert value == expected[name], (
                f"{path.name} cell {index}: fallback {name} = {sorted(value)} but "
                f"the package says {sorted(expected[name])}. Update the literal in "
                "the notebook's `except ImportError` block to match."
            )


@pytest.mark.parametrize("path", NOTEBOOKS, ids=lambda p: p.name)
def test_no_notebook_imports_a_private_protspace_name(path: Path):
    """Cell 1 installs the *released* protspace while this notebook is main's.

    A name added this release does not exist in the release the cell installs,
    so importing one breaks setup for every reader until the next release — and
    the failure surfaces as "restart the session", which cannot fix it. Public
    names are the contract that survives the lag; private ones are not, and a
    duplicated fallback copy is a second source of truth that drifts.
    """
    transform = pytest.importorskip(
        "IPython.core.inputtransformer2",
        reason="IPython is a dev-group dependency (via jupyter)",
    ).TransformerManager()

    private = []
    for index, source in _code_cells(path):
        for node in ast.walk(ast.parse(transform.transform_cell(source))):
            if not isinstance(node, ast.ImportFrom) or not node.module:
                continue
            if not node.module.startswith("protspace"):
                continue
            private += [
                f"cell {index}: {node.module}.{alias.name}"
                for alias in node.names
                if alias.name.startswith("_")
            ]
    assert not private, (
        f"{path.name} imports private protspace names: {', '.join(private)}. "
        "Use a public name, or inline the few lines the notebook needs."
    )


def test_preparation_names_each_bundle_distinctly():
    """A fixed download name is what issue #338 reads as a stale projection.

    Two Generate actions land as `data.parquetbundle` and `data (1).parquetbundle`,
    and opening the first shows the first run's coordinates. Structural rather
    than a substring match: the point is that the name carries something from
    this run, not that it is spelled any particular way.
    """
    transform = pytest.importorskip(
        "IPython.core.inputtransformer2",
        reason="IPython is a dev-group dependency (via jupyter)",
    ).TransformerManager()

    values = [
        value
        for _, source in _code_cells(NOTEBOOK_DIR / "ProtSpace_Preparation.ipynb")
        for node in ast.walk(ast.parse(transform.transform_cell(source)))
        for name, value in _assignments(node)
        if name == "output_path"
    ]

    assert values, "the Generate callback assigns no output_path"
    assert all(
        any(isinstance(part, ast.FormattedValue) for part in ast.walk(value))
        for value in values
    ), "every bundle name is a constant, so two runs download the same file name"


@pytest.mark.parametrize("path", NOTEBOOKS, ids=lambda p: p.name)
def test_cells_carry_ids_when_the_format_requires_them(path: Path):
    """nbformat >= 4.5 requires cell ids.

    Without them every open regenerates random ones, so the file shows a diff
    nobody made.
    """
    nb = json.loads(path.read_text())
    if nb["nbformat"] * 100 + nb["nbformat_minor"] < 405:
        pytest.skip(f"{path.name} predates cell ids")
    missing = [i for i, cell in enumerate(nb["cells"]) if not cell.get("id")]
    assert not missing, f"{path.name}: cells {missing} have no id"


class _Widget:
    """Just enough of an ipywidgets widget for a cell to build and read its panel."""

    def __init__(self, *children, **kwargs):
        self.value = kwargs.get("value", "")
        self.options = kwargs.get("options", [])

    def on_click(self, _callback):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False


def _run_preparation_eat_cell(monkeypatch, bundle_path, emb_set, column):
    """Run the Preparation notebook's EAT cell and click Transfer on ``column``.

    The widgets, ``display`` and Colab's ``files`` are stubbed; the protspace
    calls are the real ones, so the cell is exercised against this package.
    """
    import sys
    import types

    widgets = types.ModuleType("ipywidgets")
    for name in ("Button", "Dropdown", "HBox", "HTML", "IntText", "Output", "Text"):
        setattr(widgets, name, _Widget)
    widgets.VBox = _Widget
    monkeypatch.setitem(sys.modules, "ipywidgets", widgets)

    downloads = []
    namespace = {
        "__name__": "__notebook__",
        "Path": Path,
        "display": lambda *_a, **_k: None,
        "clear_output": lambda *_a, **_k: None,
        "files": types.SimpleNamespace(download=downloads.append),
        "_eat_bundle_path": str(bundle_path),
        "_eat_emb_set": emb_set,
    }
    (source,) = [
        source
        for _, source in _code_cells(NOTEBOOK_DIR / "ProtSpace_Preparation.ipynb")
        if "def _on_eat(" in source
    ]
    exec(compile(source, "ProtSpace_Preparation.ipynb:eat", "exec"), namespace)

    namespace["eat_col"].value = column
    namespace["eat_k"].value = 1
    namespace["eat_metric"].value = "cosine"
    namespace["_on_eat"](None)
    return downloads


def test_preparation_eat_cell_writes_a_transferred_bundle(tmp_path, monkeypatch):
    """The EAT cell renames the id column before and after the transfer, which
    drops the cell-grammar stamp; the write refuses an unstamped table, so the
    cell has to restore the grammar it read, as `protspace transfer` does."""
    import types

    import numpy as np
    import pyarrow as pa

    from protspace.data.annotations.encoding import encode_field, stamp_format_version
    from protspace.data.io.bundle import read_tables, write_bundle
    from tests.bundle_v3_helpers import projection_tables

    label = encode_field("Membrane; single-pass")
    annotations = stamp_format_version(
        pa.table({"protein_id": ["p0", "p1", "p2"], "loc": [label, "", "Cytoplasm"]})
    )
    metadata, data = projection_tables(3, (2,))
    bundle = tmp_path / "data.parquetbundle"
    write_bundle([annotations, metadata, data], bundle)
    emb_set = types.SimpleNamespace(
        headers=["p0", "p1", "p2"],
        data=np.array([[1.0, 0.0], [0.9, 0.1], [0.0, 1.0]], dtype=np.float32),
    )

    downloads = _run_preparation_eat_cell(monkeypatch, bundle, emb_set, "loc")

    out = tmp_path / "data.eat.parquetbundle"
    assert downloads == [str(out)]
    transferred = read_tables(out)[0]
    # Encoded once, not twice; v3 hands a missing categorical cell back as "".
    assert transferred.column("loc__pred_value").to_pylist() == ["", label, ""]
    assert transferred.column("loc__pred_source").to_pylist() == ["", "p0", ""]
    assert transferred.column("loc").to_pylist() == [label, "", "Cytoplasm"]


def test_preparation_eat_cell_keeps_an_identifier_annotation(tmp_path, monkeypatch):
    """Beside `protein_id`, `identifier` is an annotation (#551): the cell must not
    rename the ids onto it, which left two `identifier` columns and failed."""
    import types

    import numpy as np
    import pyarrow as pa

    from protspace.data.annotations.encoding import stamp_format_version
    from protspace.data.io.bundle import read_tables, write_bundle
    from tests.bundle_v3_helpers import projection_tables

    annotations = stamp_format_version(
        pa.table(
            {
                "protein_id": ["p0", "p1", "p2"],
                "identifier": ["a0", "a1", "a2"],
                "loc": ["Membrane", "", "Cytoplasm"],
            }
        )
    )
    metadata, data = projection_tables(3, (2,))
    bundle = tmp_path / "data.parquetbundle"
    write_bundle([annotations, metadata, data], bundle)
    emb_set = types.SimpleNamespace(
        headers=["p0", "p1", "p2"],
        data=np.array([[1.0, 0.0], [0.9, 0.1], [0.0, 1.0]], dtype=np.float32),
    )

    downloads = _run_preparation_eat_cell(monkeypatch, bundle, emb_set, "loc")

    out = tmp_path / "data.eat.parquetbundle"
    assert downloads == [str(out)]
    transferred = read_tables(out)[0]
    assert transferred.column("protein_id").to_pylist() == ["p0", "p1", "p2"]
    assert transferred.column("identifier").to_pylist() == ["a0", "a1", "a2"]
    assert transferred.column("loc__pred_source").to_pylist() == ["", "p0", ""]


def test_transfer_notebook_shows_only_the_predicted_rows(tmp_path, monkeypatch):
    """Cell 4 promises the rows that received a label. A v3 read hands a missing
    categorical cell back as "", not null, so the filter cannot test the value
    column for null; the confidence is NaN exactly where nothing was predicted."""
    import pyarrow as pa

    from protspace.data.annotations.encoding import stamp_format_version
    from protspace.data.io.bundle import write_bundle
    from tests.bundle_v3_helpers import projection_tables

    annotations = stamp_format_version(
        pa.table(
            {
                "protein_id": ["p0", "p1", "p2"],
                "fam": ["a", "", "b"],
                "fam__pred_value": [None, "a", None],
                "fam__pred_confidence": pa.array([None, 0.9, None], pa.float32()),
                "fam__pred_source": [None, "p0", None],
            }
        )
    )
    monkeypatch.chdir(tmp_path)
    write_bundle(
        [annotations, *projection_tables(3, (2,))], tmp_path / "results.parquetbundle"
    )

    shown = []
    (source,) = [
        source
        for _, source in _code_cells(NOTEBOOK_DIR / "ProtSpace_Transfer.ipynb")
        if "Read predictions back" in source
    ]
    exec(
        compile(source, "ProtSpace_Transfer.ipynb:4", "exec"), {"display": shown.append}
    )

    (frame,) = shown
    assert frame["fam__pred_value"].tolist() == ["a"]
    assert frame["fam__pred_source"].tolist() == ["p0"]


def test_transfer_notebook_shows_and_saves_the_neighbour_report(
    tmp_path, monkeypatch, capsys
):
    """Step 3 passes `--report predictions.tsv`; step 5 reads that file back, shows
    the nearest queries first, and (outside Colab) says where the file is."""
    from protlabel import Neighbor, Prediction
    from protspace.data.io.predictions import report_rows, write_report

    def prediction(query, distance):
        return Prediction(
            query, "a", "p0", distance, 1 - distance, 1, "cosine",
            neighbors=(Neighbor("p0", "a", distance),),
        )  # fmt: skip

    cells = list(_code_cells(NOTEBOOK_DIR / "ProtSpace_Transfer.ipynb"))
    (run,) = [source for _, source in cells if "Run transfer" in source]
    assert "--report predictions.tsv" in run

    monkeypatch.chdir(tmp_path)
    write_report(
        tmp_path / "predictions.tsv",
        report_rows("fam", [prediction("far", 0.6), prediction("near", 0.1)]),
    )
    (source,) = [source for _, source in cells if "Neighbour report" in source]
    shown = []
    exec(
        compile(source, "ProtSpace_Transfer.ipynb:5", "exec"), {"display": shown.append}
    )

    (frame,) = shown
    assert frame["query_id"].tolist() == ["near", "far"]
    assert "predictions.tsv" in capsys.readouterr().out


# --- The Preparation panel, run for real ------------------------------------------
#
# Cells 1-3 (install, upload, panel) with the installed ipywidgets and a mocked
# `google.colab`; pip is stubbed and the network is refused, so the panel and
# Generate run against this package exactly as in Colab, minus the browser.
# Colab ships ipywidgets 7, the dev lock 8: run this file once more with
# `uv run --with ipywidgets==7.7.1 pytest tests/test_notebooks.py` to cover both.


@pytest.fixture(autouse=True)
def _restore_protspace_logger():
    """The panel routes the `protspace` logger into its output and stops it
    propagating; left that way, every later caplog test would see nothing."""
    import logging

    logger = logging.getLogger("protspace")
    handlers, propagate, level = list(logger.handlers), logger.propagate, logger.level
    yield
    logger.handlers[:] = handlers
    logger.propagate = propagate
    logger.setLevel(level)


def _preparation_cell(marker: str) -> str:
    (source,) = [
        source
        for _, source in _code_cells(NOTEBOOK_DIR / "ProtSpace_Preparation.ipynb")
        if source.startswith(marker)
    ]
    return source


def _clickthrough_h5(path: Path, n: int = 40, dim: int = 16) -> Path:
    """An HDF5 as the Embeddings notebook wrote it before it stamped model_name."""
    import h5py
    import numpy as np

    rng = np.random.default_rng(0)
    with h5py.File(path, "w") as f:
        for i in range(n):
            f.create_dataset(
                f"prot{i:03d}", data=rng.normal(size=dim).astype(np.float32)
            )
    return path


def _colab_upload(uploads):
    """`files.upload` as colabtools writes it: a name that already exists is
    saved as `x (1).h5`, and the result is keyed by the path it was saved to."""

    def upload(target_dir=""):
        saved = {}
        for name, data in uploads.items():
            path, n = Path(target_dir, name), 0
            while path.exists():
                n += 1
                path = Path(target_dir, f"{Path(name).stem} ({n}){Path(name).suffix}")
            path.write_bytes(data)
            saved[str(path)] = data
        return saved

    return upload


def _run_upload_cell(namespace, uploads):
    """Tick the upload cell's box and run it again, as a user would."""
    namespace["files"].upload = _colab_upload(uploads)
    source = _preparation_cell("# @title Optional: upload").replace(
        "upload_from_computer = False", "upload_from_computer = True"
    )
    exec(compile(source, "prep:upload", "exec"), namespace)


def _run_preparation_panel(monkeypatch, tmp_path, *, uploads=None):
    """Run cells 1-3 and return (namespace, downloads, network calls)."""
    pytest.importorskip("ipywidgets")
    pytest.importorskip("IPython")
    import subprocess
    import sys
    import types
    import urllib.request

    monkeypatch.chdir(tmp_path)
    downloads, network = [], []

    colab = types.ModuleType("google.colab")
    colab.files = types.SimpleNamespace(
        download=downloads.append, upload=_colab_upload(uploads or {})
    )
    try:
        import google
    except ImportError:
        google = types.ModuleType("google")
        monkeypatch.setitem(sys.modules, "google", google)
    monkeypatch.setattr(google, "colab", colab, raising=False)
    monkeypatch.setitem(sys.modules, "google.colab", colab)

    def _refuse(*args, **_kwargs):
        network.append(args[0] if args else None)
        raise OSError("network refused in tests")

    monkeypatch.setattr(urllib.request, "urlopen", _refuse)
    monkeypatch.setattr(urllib.request, "urlretrieve", _refuse)

    namespace = {"__name__": "__notebook__"}
    real_run = subprocess.run

    def _pip_or_real(cmd, *args, **kwargs):
        # Only the install is stubbed: imports below may shell out themselves.
        if "pip" in cmd:
            return types.SimpleNamespace(returncode=0, stdout="", stderr="")
        return real_run(cmd, *args, **kwargs)

    with monkeypatch.context() as pip:
        pip.setattr(subprocess, "run", _pip_or_real)
        exec(compile(_preparation_cell("# @title 1."), "prep:1", "exec"), namespace)
    namespace["display"] = lambda *_a, **_k: None
    namespace["clear_output"] = lambda *_a, **_k: None

    upload = _preparation_cell("# @title Optional: upload")
    if uploads:
        upload = upload.replace(
            "upload_from_computer = False", "upload_from_computer = True"
        )
    exec(compile(upload, "prep:upload", "exec"), namespace)
    exec(compile(_preparation_cell("# @title 2."), "prep:2", "exec"), namespace)
    return namespace, downloads, network


def _generate_pca_from_csv(namespace, csv: Path):
    """Generate PCA only, annotations from the CSV alone: nothing to fetch."""
    for method, toggle in namespace["method_toggles"].items():
        toggle.value = method == "PCA"
    namespace["ann_preset"].value = namespace["_CSV_ONLY"]
    namespace["csv_path_field"].value = str(csv)
    namespace["_on_gen"](None)


def _projection_names(bundle) -> list[str]:
    from protspace.data.io.bundle import read_tables

    return read_tables(bundle)[1].column("projection_name").to_pylist()


def test_preparation_panel_is_built_without_the_network(monkeypatch, tmp_path):
    """Run all used to end in an example fetch with no timeout, leaving a dead
    panel behind a slow connection; the fetch now waits for Generate."""
    namespace, _, network = _run_preparation_panel(monkeypatch, tmp_path)
    assert network == []
    assert namespace["input_args"][0]["type"] == "example"


def test_preparation_blocks_a_local_only_embedder_on_biocentral(
    monkeypatch, tmp_path, capsys
):
    """esmc_6b runs only on the local backend: disabled with its remedy on
    Biocentral, dropped at Generate as a backstop, enabled on local."""
    namespace, _, _ = _run_preparation_panel(monkeypatch, tmp_path)
    labels = {v: k for k, v in namespace["_BACKEND_LABELS"].items()}
    box = namespace["emb_cbs"]["esmc_6b"]

    namespace["backend_dropdown"].value = labels["biocentral"]
    assert box.disabled and box.value is False
    assert "esmc_6b" in namespace["backend_note"].value
    assert "switch the backend to Local" in namespace["backend_note"].value
    assert namespace["_drop_incompatible"](["esmc_6b", "prot_t5"], "biocentral") == [
        "prot_t5"
    ]
    assert "Skipping esmc_6b" in capsys.readouterr().out

    namespace["backend_dropdown"].value = labels["local"]
    # Free Colab's RAM blocks it as oversized; this machine's is what decides.
    oversized = namespace["_TOO_BIG_HERE"]
    assert box.disabled is ("esmc_6b" in oversized)


@pytest.mark.parametrize(
    ("probe", "blocked"),
    [
        (False, False),  # free T4 with this package: weights go straight to the GPU
        (True, True),  # no GPU, or no accelerate: host RAM decides
        (None, True),  # a released package without the probe (<= 4.18.0)
    ],
)
def test_preparation_blocks_oversized_only_where_the_load_stages_in_host_ram(
    monkeypatch, tmp_path, probe, blocked
):
    """On free Colab's 12.7 GB, esm2_3b and esmc_6b are blocked only where the
    load would build the model in host RAM; a free T4 loads both onto the GPU."""
    import os

    from protspace.data.embedding import local as local_backend

    if probe is None:
        monkeypatch.delattr(local_backend, "stages_in_host_ram")
    else:
        monkeypatch.setattr(local_backend, "stages_in_host_ram", lambda: probe)
    real_sysconf = os.sysconf
    free_colab_pages = int(12.7e9) // real_sysconf("SC_PAGE_SIZE")
    monkeypatch.setattr(
        os,
        "sysconf",
        lambda name: (
            free_colab_pages if name == "SC_PHYS_PAGES" else real_sysconf(name)
        ),
    )

    namespace, _, _ = _run_preparation_panel(monkeypatch, tmp_path)
    labels = {v: k for k, v in namespace["_BACKEND_LABELS"].items()}
    namespace["backend_dropdown"].value = labels["local"]

    for key in ("esm2_3b", "esmc_6b"):
        assert namespace["emb_cbs"][key].disabled is blocked, key
    assert ("too large for this runtime" in namespace["backend_note"].value) is blocked


def test_preparation_names_an_unnamed_h5_and_generates(monkeypatch, tmp_path, capsys):
    """The Upload-H5 tab never passed a name, so every file without model_name --
    every file the Embeddings notebook wrote -- failed at Generate."""
    namespace, downloads, network = _run_preparation_panel(monkeypatch, tmp_path)
    h5 = _clickthrough_h5(tmp_path / "toxins_esm2_650m.h5")
    csv = tmp_path / "custom.csv"
    csv.write_text(
        "identifier,group\n" + "".join(f"prot{i:03d},g{i % 3}\n" for i in range(40))
    )

    namespace["h5_path_field"].value = str(h5)
    namespace["_on_h5_load"]()
    namespace["tabs"].selected_index = 1
    _generate_pca_from_csv(namespace, csv)

    output = capsys.readouterr().out
    assert "embedding name 'esm2_650m'" in output
    assert "Running on toxins_esm2_650m.h5 (40 proteins" in output
    (bundle,) = downloads
    assert _projection_names(bundle) == ["ESM2-650M — PCA 2"]
    assert network == []
    assert namespace["gen_btn"].disabled is False


def test_preparation_uses_the_embedder_picked_for_an_h5(monkeypatch, tmp_path):
    namespace, downloads, _ = _run_preparation_panel(monkeypatch, tmp_path)
    csv = tmp_path / "custom.csv"
    csv.write_text("identifier,group\nprot000,a\n")
    namespace["h5_path_field"].value = str(_clickthrough_h5(tmp_path / "results.h5"))
    namespace["_on_h5_load"]()
    namespace["h5_name"].value = "prot_t5"
    namespace["tabs"].selected_index = 1
    _generate_pca_from_csv(namespace, csv)

    (bundle,) = downloads
    assert _projection_names(bundle) == ["ProtT5 — PCA 2"]


def test_preparation_upload_cell_hands_the_file_to_the_panel(monkeypatch, tmp_path):
    h5 = _clickthrough_h5(tmp_path / "source.h5")
    namespace, _, _ = _run_preparation_panel(
        monkeypatch, tmp_path, uploads={"seqs_prot_t5.h5": h5.read_bytes()}
    )
    assert namespace["tabs"].selected_index == 1
    assert namespace["input_args"][1]["name"] == "prot_t5"


def test_preparation_reupload_of_a_same_named_file_is_the_one_loaded(
    monkeypatch, tmp_path
):
    """Colab saves a second `toxins.h5` as `toxins (1).h5`; a path built from the
    original name kept the panel on the first upload's embeddings."""
    first = _clickthrough_h5(tmp_path / "first.h5", n=40)
    namespace, _, _ = _run_preparation_panel(
        monkeypatch, tmp_path, uploads={"toxins_esm2_650m.h5": first.read_bytes()}
    )
    corrected = _clickthrough_h5(tmp_path / "corrected.h5", n=25)
    _run_upload_cell(namespace, {"toxins_esm2_650m.h5": corrected.read_bytes()})

    loaded = namespace["input_args"][1]
    assert Path(loaded["path"]).read_bytes() == corrected.read_bytes()
    assert "25 proteins" in loaded["summary"]
    assert loaded["name"] == "esm2_650m"


def test_preparation_h5_tab_shows_no_cli_syntax(monkeypatch, tmp_path, capsys):
    """The resolver's log line says to append `:<model>`, which the path field
    does not take; the tab points at its Embedder dropdown instead."""
    namespace, _, _ = _run_preparation_panel(monkeypatch, tmp_path)
    namespace["h5_path_field"].value = str(_clickthrough_h5(tmp_path / "results.h5"))
    namespace["_on_h5_load"]()

    output = capsys.readouterr().out
    assert "embedding name 'results'" in output
    assert ":<model>" not in output and ":esm2_650m" not in output
    assert "Pick it under Embedder" in output


@pytest.mark.parametrize(
    "file_name",
    ["toxins_esm2_650m.h5", "Ss_mSCR_ESM2_650M.h5", "toxins_prost_t5.h5", "results.h5"],
)
def test_preparation_auto_detect_without_the_resolver_matches_it(
    monkeypatch, tmp_path, file_name
):
    """Cell 1 installs the released protspace, which may predate
    resolve_input_names; the panel's stand-in must name files the same way."""
    import protspace.data.loaders as loaders
    from protspace.data.loaders import resolve_input_names

    h5 = _clickthrough_h5(tmp_path / file_name)
    ((_, expected, _),) = resolve_input_names([(h5, None)], command="prepare")
    monkeypatch.delattr(loaders, "resolve_input_names")

    namespace, _, _ = _run_preparation_panel(monkeypatch, tmp_path)
    assert namespace["resolve_input_names"] is None
    namespace["h5_path_field"].value = str(h5)
    namespace["_on_h5_load"]()

    assert namespace["input_args"][1]["name"] == expected


def test_preparation_disables_generate_while_it_runs(monkeypatch, tmp_path):
    namespace, downloads, _ = _run_preparation_panel(monkeypatch, tmp_path)
    csv = tmp_path / "custom.csv"
    csv.write_text("identifier,group\nprot000,a\n")
    namespace["h5_path_field"].value = str(_clickthrough_h5(tmp_path / "results.h5"))
    namespace["_on_h5_load"]()
    namespace["tabs"].selected_index = 1

    seen, real_load_h5 = [], namespace["load_h5"]

    def _load_h5(*args, **kwargs):
        seen.append(namespace["gen_btn"].disabled)
        return real_load_h5(*args, **kwargs)

    namespace["load_h5"] = _load_h5
    _generate_pca_from_csv(namespace, csv)

    assert seen == [True]
    assert downloads and namespace["gen_btn"].disabled is False


def test_preparation_csv_only_needs_a_csv(monkeypatch, tmp_path, capsys):
    namespace, downloads, network = _run_preparation_panel(monkeypatch, tmp_path)
    namespace["h5_path_field"].value = str(_clickthrough_h5(tmp_path / "results.h5"))
    namespace["_on_h5_load"]()
    namespace["tabs"].selected_index = 1
    namespace["ann_preset"].value = namespace["_CSV_ONLY"]

    namespace["_on_gen"](None)

    assert "CSV only needs a CSV" in capsys.readouterr().out
    assert downloads == [] and network == []


def test_preparation_reads_a_gzipped_csv(monkeypatch, tmp_path):
    import gzip

    namespace, downloads, _ = _run_preparation_panel(monkeypatch, tmp_path)
    csv = tmp_path / "custom.csv.gz"
    csv.write_bytes(gzip.compress(b"identifier,group\nprot000,a\n"))
    namespace["h5_path_field"].value = str(_clickthrough_h5(tmp_path / "results.h5"))
    namespace["_on_h5_load"]()
    namespace["tabs"].selected_index = 1
    _generate_pca_from_csv(namespace, csv)

    assert len(downloads) == 1


@pytest.mark.parametrize("loader", ["current", "released"])
def test_preparation_keeps_empty_csv_cells_empty(monkeypatch, tmp_path, loader):
    """An empty cell, or a protein the CSV leaves out, is missing in the bundle,
    as `prepare -a` makes it, never the label `nan` (#550). The released package
    (protspace <= 4.16) hands empty cells back as NaN, which the panel then
    stringified, and has no `align_annotations`, so the panel's fallback runs."""
    from protspace.core.constants import is_missing_value
    from protspace.data.io.bundle import read_tables
    from protspace.data.processors import pipeline

    if loader == "released":
        fetch = pipeline.ReductionPipeline._fetch_annotations

        def as_nan(self, *args, **kwargs):
            frame = fetch(self, *args, **kwargs)
            return frame.replace("", float("nan"))

        monkeypatch.setattr(pipeline.ReductionPipeline, "_fetch_annotations", as_nan)
        monkeypatch.delattr(pipeline, "align_annotations")

    namespace, downloads, _ = _run_preparation_panel(monkeypatch, tmp_path)
    csv = tmp_path / "custom.csv"
    csv.write_text("identifier,group,note\nprot000,a,\nprot001,,x\n")
    namespace["h5_path_field"].value = str(_clickthrough_h5(tmp_path / "results.h5"))
    namespace["_on_h5_load"]()
    namespace["tabs"].selected_index = 1
    _generate_pca_from_csv(namespace, csv)

    (bundle,) = downloads
    rows = {r["protein_id"]: r for r in read_tables(bundle)[0].to_pylist()}
    assert rows["prot000"]["group"] == "a" and rows["prot001"]["note"] == "x"
    for pid, column in [
        ("prot000", "note"),
        ("prot001", "group"),
        ("prot002", "group"),
    ]:
        assert is_missing_value(rows[pid][column]), (pid, column, rows[pid][column])
    cells = {v for r in rows.values() for k, v in r.items() if k != "protein_id"}
    assert "nan" not in cells


def test_preparation_reports_a_failed_example_fetch(monkeypatch, tmp_path, capsys):
    """The network is refused here, as on a dead connection: Generate says so
    and gives the button back."""
    namespace, downloads, network = _run_preparation_panel(monkeypatch, tmp_path)

    namespace["_on_gen"](None)

    assert len(network) == 1
    assert "Fetch failed" in capsys.readouterr().out
    assert downloads == [] and namespace["gen_btn"].disabled is False
    assert not list(tmp_path.glob("*.part"))


def test_preparation_records_the_metric_picked(monkeypatch, tmp_path):
    import json as _json

    from protspace.data.io.bundle import read_tables

    namespace, downloads, _ = _run_preparation_panel(monkeypatch, tmp_path)
    csv = tmp_path / "custom.csv"
    csv.write_text(
        "identifier,group\n" + "".join(f"prot{i:03d},g{i % 3}\n" for i in range(40))
    )
    namespace["h5_path_field"].value = str(_clickthrough_h5(tmp_path / "results.h5"))
    namespace["_on_h5_load"]()
    namespace["tabs"].selected_index = 1
    for method, toggle in namespace["method_toggles"].items():
        toggle.value = method == "UMAP"
    namespace["pw"]["metric"].value = "cosine"
    namespace["ann_preset"].value = namespace["_CSV_ONLY"]
    namespace["csv_path_field"].value = str(csv)
    namespace["_on_gen"](None)

    (bundle,) = downloads
    (info,) = read_tables(bundle)[1].column("info_json").to_pylist()
    assert _json.loads(info)["metric"] == "cosine"


def test_preparation_refuses_an_empty_tab_instead_of_the_example(
    monkeypatch, tmp_path, capsys
):
    """A failed upload used to leave the auto-selected example as the input, and
    Generate processed 536 example proteins without a word."""
    namespace, downloads, network = _run_preparation_panel(monkeypatch, tmp_path)
    namespace["tabs"].selected_index = 1

    namespace["_on_gen"](None)

    assert "Upload H5 tab has no file loaded" in capsys.readouterr().out
    assert downloads == [] and network == []


def test_preparation_says_when_no_file_arrived(monkeypatch, tmp_path, capsys):
    namespace, _, _ = _run_preparation_panel(monkeypatch, tmp_path)
    namespace["h5_path_field"].value = str(tmp_path / "missing.h5")
    namespace["_on_h5_load"]()
    assert "No file received at" in capsys.readouterr().out
    assert 1 not in namespace["input_args"]


def test_preparation_parameter_defaults_are_the_clis(monkeypatch, tmp_path):
    """The same data should give the same UMAP in Colab and in the CLI; the panel's
    min_dist once defaulted to 0.4 against the CLI's 0.1."""
    from dataclasses import asdict

    from protspace.data.processors.pipeline import ReducerParams

    namespace, _, _ = _run_preparation_panel(monkeypatch, tmp_path)
    cli = asdict(ReducerParams())
    assert {k: w.value for k, w in namespace["pw"].items()} == {
        k: cli[k] for k in namespace["pw"]
    }


@pytest.mark.parametrize(
    "value",
    [
        {"ann.csv": {"content": b"identifier\n", "metadata": {}}},  # ipywidgets 7
        ({"name": "ann.csv", "content": memoryview(b"identifier\n")},),  # ipywidgets 8
    ],
    ids=["ipywidgets7", "ipywidgets8"],
)
def test_preparation_reads_both_fileupload_value_shapes(monkeypatch, tmp_path, value):
    import types

    namespace, _, _ = _run_preparation_panel(monkeypatch, tmp_path)
    upload = types.SimpleNamespace(value=value)
    assert namespace["_first_upload"](upload) == ("ann.csv", b"identifier\n")


def test_preparation_csv_upload_fills_the_path_field(monkeypatch, tmp_path):
    """Through the installed ipywidgets' own FileUpload, as the browser sends it."""
    import ipywidgets

    namespace, _, _ = _run_preparation_panel(monkeypatch, tmp_path)
    upload, content = namespace["csv_upload"], b"identifier,group\nprot000,a\n"
    if ipywidgets.__version__.startswith("7."):
        meta = {"name": "ann.csv", "type": "", "size": len(content), "lastModified": 0}
        upload.set_trait("metadata", [meta])
        upload.set_trait("data", [content])
        upload.set_trait("_counter", upload._counter + 1)
    else:
        from datetime import UTC, datetime

        upload.value = (
            {
                "name": "ann.csv",
                "type": "text/csv",
                "size": len(content),
                "last_modified": datetime.now(UTC),
                "content": memoryview(content),
            },
        )

    assert namespace["csv_path_field"].value == str(tmp_path / "ann.csv")
    assert (tmp_path / "ann.csv").read_bytes() == content


def test_clickthrough_stamps_the_model_name():
    """Without the attribute, ProtSpace can only guess the model from the file name."""
    stamped = [
        node
        for _, source in _code_cells(
            NOTEBOOK_DIR / "ClickThrough_GenerateEmbeddings.ipynb"
        )
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.Assign)
        and any(
            isinstance(t, ast.Subscript)
            and isinstance(t.value, ast.Attribute)
            and t.value.attr == "attrs"
            and isinstance(t.slice, ast.Constant)
            and t.slice.value == "model_name"
            for t in node.targets
        )
    ]
    assert stamped, "the Embeddings notebook writes no model_name attribute"
