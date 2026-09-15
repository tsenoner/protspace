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
