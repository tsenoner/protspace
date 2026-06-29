"""protlabel is a standalone EAT engine: it must not import protspace.

This boundary is what keeps protlabel independently testable, installable as its
own distribution, and reusable from other projects. A static scan of every
protlabel source file enforces it (catches an accidental `import protspace`
before it ships).
"""

import ast
from pathlib import Path

import protlabel


def _imported_modules(tree: ast.AST) -> list[str]:
    names: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            # level > 0 is a relative import (never protspace); module may be None.
            if node.level == 0 and node.module:
                names.append(node.module)
    return names


def test_protlabel_source_has_no_protspace_imports():
    pkg_dir = Path(protlabel.__file__).parent
    sources = sorted(pkg_dir.rglob("*.py"))
    assert sources, "no protlabel source files found to scan"

    offenders: list[str] = []
    for py in sources:
        tree = ast.parse(py.read_text(encoding="utf-8"), filename=str(py))
        for module in _imported_modules(tree):
            if module == "protspace" or module.startswith("protspace."):
                offenders.append(f"{py.name} imports {module}")

    assert not offenders, "protlabel must not import protspace: " + "; ".join(offenders)
