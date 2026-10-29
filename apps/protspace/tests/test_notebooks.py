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
import re
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


# The notebooks that install anything. The Embeddings notebook installs nothing:
# every model it offers runs on Colab's own torch and transformers.
INSTALLING_NOTEBOOKS = [
    p for p in NOTEBOOKS if "_loaded_distributions" in p.read_text()
]


def _install_cell(path: Path) -> str:
    """The install cell up to its import block, which needs Colab."""
    (source,) = [src for _, src in _code_cells(path) if "_loaded_distributions" in src]
    return source.split("# A preloaded module")[0]


@pytest.mark.parametrize("path", INSTALLING_NOTEBOOKS, ids=lambda p: p.name)
def test_install_cell_stops_when_pip_changed_a_loaded_package(path, monkeypatch):
    """Colab had numpy loaded when pip upgraded it; the cell's imports passed and
    Generate failed on `_blas_supports_fpe` until a manual restart."""
    import importlib.metadata as md
    import subprocess
    import sys
    import types
    from pathlib import PurePosixPath

    disk = {"fakepkg": "1.0", "nsdist": "1.0"}
    upgrade = {"to": "2.0"}

    def pip(cmd, *_a, **_k):
        assert "pip" in cmd
        if upgrade["to"]:
            disk.update(fakepkg=upgrade["to"], nsdist=upgrade["to"])
        return types.SimpleNamespace(returncode=0, stdout="", stderr="")

    loaded = types.ModuleType("fakepkg")
    loaded.__file__ = "/site-packages/fakepkg/__init__.py"
    # A namespace package (no __file__) shared by many distributions, as `google`
    # is in Colab: nsdist's subpackage is not loaded, so its upgrade is harmless.
    namespace_pkg = types.ModuleType("nsfake")
    monkeypatch.setitem(sys.modules, "fakepkg", loaded)
    monkeypatch.setitem(sys.modules, "nsfake", namespace_pkg)
    monkeypatch.setattr(
        md,
        "packages_distributions",
        lambda: {"fakepkg": ["fakepkg"], "nsfake": ["nsdist"]},
    )
    monkeypatch.setattr(md, "version", lambda dist: disk[dist])
    monkeypatch.setattr(
        md, "distribution",
        lambda dist: types.SimpleNamespace(files=[PurePosixPath("nsfake/sub/__init__.py")]),
    )  # fmt: skip
    monkeypatch.setattr(subprocess, "run", pip)
    source = compile(_install_cell(path), f"{path.name}:install", "exec")

    session = {"__name__": "__notebook__"}
    with pytest.raises(SystemExit, match=r"fakepkg \(1\.0 \u2192 2\.0\)") as stopped:
        exec(source, session)
    assert "Restart session" in str(stopped.value)
    assert "nsdist" not in str(stopped.value)

    upgrade["to"] = None  # pip finds nothing left to do, the old copy is still loaded
    with pytest.raises(SystemExit, match="fakepkg"):
        exec(source, session)

    exec(source, {"__name__": "__notebook__"})  # after the restart


def _install_helper(path: Path) -> str:
    source = _install_cell(path)
    start = source.index("# --- install helper:")
    end = source.index("# --- end of install helper ---")
    return source[start:end]


def test_install_helper_is_the_same_in_every_notebook():
    """One fix, one copy per notebook that installs: a notebook cannot import a
    shared module before it has installed one, so the copies are kept equal here."""
    helpers = {path.name: _install_helper(path) for path in INSTALLING_NOTEBOOKS}
    assert len(helpers) >= 2, sorted(helpers)
    assert len(set(helpers.values())) == 1, sorted(helpers)


def _run_install_helper(monkeypatch, *, uv_fails=False):
    """Call the helper with Colab's numpy "loaded"; return the commands run."""
    import importlib.metadata as md
    import subprocess
    import sys
    import types

    loaded = types.ModuleType("fakenumpy")
    loaded.__file__ = "/site-packages/fakenumpy/__init__.py"
    monkeypatch.setitem(sys.modules, "fakenumpy", loaded)
    monkeypatch.setattr(md, "packages_distributions", lambda: {"fakenumpy": ["numpy"]})
    monkeypatch.setattr(md, "version", lambda dist: "2.1.3")
    calls, held = [], []

    def run(cmd, *_a, **_k):
        calls.append(cmd)
        if "--override" in cmd:
            held.append(Path(cmd[cmd.index("--override") + 1]).read_text())
            code = 1 if uv_fails else 0
        else:
            code = 0
        return types.SimpleNamespace(returncode=code, stdout="", stderr="")

    monkeypatch.setattr(subprocess, "run", run)
    namespace = {"__name__": "__notebook__"}
    exec(
        compile(_install_helper(INSTALLING_NOTEBOOKS[0]), "install", "exec"), namespace
    )
    namespace["_install"](["protspace[local]"])
    return calls, held


def test_install_holds_what_the_session_loaded(monkeypatch):
    """biocentral-api 2.x pins numpy>=2.4.1 through biotrainer-core; uv's
    --override keeps the numpy Colab has in memory instead of replacing it."""
    calls, held = _run_install_helper(monkeypatch)
    assert held == ["numpy==2.1.3\n"]
    assert [c[2:5] for c in calls] == [
        ["pip", "install", "-qqq"],
        ["uv", "pip", "install"],
    ]
    assert calls[-1][-1] == "protspace[local]"


def test_install_falls_back_to_pip_when_uv_cannot_hold(monkeypatch):
    calls, _ = _run_install_helper(monkeypatch, uv_fails=True)
    assert calls[-1][2:4] == ["pip", "install"] and calls[-1][-1] == "protspace[local]"


def _run_preparation_eat_cell(
    monkeypatch, bundle_path, emb_set, column, before_click=None, **controls
):
    """Run the Preparation notebook's EAT cell and click Transfer on ``column``.

    Real widgets; ``display``, the panel's HTML helpers and Colab's ``files`` are
    stubbed, and the protspace calls are the real ones, so the cell is exercised
    against this package. ``controls`` sets EAT widgets by name before the click
    (``eat_k=3``, ``eat_skip=True``). Returns (downloads, namespace).
    """
    import html
    import types

    pytest.importorskip("ipywidgets")
    downloads = []
    namespace = {
        "__name__": "__notebook__",
        "Path": Path,
        "display": lambda *_a, **_k: None,
        "clear_output": lambda *_a, **_k: None,
        "IHTML": lambda html_text: html_text,
        "_card": lambda kind, text: f"[{kind}] {text}",
        "_hint": lambda text: text,
        "_esc": lambda value: html.escape(str(value), quote=False),
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
    for name, value in controls.items():
        namespace[name].value = value
    if before_click is not None:
        before_click(namespace)
    namespace["_on_eat"](None)
    return downloads, namespace


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

    downloads, _ = _run_preparation_eat_cell(
        monkeypatch, bundle, emb_set, "loc", eat_cutoff="off"
    )

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

    downloads, _ = _run_preparation_eat_cell(
        monkeypatch, bundle, emb_set, "loc", eat_cutoff="off"
    )

    out = tmp_path / "data.eat.parquetbundle"
    assert downloads == [str(out)]
    transferred = read_tables(out)[0]
    assert transferred.column("protein_id").to_pylist() == ["p0", "p1", "p2"]
    assert transferred.column("identifier").to_pylist() == ["a0", "a1", "a2"]
    assert transferred.column("loc__pred_source").to_pylist() == ["", "p0", ""]


def _toxin_only_bundle(tmp_path):
    """References all one family, one query beside them and one far from both:
    the setup that gave an external user "every unknown is a toxin"."""
    import types

    import numpy as np
    import pyarrow as pa

    from protspace.data.annotations.encoding import stamp_format_version
    from protspace.data.io.bundle import write_bundle
    from tests.bundle_v3_helpers import projection_tables

    # p0, p1: the references; p2 sits beside them, p3 is far from both.
    ids = ["p0", "p1", "p2", "p3"]
    annotations = stamp_format_version(
        pa.table({"protein_id": ids, "fam": ["toxin", "toxin", "", ""]})
    )
    bundle = tmp_path / "data.parquetbundle"
    write_bundle([annotations, *projection_tables(4, (2,))], bundle)
    vectors = [[1.0, 0.0], [0.99, 0.14], [0.98, 0.2], [-1.0, 0.05]]
    emb_set = types.SimpleNamespace(headers=ids, data=np.array(vectors, np.float32))
    return bundle, emb_set


def test_preparation_eat_cell_marks_distant_queries_by_default(tmp_path, monkeypatch):
    """The cell calibrates a cutoff unless told otherwise, says how many queries
    are distant, and offers the neighbour report as a download."""
    from protspace.data.io.bundle import read_tables

    bundle, emb_set = _toxin_only_bundle(tmp_path)
    downloads, ns = _run_preparation_eat_cell(monkeypatch, bundle, emb_set, "fam")

    out = tmp_path / "data.eat.parquetbundle"
    report = tmp_path / "data.eat.neighbours.tsv"
    assert downloads == [str(out)]
    table = read_tables(out)[0].to_pydict()
    neighbor = dict(zip(table["protein_id"], table["fam__neighbor"], strict=True))
    assert (neighbor["p2"], neighbor["p3"]) == ("near", "distant")
    predicted = dict(zip(table["protein_id"], table["fam__pred_value"], strict=True))
    # Marked, not withheld: the label is still there for the user to judge.
    assert predicted["p3"] == "toxin"
    assert "1 of 2 queries near a reference, 1 distant" in ns["eat_status"].value

    assert ns["eat_report_btn"].disabled is False
    ns["_on_eat_report"](None)
    assert downloads == [str(out), str(report)]
    assert report.read_text().splitlines()[0].split("\t")[:2] == ["column", "query_id"]


def test_preparation_eat_cell_can_leave_distant_queries_unpredicted(
    tmp_path, monkeypatch
):
    from protspace.data.io.bundle import read_tables

    bundle, emb_set = _toxin_only_bundle(tmp_path)
    _, ns = _run_preparation_eat_cell(
        monkeypatch, bundle, emb_set, "fam", eat_skip=True
    )

    table = read_tables(tmp_path / "data.eat.parquetbundle")[0].to_pydict()
    predicted = dict(zip(table["protein_id"], table["fam__pred_value"], strict=True))
    assert (predicted["p2"], predicted["p3"]) == ("toxin", "")
    assert "left unpredicted" in ns["eat_status"].value


def test_preparation_eat_cell_runs_on_a_release_without_the_cutoff(
    tmp_path, monkeypatch
):
    """Cell 1 installs the released protspace, whose run_transfer (4.16.8) has no
    cutoff or report: the cell transfers without them and says what is missing."""
    import protspace.cli.transfer as transfer
    import protspace.data.io.predictions as predictions

    current = transfer.run_transfer

    def released(
        *, annotations, embeddings, transfer_columns, query_rule, reference_rule,
        k=1, metric="cosine", format_version=2,
    ):  # fmt: skip
        return current(
            annotations=annotations, embeddings=embeddings,
            transfer_columns=transfer_columns, query_rule=query_rule,
            reference_rule=reference_rule, k=k, metric=metric,
            format_version=format_version,
        )  # fmt: skip

    monkeypatch.setattr(transfer, "run_transfer", released)
    monkeypatch.delattr(predictions, "write_report")
    bundle, emb_set = _toxin_only_bundle(tmp_path)
    downloads, ns = _run_preparation_eat_cell(monkeypatch, bundle, emb_set, "fam")

    assert downloads == [str(tmp_path / "data.eat.parquetbundle")]
    assert ns["eat_cutoff"].disabled and ns["eat_skip"].disabled
    assert ns["eat_report_btn"].disabled
    assert "need a protspace newer than" in ns["eat_status"].value


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
    (tmp_path / "predictions.tsv").write_text("")  # step 3 finished

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
    assert "embedding name 'esm2_650m'" in namespace["h5_status"].value
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
    does not take; the tab points at its Model dropdown instead."""
    namespace, _, _ = _run_preparation_panel(monkeypatch, tmp_path)
    namespace["h5_path_field"].value = str(_clickthrough_h5(tmp_path / "results.h5"))
    namespace["_on_h5_load"]()

    output = capsys.readouterr().out + namespace["h5_status"].value
    assert "embedding name 'results'" in output
    assert ":&lt;model&gt;" not in output and ":<model>" not in output
    assert ":esm2_650m" not in output
    assert "Pick it under Model" in output


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

    assert "No .h5 loaded" in capsys.readouterr().out
    assert downloads == [] and network == []


def test_preparation_says_when_no_file_arrived(monkeypatch, tmp_path, capsys):
    namespace, _, _ = _run_preparation_panel(monkeypatch, tmp_path)
    namespace["h5_path_field"].value = str(tmp_path / "missing.h5")
    namespace["_on_h5_load"]()
    assert "No file received at" in namespace["h5_status"].value
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


def test_preparation_sliders_stay_within_the_config(monkeypatch, tmp_path):
    """The perplexity slider went to 500 while protspace takes 5 to 50, so t-SNE
    failed at Generate after the embeddings and annotations were done."""
    from dataclasses import fields

    from protspace.utils.constants import DimensionReductionConfig

    namespace, _, _ = _run_preparation_panel(monkeypatch, tmp_path)
    bounds = {f.name: f.metadata for f in fields(DimensionReductionConfig)}
    sliders = {k: w for k, w in namespace["pw"].items() if hasattr(w, "min")}
    assert set(sliders) == set(namespace["pw"]) - {"metric"}
    for name, slider in sliders.items():
        meta = bounds[name]
        assert slider.min >= meta.get("gte", slider.min), name
        assert slider.min > meta.get("gt", slider.min - 1), name
        assert slider.max <= meta.get("lte", slider.max), name
        assert slider.max < meta.get("lt", slider.max + 1), name
        for value in (slider.min, slider.max):
            DimensionReductionConfig(**{name: value})
    assert isinstance(namespace["pw"]["perplexity"].value, int)


def test_preparation_slider_defaults_sit_on_their_step_grid(monkeypatch, tmp_path):
    """The browser snaps a slider to min + k * step: learning_rate (min 1, step 10)
    showed the CLI's 200 as 201, and moved it there on the first touch."""
    namespace, _, _ = _run_preparation_panel(monkeypatch, tmp_path)
    for name, slider in namespace["pw"].items():
        if not hasattr(slider, "step"):
            continue
        steps = (slider.value - slider.min) / slider.step
        assert abs(steps - round(steps)) < 1e-9, (name, slider.value, slider.min)


def _string_constants(root: Path) -> list[str]:
    """Every string literal under *root*, adjacent pieces joined as Python joins them."""
    found = []
    for py in root.rglob("*.py"):
        for node in ast.walk(ast.parse(py.read_text())):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                found.append(node.value)
    return found


def test_preparation_panel_wording_matches_the_package(monkeypatch, tmp_path, capsys):
    """Log lines told Colab users to pass `--refetch` and `-f`. The panel
    rewrites each such phrase; a phrase the package no longer says would leave
    its replacement dead, so each is pinned to the package's source."""
    import logging

    import protspace

    namespace, _, _ = _run_preparation_panel(monkeypatch, tmp_path)
    source = _string_constants(Path(protspace.__file__).parent)
    for cli in namespace["_PANEL_WORDING"]:
        assert any(cli in text for text in source), f"no longer in the package: {cli!r}"

    logging.getLogger("protspace.data.annotations.cache").warning(
        "All cached annotations are empty. Use --refetch annotations to re-fetch, "
        "or provide a FASTA file with -f."
    )
    output = capsys.readouterr().out
    assert "--refetch" not in output and " -f" not in output
    assert "Fetch annotations again" in output


def test_preparation_accession_pattern_is_the_retrievers(monkeypatch, tmp_path):
    import inspect

    from protspace.data.annotations.retrievers.uniprot_retriever import (
        UniProtRetriever,
    )

    (pattern,) = [
        node.args[0].value
        for node in ast.walk(ast.parse(inspect.getsource(UniProtRetriever)))
        if isinstance(node, ast.Call)
        and getattr(node.func, "attr", None) == "compile"
        and isinstance(node.args[0], ast.Constant)
    ]
    namespace, _, _ = _run_preparation_panel(monkeypatch, tmp_path)
    assert namespace["_UNIPROT_ACCESSION"].pattern == pattern


@pytest.mark.parametrize("with_csv", [True, False], ids=["csv", "no-csv"])
def test_preparation_skips_uniprot_when_no_id_is_an_accession(
    monkeypatch, tmp_path, with_csv
):
    """5,035 TRINITY_/sp| IDs and the Default annotations: the run fetched from
    UniProt for nothing and cached the empty result for every later run."""
    from protspace.data.io.bundle import read_tables

    namespace, downloads, network = _run_preparation_panel(monkeypatch, tmp_path)
    namespace["h5_path_field"].value = str(_clickthrough_h5(tmp_path / "results.h5"))
    namespace["tabs"].selected_index = 1
    for method, toggle in namespace["method_toggles"].items():
        toggle.value = method == "PCA"
    if with_csv:
        csv = tmp_path / "custom.csv"
        csv.write_text("identifier,group\nprot000,a\n")
        namespace["csv_path_field"].value = str(csv)
    namespace["_on_gen"](None)

    status = namespace["gen_status"].value
    assert "is a UniProt accession" in status
    assert ("custom CSV alone" if with_csv else "no annotations") in status
    (bundle,) = downloads
    columns = read_tables(bundle)[0].column_names
    assert ("group" in columns) is with_csv
    assert network == []


def test_preparation_restores_its_settings_after_a_restart(monkeypatch, tmp_path):
    """A restart (the install cell may ask for one) cleared every field."""
    namespace, _, _ = _run_preparation_panel(monkeypatch, tmp_path)
    h5 = _clickthrough_h5(tmp_path / "results_esm2_650m.h5")
    csv = tmp_path / "custom.csv"
    csv.write_text("identifier,group\nprot000,a\n")
    namespace["h5_path_field"].value = str(h5)
    namespace["tabs"].selected_index = 1
    namespace["pw"]["n_neighbors"].value = 40
    _generate_pca_from_csv(namespace, csv)

    restarted, _, _ = _run_preparation_panel(monkeypatch, tmp_path)
    assert restarted["tabs"].selected_index == 1
    assert restarted["input_args"][1]["path"] == str(h5)
    assert restarted["input_args"][1]["name"] == "esm2_650m"
    assert [m for m, t in restarted["method_toggles"].items() if t.value] == ["PCA"]
    assert restarted["pw"]["n_neighbors"].value == 40
    assert restarted["ann_preset"].value == restarted["_CSV_ONLY"]
    assert restarted["csv_path_field"].value == str(csv)
    assert "Restored the settings" in restarted["gen_status"].value


def test_preparation_loads_the_newest_upload_after_a_restart(monkeypatch, tmp_path):
    h5 = _clickthrough_h5(tmp_path / "source.h5")
    _run_preparation_panel(
        monkeypatch, tmp_path, uploads={"seqs_prot_t5.h5": h5.read_bytes()}
    )
    restarted, _, _ = _run_preparation_panel(monkeypatch, tmp_path)
    assert restarted["tabs"].selected_index == 1
    assert restarted["input_args"][1]["name"] == "prot_t5"


@pytest.mark.parametrize(
    ("error", "advice"),
    [
        (
            AttributeError(
                "module 'numpy._core._multiarray_umath' has no attribute "
                "'_blas_supports_fpe'"
            ),
            "Restart session",
        ),
        (ValueError("perplexity must be less than n_samples"), "Change perplexity"),
        (RuntimeError("something new"), "UniProt accessions"),
    ],
    ids=["stale-numpy", "parameter", "unknown"],
)
def test_preparation_failure_advice_matches_the_error(
    monkeypatch, tmp_path, error, advice
):
    """Every failure printed the same UniProt/Biocentral/caching list, the numpy
    and perplexity failures included."""
    namespace, downloads, _ = _run_preparation_panel(monkeypatch, tmp_path)
    namespace["h5_path_field"].value = str(_clickthrough_h5(tmp_path / "results.h5"))
    namespace["tabs"].selected_index = 1

    def fail(*_a, **_k):
        raise error

    namespace["load_h5"] = fail
    namespace["_on_gen"](None)

    status = namespace["gen_status"].value
    assert "Generate failed at step 1 of 5, loading the embeddings" in status
    assert advice in status
    if advice != "UniProt accessions":
        assert "UniProt accessions" not in status
    assert downloads == [] and namespace["gen_btn"].disabled is False


def test_preparation_new_path_clears_the_old_status(monkeypatch, tmp_path):
    """After the upload cell filled the path, the tab still showed the previous
    path's "No file received", which read like an error about the new file."""
    namespace, _, _ = _run_preparation_panel(monkeypatch, tmp_path)
    namespace["h5_path_field"].value = str(tmp_path / "file.h5")
    assert "No file received" in namespace["h5_status"].value

    h5 = _clickthrough_h5(tmp_path / "up.h5")
    namespace["_use_uploaded"]("h5", str(h5))
    assert "No file received" not in namespace["h5_status"].value
    assert "Ready: up.h5" in namespace["h5_status"].value

    namespace["h5_path_field"].value = ""
    assert namespace["h5_status"].value == "" and 1 not in namespace["input_args"]


def test_preparation_generate_refreshes_the_eat_columns(monkeypatch, tmp_path):
    """The EAT cell's target list stayed empty until 'Reload columns'."""
    namespace, _, _ = _run_preparation_panel(monkeypatch, tmp_path)
    exec(compile(_preparation_cell("# @title 3."), "prep:3", "exec"), namespace)
    assert namespace["eat_col"].options == ()
    csv = tmp_path / "custom.csv"
    csv.write_text("identifier,group\nprot000,a\n")
    namespace["h5_path_field"].value = str(_clickthrough_h5(tmp_path / "results.h5"))
    namespace["tabs"].selected_index = 1
    _generate_pca_from_csv(namespace, csv)

    assert "group" in [value for _, value in namespace["eat_col"].options]


def test_preparation_progress_reads_the_packages_log_lines(monkeypatch, tmp_path):
    """The reduction step counts projections from protspace's own log lines; a
    reworded line would leave the bar stuck, so both templates are pinned."""
    import protspace.data.processors.pipeline as pipeline

    source = Path(pipeline.__file__).read_text()
    assert "Applying {method.upper()} {dims} to '{emb_set.name}'" in source
    assert "Using cached %s %d projection for '%s'" in source
    namespace, _, _ = _run_preparation_panel(monkeypatch, tmp_path)
    pattern = namespace["_PROJECTION_LOG"]
    assert pattern.match("Applying UMAP 2 to 'esm2_650m'").group("a") == "UMAP 2"
    cached = "Using cached %s %d projection for '%s'" % ("PCA", 2, "prot_t5")  # noqa: UP031 -- as logging formats it
    assert pattern.match(cached).group("c") == "PCA 2"


def test_preparation_shows_each_step_and_ends_full(monkeypatch, tmp_path):
    """From click to file, the run says which step of how many it is on."""
    namespace, downloads, _ = _run_preparation_panel(monkeypatch, tmp_path)
    csv = tmp_path / "custom.csv"
    csv.write_text("identifier,group\nprot000,a\n")
    namespace["h5_path_field"].value = str(_clickthrough_h5(tmp_path / "results.h5"))
    namespace["tabs"].selected_index = 1
    for method, toggle in namespace["method_toggles"].items():
        toggle.value = method in {"PCA", "UMAP"}
    namespace["ann_preset"].value = namespace["_CSV_ONLY"]
    namespace["csv_path_field"].value = str(csv)

    shown, render = [], namespace["_Progress"]._render

    def record(self):
        render(self)
        shown.append(namespace["gen_status"].value)

    monkeypatch.setattr(namespace["_Progress"], "_render", record)
    namespace["_on_gen"](None)

    steps = [re.search(r"Step (\d) of (\d) \u00b7 ([^&]+)", v).groups() for v in shown]
    assert ("1", "5", "Loading the embeddings") in steps
    assert ("3", "5", "Reducing dimensions (PCA 2, 1 of 2)") in steps
    assert ("3", "5", "Reducing dimensions (UMAP 2, 2 of 2)") in steps
    assert any(label.startswith("Preparing the download") for *_, label in steps)
    bar = namespace["gen_progress"]
    assert (bar.value, bar.bar_style) == (bar.max, "success")
    assert "Download started" in namespace["gen_status"].value
    (bundle,) = downloads
    assert Path(bundle).parent.name == "output"


def test_preparation_offers_every_bundle_for_download(monkeypatch, tmp_path):
    """A run with a CSV reaches files.download like any other; the bundle also
    stays one click away, for a download that is slow or held back."""
    namespace, downloads, _ = _run_preparation_panel(monkeypatch, tmp_path)
    assert namespace["bundles_box"].layout.display == "none"
    csv = tmp_path / "custom.csv"
    csv.write_text("identifier,group\nprot000,a\n")
    namespace["h5_path_field"].value = str(_clickthrough_h5(tmp_path / "results.h5"))
    namespace["tabs"].selected_index = 1
    _generate_pca_from_csv(namespace, csv)

    (bundle,) = downloads
    assert bundle.endswith(".parquetbundle")
    assert namespace["bundles_box"].layout.display == ""
    assert namespace["bundle_pick"].value == str(Path(bundle))
    namespace["_on_bundle_download"](None)
    assert downloads == [bundle, str(Path(bundle))]


def test_preparation_refuses_a_perplexity_the_input_cannot_support(
    monkeypatch, tmp_path
):
    """t-SNE needs perplexity below the protein count; the default 30 on 20
    proteins failed in scikit-learn after the embeddings and annotations."""
    namespace, downloads, _ = _run_preparation_panel(monkeypatch, tmp_path)
    namespace["h5_path_field"].value = str(_clickthrough_h5(tmp_path / "s.h5", n=20))
    namespace["tabs"].selected_index = 1
    for method, toggle in namespace["method_toggles"].items():
        toggle.value = method == "t-SNE"
    assert "not below the number of proteins (20)" in namespace["param_check"].value

    loaded = []
    namespace["load_h5"] = lambda *a, **k: loaded.append(a)
    namespace["_on_gen"](None)
    assert "Not started" in namespace["gen_status"].value
    assert loaded == [] and downloads == []

    namespace["pw"]["perplexity"].value = 6
    assert namespace["param_check"].value == ""


def test_preparation_eat_lists_only_columns_it_can_fill(tmp_path, monkeypatch):
    """After Generate the target preselected `ec`, empty for every protein of a
    non-UniProt dataset; a transfer on it could do nothing."""
    import pyarrow as pa

    from protspace.data.annotations.encoding import stamp_format_version
    from protspace.data.io.bundle import write_bundle
    from tests.bundle_v3_helpers import projection_tables

    bundle, emb_set = _toxin_only_bundle(tmp_path)
    annotations = stamp_format_version(
        pa.table(
            {
                "protein_id": ["p0", "p1", "p2", "p3"],
                "fam": ["toxin", "toxin", "", ""],
                "ec": ["", "", "", ""],
                "kind": ["a", "b", "a", "b"],
            }
        )
    )
    write_bundle([annotations, *projection_tables(4, (2,))], bundle)
    _, ns = _run_preparation_eat_cell(monkeypatch, bundle, emb_set, None)

    assert ns["eat_col"].options == (
        ("Pick an annotation\u2026", None),
        ("fam (2 set / 2 missing)", "fam"),
    )
    assert ns["eat_col"].value is None
    assert (
        "Not listed: ec, kind" in ns["eat_status"].value
        or "Pick the annotation" in ns["eat_status"].value
    )


def test_preparation_eat_disables_its_button_while_it_runs(tmp_path, monkeypatch):
    """A long transfer looked stuck and invited a second click; the button is
    off while it runs, as Generate's is, and the status says when it finished."""
    import protspace.cli.transfer as transfer

    seen, real = [], transfer.run_transfer
    bundle, emb_set = _toxin_only_bundle(tmp_path)

    def watch(namespace):
        def run(**kwargs):
            seen.append(namespace["eat_btn"].disabled)
            return real(**kwargs)

        monkeypatch.setattr(transfer, "run_transfer", run)
        namespace["run_transfer"] = run

    _, ns = _run_preparation_eat_cell(
        monkeypatch, bundle, emb_set, "fam", before_click=watch
    )
    assert seen == [True] and ns["eat_btn"].disabled is False
    assert "Done in" in ns["eat_status"].value


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


def _clickthrough_main() -> str:
    """The Embeddings notebook's one cell: settings, helpers and `_run()`."""
    (source,) = [
        src
        for _, src in _code_cells(
            NOTEBOOK_DIR / "ClickThrough_GenerateEmbeddings.ipynb"
        )
        if "def _run(" in src
    ]
    return source


def _clickthrough_namespace(**settings) -> dict:
    """The cell run as the tests import it: everything defined, nothing run."""
    namespace = {"__name__": "__notebook__"}
    exec(compile(_clickthrough_main(), "click:embed", "exec"), namespace)
    namespace.update(settings)
    return namespace


def test_clickthrough_is_one_cell_and_offers_every_model_it_maps():
    """Settings, setup and the run live in one cell: change a setting, run it once."""
    cells = list(_code_cells(NOTEBOOK_DIR / "ClickThrough_GenerateEmbeddings.ipynb"))
    assert len(cells) == 2  # the cell, and the optional download-again cell
    source = _clickthrough_main()
    (line,) = [ln for ln in source.splitlines() if ln.startswith("model_name = ")]
    offered = ast.literal_eval(line.split("# @param")[1].strip())
    assert offered == list(_clickthrough_namespace()["MODEL_SHORT_KEYS"])


def test_clickthrough_installs_nothing_and_offers_no_esm3():
    """ESM3 needed the `esm` package, which pins transformers < 5 and replaced
    Colab's transformers 5 and huggingface_hub 1 when installed. With ESM3 dropped,
    every model runs on Colab's own packages, ESM C on transformers' own port."""
    source = _clickthrough_main()
    namespace = _clickthrough_namespace()
    assert "_install" not in namespace
    imported = {
        alias.name.split(".")[0]
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.Import)
        for alias in node.names
    } | {
        (node.module or "").split(".")[0]
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.ImportFrom)
    }
    assert not imported & {"esm", "subprocess"}
    assert not [k for k in namespace["MODEL_SHORT_KEYS"] if "esm3" in k.lower()]


def test_clickthrough_switches_off_the_second_download():
    """Before transformers is first imported: no background safetensors conversion,
    which downloaded ProtT5's 2.4 GB a second time."""
    tree = ast.parse(_clickthrough_main())
    statements = list(ast.walk(tree))
    first_transformers = min(
        n.lineno
        for n in statements
        if isinstance(n, ast.ImportFrom) and (n.module or "").startswith("transformers")
    )
    set_before = {
        n.args[0].value
        for n in statements
        if isinstance(n, ast.Call)
        and getattr(n.func, "attr", None) == "setdefault"
        and n.lineno < first_transformers
    } | {
        n.targets[0].slice.value
        for n in statements
        if isinstance(n, ast.Assign)
        and isinstance(n.targets[0], ast.Subscript)
        and getattr(n.targets[0].value, "attr", None) == "environ"
        and n.lineno < first_transformers
    }
    assert "DISABLE_SAFETENSORS_CONVERSION" in set_before
    hub_names = {
        alias.name
        for n in statements
        if isinstance(n, ast.ImportFrom) and n.module == "huggingface_hub"
        for alias in n.names
    }
    assert hub_names and "HfFolder" not in hub_names


def test_clickthrough_hub_imports_exist_in_the_installed_hub():
    hub = pytest.importorskip("huggingface_hub")
    for node in ast.walk(ast.parse(_clickthrough_main())):
        if isinstance(node, ast.ImportFrom) and node.module == "huggingface_hub":
            assert all(hasattr(hub, alias.name) for alias in node.names)


def _fake_transformers(monkeypatch):
    """A `transformers` that records what each loader was asked for."""
    import sys
    import types

    calls = []

    class Loaded:
        def to(self, _device):
            return self

        def eval(self):
            return self

    def loader(name):
        def from_pretrained(checkpoint, **kwargs):
            calls.append((name, checkpoint, kwargs))
            return Loaded()

        return types.SimpleNamespace(from_pretrained=from_pretrained)

    fake = types.ModuleType("transformers")
    for name in (
        "AutoModel",
        "AutoTokenizer",
        "EsmModel",
        "T5EncoderModel",
        "T5Tokenizer",
    ):
        setattr(fake, name, loader(name))
    monkeypatch.setitem(sys.modules, "transformers", fake)
    return calls


def test_clickthrough_loads_the_official_esm_c_through_transformers(monkeypatch):
    """ESM C ran through the `esm` package, gated behind a login; transformers has
    its own port of the official MIT weights (biohub/ESMC-*) since 5.16."""
    pytest.importorskip("torch")
    calls = _fake_transformers(monkeypatch)
    namespace = _clickthrough_namespace()

    _model, _tokenizer, mod_type = namespace["_setup_model"]("biohub/ESMC-300M")

    assert mod_type == "esmc"
    assert ("AutoModel", "biohub/ESMC-300M", {}) in calls  # no remote code
    assert namespace["MODEL_SHORT_KEYS"]["biohub/ESMC-300M"] == "esmc_300m"


@pytest.mark.parametrize(
    ("checkpoint", "cuda", "native_bf16", "dtype"),
    [
        ("biohub/ESMC-6B", True, True, "bfloat16"),  # Ampere and newer
        ("biohub/ESMC-6B", True, False, "float16"),  # T4 / V100
        ("biohub/ESMC-6B", False, False, None),  # CPU: full precision
        ("biohub/ESMC-300M", True, True, None),  # only 6B is halved
    ],
)
def test_clickthrough_loads_esm_c_6b_in_half_precision_on_a_gpu(
    monkeypatch, checkpoint, cuda, native_bf16, dtype
):
    """As the package's local backend does: 25.4 GB of fp32 weights would fill a
    24-40 GB GPU. Native bf16 only: torch's default also counts emulated bf16."""
    torch = pytest.importorskip("torch")
    calls = _fake_transformers(monkeypatch)
    asked = []
    monkeypatch.setattr(torch.cuda, "is_available", lambda: cuda)
    monkeypatch.setattr(
        torch.cuda,
        "is_bf16_supported",
        lambda **kw: asked.append(kw) or native_bf16,
    )
    namespace = _clickthrough_namespace()

    namespace["_setup_model"](checkpoint)

    (kwargs,) = [kw for name, _, kw in calls if name == "AutoModel"]
    assert kwargs == ({"dtype": getattr(torch, dtype)} if dtype else {})
    if dtype:
        assert asked == [{"including_emulation": False}]
    assert namespace["MODEL_SHORT_KEYS"]["biohub/ESMC-6B"] == "esmc_6b"


def _run_until_the_fasta(namespace):
    """Run the cell up to choosing the FASTA, which is after the model checks."""

    class Stop(Exception):
        pass

    def stop():
        raise Stop

    namespace["_choose_fasta"] = stop
    with pytest.raises(Stop):
        namespace["_run"]()


@pytest.mark.parametrize(("cuda", "need"), [(True, 16), (False, 32)])
def test_clickthrough_stops_esm_c_6b_where_ram_is_short(monkeypatch, cuda, need):
    """Free Colab's 12.7 GB of host RAM: transformers builds the model there first,
    and running out kills the kernel without an error, so stop before the download."""
    torch = pytest.importorskip("torch")
    monkeypatch.setattr(torch.cuda, "is_available", lambda: cuda)
    monkeypatch.setattr(torch.cuda, "get_device_name", lambda _i: "Tesla T4")
    namespace = _clickthrough_namespace(model_name="biohub/ESMC-6B")
    namespace["_ram_below_gb"] = lambda gb: gb == need
    namespace["_choose_fasta"] = lambda: pytest.fail("read the FASTA first")

    with pytest.raises(SystemExit, match=f"at least {need} GB of RAM"):
        namespace["_run"]()

    # Every other model ignores the runtime's size.
    namespace["model_name"] = "biohub/ESMC-600M"
    namespace["_ram_below_gb"] = lambda _gb: True
    _run_until_the_fasta(namespace)


@pytest.mark.parametrize(("gpu_gb", "warned"), [(15.8, True), (40.0, False)])
def test_clickthrough_warns_when_esm_c_6b_may_not_fit_the_gpu(
    monkeypatch, capsys, gpu_gb, warned
):
    """A T4 holds the 12.7 GB of weights, so 6B runs there, with long sequences
    skipped on out-of-memory; say so rather than refuse."""
    import types

    torch = pytest.importorskip("torch")
    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    monkeypatch.setattr(torch.cuda, "get_device_name", lambda _i: "a GPU")
    monkeypatch.setattr(
        torch.cuda,
        "get_device_properties",
        lambda _i: types.SimpleNamespace(total_memory=gpu_gb * 1e9),
    )
    namespace = _clickthrough_namespace(model_name="biohub/ESMC-6B")
    namespace["_ram_below_gb"] = lambda _gb: False

    _run_until_the_fasta(namespace)

    assert ("leaving little for long sequences" in capsys.readouterr().out) is warned


class _FakeBatch(dict):
    def to(self, _device):
        return self


def _clickthrough_functions(monkeypatch):
    """The cell with a fake 4-dim model behind setup_model."""
    import types

    torch = pytest.importorskip("torch")

    def tokenizer(sequences, **_kwargs):
        longest = max(len(s) for s in sequences) + 2
        mask = torch.tensor(
            [[1] * (len(s) + 2) + [0] * (longest - len(s) - 2) for s in sequences]
        )
        return _FakeBatch(input_ids=mask.clone(), attention_mask=mask)

    class Model:
        device = "cpu"

        def __call__(self, input_ids, attention_mask):
            hidden = torch.arange(input_ids.numel() * 4, dtype=torch.float32)
            return types.SimpleNamespace(
                last_hidden_state=hidden.reshape(*input_ids.shape, 4)
            )

    namespace = _clickthrough_namespace()
    namespace["setup_model"] = lambda checkpoint: (
        Model(),
        tokenizer,
        "esm_transformer",
    )
    return namespace


def test_clickthrough_writes_named_embeddings_and_skips_long_sequences(
    monkeypatch, tmp_path
):
    import h5py

    namespace = _clickthrough_functions(monkeypatch)
    out = tmp_path / "seqs_esm2_8m.h5"
    written, too_long, oom = namespace["create_embedding"](
        "facebook/esm2_t6_8M_UR50D", ["a", "b", "long"], ["MKV", "MKVL", "M" * 12],
        output_file=str(out), max_len=10, batch_size=2, model_key="esm2_8m",
    )  # fmt: skip

    assert (sorted(written), too_long, oom) == (["a", "b"], ["long"], [])
    with h5py.File(out) as f:
        assert sorted(f) == ["a", "b"] and f.attrs["model_name"] == "esm2_8m"
        assert f["a"].shape == (4,)
    # A re-run embeds only what the file lacks.
    again = namespace["create_embedding"](
        "x", ["a", "c"], ["MKV", "MK"], output_file=str(out), model_key="esm2_8m"
    )
    assert again == (["c"], [], [])


def test_clickthrough_writes_per_residue_embeddings(monkeypatch, tmp_path):
    import h5py

    namespace = _clickthrough_functions(monkeypatch)
    out = tmp_path / "res.h5"
    namespace["create_embedding"](
        "x", ["a"], ["MKVL"], emb_type="per_res", output_file=str(out)
    )
    with h5py.File(out) as f:
        assert f["a"].shape == (4, 4)  # one 4-dim vector per residue


def test_clickthrough_ids_are_accessions_and_never_hold_a_slash():
    """'/' used to stop the run; an HDF5 name cannot hold it, so it is replaced."""
    namespace = _clickthrough_namespace(should_extract_uniprot_id=True)
    ids, note = namespace["_protein_ids"](["sp|P83302|3SX1_OPHHA", "contig/7"])
    assert ids == ["P83302", "contig_7"]
    assert "e.g. P83302" in note and "'/' replaced" in note

    namespace["should_extract_uniprot_id"] = False
    assert namespace["_protein_ids"](["sp|P83302|X"])[0] == ["sp|P83302|X"]


def test_clickthrough_reads_fasta_without_pyfaidx(tmp_path):
    fasta = tmp_path / "x.fasta"
    fasta.write_text(">sp|P1|A desc\nMKV\nLL\n\n>b\nAC\n>empty\n")
    namespace = _clickthrough_namespace()
    assert namespace["read_fasta"](fasta) == (
        ["sp|P1|A", "b", "empty"],
        ["MKVLL", "AC", ""],
    )


@pytest.mark.parametrize(
    ("error", "advice"),
    [
        (OSError("401 Client Error: Unauthorized"), "Colab secret HF_TOKEN"),
        (ConnectionError("Max retries exceeded"), "did not answer"),
        (ImportError("No module named 'sentencepiece'"), "Restart session"),
        # transformers < 5.16 has no `esmc` model and asks for remote code instead.
        (
            ValueError("The repository biohub/ESMC-300M contains custom code"),
            "transformers 5.16 or newer",
        ),
    ],
)
def test_clickthrough_load_failure_says_what_to_do(error, advice):
    namespace = _clickthrough_namespace()
    stop = namespace["_load_failure"]("biohub/ESMC-300M", error)
    assert isinstance(stop, SystemExit) and advice in str(stop)


# --- Ready examples: every input field can be tried without the user's own file ---

_VENOM = {
    "three-finger toxin": ["P83302", "U3FAE1"],
    "phospholipase A2": ["P0DJN6"],
    "venom Kunitz-type": ["B7S4N9"],
}


def _fake_example_servers(monkeypatch, tmp_path):
    """urlopen answering UniProt searches with the families above and the
    examples release with a small HDF5; returns the URLs asked for."""
    import io
    import urllib.parse
    import urllib.request

    h5 = _clickthrough_h5(tmp_path / "release.h5")
    calls = []

    def urlopen(url, timeout=None):
        calls.append(url)
        if url.startswith("https://rest.uniprot.org/uniprotkb/search?"):
            (query,) = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)["query"]
            (family,) = [f for f in _VENOM if f'"{f}"' in query]
            return io.BytesIO(
                "".join(
                    f">sp|{acc}|X_{acc} {family} OS=Snake\nMKTLLLTLVVVTIVCLDLG\n"
                    for acc in _VENOM[family]
                ).encode()
            )
        if url.endswith(".h5"):
            return io.BytesIO(h5.read_bytes())
        raise OSError(f"unexpected URL {url}")

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    return calls


def test_preparation_h5_example_fills_the_path_and_loads(monkeypatch, tmp_path):
    namespace, _, _ = _run_preparation_panel(monkeypatch, tmp_path)
    calls = _fake_example_servers(monkeypatch, tmp_path)

    namespace["h5_example_btn"].click()

    example = namespace["_H5_EXAMPLE"]
    assert calls == [namespace["_RELEASE_URL"] + example]
    assert namespace["h5_path_field"].value == str(tmp_path / example)
    assert namespace["input_args"][1]["n"] == 40
    assert namespace["input_args"][1]["name"] == "prot_t5"
    assert "Ready" in namespace["h5_status"].value
    # A second click loads the file already there, without fetching it again.
    namespace["_set_input"](1, None)
    namespace["h5_example_btn"].click()
    assert len(calls) == 1 and namespace["input_args"][1]["n"] == 40


def test_preparation_fasta_example_and_its_csv(monkeypatch, tmp_path):
    namespace, _, _ = _run_preparation_panel(monkeypatch, tmp_path)
    calls = _fake_example_servers(monkeypatch, tmp_path)

    namespace["fasta_example_btn"].click()

    fasta = tmp_path / namespace["_FASTA_EXAMPLE"]
    assert len(calls) == len(namespace["_FASTA_EXAMPLE_FAMILIES"])
    assert all("size=20" in url for url in calls)
    assert namespace["fasta_path_field"].value == str(fasta)
    assert namespace["input_args"][2]["n"] == 4
    status = namespace["fasta_status"].value
    assert "read as protein ID <code>P83302</code>" in status

    namespace["csv_example_btn"].click()

    csv = tmp_path / namespace["_CSV_EXAMPLE"]
    assert namespace["csv_path_field"].value == str(csv)
    assert csv.read_text().splitlines() == [
        "identifier,venom_family",
        "P83302,three-finger toxin",
        "U3FAE1,three-finger toxin",
        "P0DJN6,phospholipase A2",
        "B7S4N9,Kunitz-type",
    ]
    assert len(calls) == 3, "the CSV comes with the FASTA, not from a second fetch"
    # The panel's own CSV reader accepts it.
    ok, path = namespace["_csv_file"]()
    assert ok and path == str(csv)


def test_preparation_examples_fill_nothing_without_a_connection(monkeypatch, tmp_path):
    namespace, _, network = _run_preparation_panel(monkeypatch, tmp_path)

    namespace["h5_example_btn"].click()
    namespace["fasta_example_btn"].click()
    namespace["csv_example_btn"].click()

    assert len(network) == 3
    assert "could not be fetched" in namespace["h5_status"].value
    assert "could not be reached" in namespace["fasta_status"].value
    assert "could not be reached" in namespace["csv_example_status"].value
    for field in ("h5_path_field", "fasta_path_field", "csv_path_field"):
        assert namespace[field].value == ""
    assert sorted(p.name for p in tmp_path.iterdir()) == []


def test_preparation_example_query_is_filled_in_and_set(monkeypatch, tmp_path):
    namespace, _, _ = _run_preparation_panel(monkeypatch, tmp_path)
    query = namespace["_QUERY_EXAMPLES"][1]

    namespace["query_examples"].value = query

    assert namespace["query_input"].value == query
    assert namespace["input_args"][3]["query"] == query
    assert "Query set" in namespace["query_status"].value


def _example_constants(source: str) -> dict:
    names = {"_FASTA_EXAMPLE", "_FASTA_EXAMPLE_FAMILIES", "_FASTA_EXAMPLE_SIZE"}
    found = {}
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            target = node.targets[0]
            if isinstance(target, ast.Name) and target.id in names:
                found[target.id] = ast.literal_eval(node.value)
    assert set(found) == names
    return found


def test_both_notebooks_fetch_the_same_example_fasta():
    panel = _preparation_cell("# @title 2.")
    assert _example_constants(panel) == _example_constants(_clickthrough_main())


def _clickthrough_choose(monkeypatch, tmp_path, *, path="", upload=False):
    import sys
    import types

    monkeypatch.chdir(tmp_path)
    uploads = []

    def upload_file():
        uploads.append(True)
        (tmp_path / "mine.fasta").write_text(">a\nMKV\n")
        return {"mine.fasta": b""}

    colab = types.ModuleType("google.colab")
    colab.files = types.SimpleNamespace(upload=upload_file)
    monkeypatch.setitem(sys.modules, "google.colab", colab)
    namespace = _clickthrough_namespace(fasta_filename=path, upload_fasta=upload)
    return namespace["_choose_fasta"](), uploads


def test_clickthrough_runs_on_the_example_fasta_by_default(monkeypatch, tmp_path):
    calls = _fake_example_servers(monkeypatch, tmp_path)
    (path, about), uploads = _clickthrough_choose(monkeypatch, tmp_path)

    assert path == Path("example_snake_venom.fasta") and "the example" in about
    text = (tmp_path / "example_snake_venom.fasta").read_text()
    assert text.count(">") == 4 and len(calls) == 3 and not uploads


@pytest.mark.parametrize("how", ["path", "upload"])
def test_clickthrough_uses_the_users_own_fasta(monkeypatch, tmp_path, how):
    calls = _fake_example_servers(monkeypatch, tmp_path)
    own = tmp_path / "own.fasta"
    own.write_text(">a\nMKV\n")
    (path, about), uploads = _clickthrough_choose(
        monkeypatch,
        tmp_path,
        path=str(own) if how == "path" else "",
        upload=how == "upload",
    )
    assert path == (own if how == "path" else Path("mine.fasta")) and about == ""
    assert calls == [] and bool(uploads) == (how == "upload")


def test_clickthrough_says_when_the_example_cannot_be_fetched(monkeypatch, tmp_path):
    import urllib.request

    def refuse(*_a, **_k):
        raise OSError("offline")

    monkeypatch.setattr(urllib.request, "urlopen", refuse)
    with pytest.raises(SystemExit, match="UniProt could not be reached"):
        _clickthrough_choose(monkeypatch, tmp_path)
    assert not (tmp_path / "example_snake_venom.fasta").exists()


def test_preparation_names_the_custom_csv_beside_generate(monkeypatch, tmp_path):
    """The CSV field belongs to no tab: one filled in for the FASTA example
    applied to the Snake Toxin example unseen."""
    namespace, _, _ = _run_preparation_panel(monkeypatch, tmp_path)
    target = namespace["input_target"]
    assert "custom annotations" not in target.value

    namespace["csv_path_field"].value = str(tmp_path / "families.csv")
    assert "custom annotations from families.csv" in target.value

    namespace["csv_path_field"].value = ""
    assert "custom annotations" not in target.value


def test_preparation_retells_routine_package_lines(monkeypatch, tmp_path, capsys):
    import logging

    import protspace

    namespace, _, _ = _run_preparation_panel(monkeypatch, tmp_path)
    source = _string_constants(Path(protspace.__file__).parent)
    pinned = [*namespace["_PANEL_RETOLD"], "Missing annotations: "]
    for text in pinned:
        assert any(text in s for s in source), f"no longer in the package: {text!r}"

    log = logging.getLogger("protspace.data.annotations.cache")
    log.warning(
        "Annotation cache lacks %d of %d requested identifier(s); "
        "fetching annotations for them",
        4456,
        5015,
    )
    log.info(f"Missing annotations: {set()}")
    log.info(f"Missing annotations: { ({'pfam'}) }")

    output = capsys.readouterr().out
    assert "INFO: Fetching annotations for 4,456 of 5,015 proteins" in output
    assert "WARNING" not in output
    assert "set()" not in output
    assert "Missing annotations: {'pfam'}" in output


def _reviewed_bundle(tmp_path, *, with_reviewed=True):
    import types

    import numpy as np
    import pyarrow as pa

    from protspace.data.annotations.encoding import stamp_format_version
    from protspace.data.io.bundle import write_bundle
    from tests.bundle_v3_helpers import projection_tables

    columns = {
        "protein_id": ["p0", "p1", "p2", "p3"],
        "protein_families": ["toxin", "lectin", "", ""],
    }
    if with_reviewed:
        columns["reviewed"] = ["Swiss-Prot", "Swiss-Prot", "TrEMBL", "TrEMBL"]
    bundle = tmp_path / "data.parquetbundle"
    write_bundle(
        [stamp_format_version(pa.table(columns)), *projection_tables(4, (2,))], bundle
    )
    emb_set = types.SimpleNamespace(
        headers=["p0", "p1", "p2", "p3"],
        data=np.array([[1, 0], [0, 1], [0.9, 0.1], [0.1, 0.9]], dtype=np.float32),
    )
    return bundle, emb_set


def test_preparation_eat_example_filters_copy_swissprot_to_trembl(
    tmp_path, monkeypatch
):
    from protspace.data.io.bundle import read_tables

    bundle, emb_set = _reviewed_bundle(tmp_path)
    downloads, ns = _run_preparation_eat_cell(
        monkeypatch,
        bundle,
        emb_set,
        None,
        before_click=lambda ns: ns["eat_example_btn"].click(),
        eat_cutoff="off",
    )

    assert ns["eat_q_where"].value == "reviewed~TrEMBL"
    assert ns["eat_r_where"].value == "reviewed~Swiss-Prot"
    assert ns["eat_col"].value == "protein_families"
    out = tmp_path / "data.eat.parquetbundle"
    assert downloads[0] == str(out)
    predicted = read_tables(out)[0].column("protein_families__pred_value").to_pylist()
    assert predicted == ["", "", "toxin", "lectin"]


def test_preparation_eat_example_filters_need_a_reviewed_column(tmp_path, monkeypatch):
    bundle, emb_set = _reviewed_bundle(tmp_path, with_reviewed=False)

    def click(ns):
        ns["eat_example_btn"].click()
        assert "no <code>reviewed</code> column" in ns["eat_status"].value
        assert ns["eat_q_where"].value == ns["eat_r_where"].value == ""

    _run_preparation_eat_cell(
        monkeypatch, bundle, emb_set, None, before_click=click, eat_cutoff="off"
    )


# --- Example runs take their annotations from the example's bundle ---

_EXAMPLE_IDS = [f"prot{i:03d}" for i in range(40)]
_DEFAULT_COLUMNS = [
    "ec",
    "keyword",
    "length",
    "protein_families",
    "reviewed",
    "gene_name",
    "protein_name",
    "uniprot_kb_id",
]


def _example_bundle(path: Path, columns) -> Path:
    """A v3 bundle of the example proteins holding *columns*, each cell
    `<column>-from-bundle`."""
    import numpy as np
    import pyarrow as pa

    from protspace.data.annotations.encoding import stamp_format_version
    from protspace.data.io.bundle import write_bundle
    from protspace.data.processors.base_processor import BaseProcessor

    annotations = stamp_format_version(
        pa.table(
            {
                "protein_id": _EXAMPLE_IDS,
                **{c: [f"{c}-from-bundle"] * len(_EXAMPLE_IDS) for c in columns},
            }
        )
    )
    reductions = [
        {
            "name": "PCA 2",
            "dimensions": 2,
            "info": {},
            "data": np.zeros((len(_EXAMPLE_IDS), 2), dtype=np.float32),
        }
    ]
    processor = BaseProcessor({}, {})
    write_bundle(
        [
            annotations,
            processor._create_projections_metadata_table(reductions),
            processor._create_projections_data_table(reductions, _EXAMPLE_IDS),
        ],
        path,
    )
    return path


def _example_run(monkeypatch, tmp_path, *, bundle_columns, bundle_served=True):
    """The panel with a fake examples release (the selected example's HDF5 and,
    when *bundle_served*, its `_v3` bundle holding *bundle_columns*) and a spy
    on the annotation fetch, which answers `<column>-fetched` for every column
    it is asked for and reads a custom CSV for real (files alone fetch nothing).
    Returns (namespace, downloads, release URLs asked for, fetch requests)."""
    import io
    import urllib.request

    import pandas as pd

    from protspace.data.annotations.configuration import AnnotationConfiguration
    from protspace.data.processors.pipeline import ReductionPipeline

    namespace, downloads, _ = _run_preparation_panel(monkeypatch, tmp_path)
    h5 = _clickthrough_h5(tmp_path / "release.h5")
    bundle = _example_bundle(tmp_path / "release.parquetbundle", bundle_columns)
    calls, asked = [], []

    def urlopen(url, timeout=None):
        calls.append(url)
        if url.endswith("_prot_t5.h5"):
            return io.BytesIO(h5.read_bytes())
        if url.endswith("_v3.parquetbundle") and bundle_served:
            return io.BytesIO(bundle.read_bytes())
        raise OSError(f"404 for {url}")

    real_fetch = ReductionPipeline._fetch_annotations

    def fetch(self, headers, embedding_sets):
        requested = list(self.config.annotations)
        asked.append(requested)
        names = [a for a in requested if not str(a).endswith(".csv")]
        if not names:
            return real_fetch(self, headers, embedding_sets)
        names = AnnotationConfiguration(names).user_annotations
        return pd.DataFrame(
            {"protein_id": headers, **{n: f"{n}-fetched" for n in names}}
        )

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(ReductionPipeline, "_fetch_annotations", fetch)
    for method, toggle in namespace["method_toggles"].items():
        toggle.value = method == "PCA"
    return namespace, downloads, calls, asked


def _bundle_cells(bundle) -> dict[str, set[str]]:
    from protspace.data.io.bundle import read_tables

    table = read_tables(bundle)[0]
    return {c: set(table.column(c).to_pylist()) for c in table.column_names[1:]}


def test_preparation_example_takes_default_annotations_from_its_bundle(
    monkeypatch, tmp_path, capsys
):
    """The Snake Toxin example spent about 20 minutes on Colab fetching
    annotations its release bundle already holds."""
    namespace, downloads, calls, asked = _example_run(
        monkeypatch, tmp_path, bundle_columns=_DEFAULT_COLUMNS
    )

    namespace["_on_gen"](None)

    assert asked == []
    assert calls == [
        namespace["_RELEASE_URL"] + "three_finger_toxin_prot_t5.h5",
        namespace["_RELEASE_URL"] + "three_finger_toxin_v3.parquetbundle",
    ]
    (bundle,) = downloads
    assert _bundle_cells(bundle) == {c: {f"{c}-from-bundle"} for c in _DEFAULT_COLUMNS}
    assert "8 annotation columns came from the example's ready-made bundle" in (
        capsys.readouterr().out
    )


def test_preparation_example_fetches_only_what_its_bundle_lacks(monkeypatch, tmp_path):
    held = [c for c in _DEFAULT_COLUMNS if c != "ec"]
    namespace, downloads, _, asked = _example_run(
        monkeypatch, tmp_path, bundle_columns=held
    )

    namespace["_on_gen"](None)

    assert asked == [["ec"]]
    (bundle,) = downloads
    cells = _bundle_cells(bundle)
    assert cells["ec"] == {"ec-fetched"}
    assert all(cells[c] == {f"{c}-from-bundle"} for c in held)


def test_preparation_example_adds_a_custom_csv_to_its_bundle(monkeypatch, tmp_path):
    namespace, downloads, _, asked = _example_run(
        monkeypatch, tmp_path, bundle_columns=_DEFAULT_COLUMNS
    )
    csv = tmp_path / "groups.csv"
    csv.write_text("id,group\n" + "".join(f"{i},g1\n" for i in _EXAMPLE_IDS))
    namespace["csv_path_field"].value = str(csv)

    namespace["_on_gen"](None)

    assert asked == [[str(csv)]]
    (bundle,) = downloads
    cells = _bundle_cells(bundle)
    assert cells["group"] == {"g1"}
    assert cells["keyword"] == {"keyword-from-bundle"}


def test_preparation_example_refetch_ignores_its_bundle(monkeypatch, tmp_path):
    namespace, downloads, calls, asked = _example_run(
        monkeypatch, tmp_path, bundle_columns=_DEFAULT_COLUMNS
    )
    namespace["refetch_cb"].value = True

    namespace["_on_gen"](None)

    assert asked == [["default"]]
    assert not [url for url in calls if url.endswith(".parquetbundle")]
    (bundle,) = downloads
    assert _bundle_cells(bundle)["ec"] == {"ec-fetched"}


def test_preparation_example_fetches_all_when_its_bundle_is_missing(
    monkeypatch, tmp_path, capsys
):
    namespace, downloads, _, asked = _example_run(
        monkeypatch, tmp_path, bundle_columns=_DEFAULT_COLUMNS, bundle_served=False
    )

    namespace["_on_gen"](None)

    assert asked == [["default"]]
    assert len(downloads) == 1
    assert "could not be read" in capsys.readouterr().out
    assert not list(tmp_path.glob("*.part"))


def test_preparation_hides_transient_progress_bars(monkeypatch, tmp_path):
    """Colab keeps an empty slot for each closed widget: a bar opened and
    closed per batch left a screen of blank space under the panel."""
    import tqdm

    _run_preparation_panel(monkeypatch, tmp_path)
    bar_class = tqdm.tqdm
    try:
        assert bar_class(range(3), leave=False).disable
        assert not bar_class(range(3)).disable
    finally:
        import tqdm.std

        tqdm.tqdm = tqdm.std.tqdm


def test_preparation_hides_the_package_lines_the_card_repeats(
    monkeypatch, tmp_path, capsys
):
    import logging

    import protspace

    namespace, _, _ = _run_preparation_panel(monkeypatch, tmp_path)
    source = _string_constants(Path(protspace.__file__).parent)
    for hidden in namespace["_PANEL_HIDDEN"]:
        stem = hidden.split("set()")[0].split("https://")[0]
        assert any(stem in s for s in source), f"no longer in the package: {stem!r}"

    log = logging.getLogger("protspace.data.io.bundle")
    log.info("Saved bundled output to: output/x.parquetbundle")
    log.info("Applying UMAP 2 to 'prot_t5'")
    log.info("Downloading https://ftp.expasy.org/databases/enzyme/enzyme.dat ...")
    log.warning("Inactive UniProt entries: 3 deleted")
    output = capsys.readouterr().out
    assert output.strip() == "WARNING: Inactive UniProt entries: 3 deleted"


def test_clickthrough_links_every_model_it_offers():
    """The dropdown cannot hold links, so the text above it links each model's page."""
    import re

    form_text = "\n".join(
        line
        for line in _clickthrough_main().splitlines()
        if line.startswith("# @markdown")
    )
    linked = re.findall(r"\(https://huggingface\.co/([^)\s]+)\)", form_text)
    assert sorted(linked) == sorted(_clickthrough_namespace()["MODEL_SHORT_KEYS"])
