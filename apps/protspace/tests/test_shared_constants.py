"""The constants shared with the web app come from one generated module.

``contracts/shared-constants.json`` generates ``protspace._generated.shared_constants``
and the web's ``packages/utils/src/generated/shared-constants.ts``, and
``pnpm shared-constants:check`` fails when either is stale. These tests pin the rest:
every name the package has always exported for one of those constants still holds
the generated value, so a hand-written copy left behind by a later edit to the JSON
fails here, and the generated module stays plain data that ships inside the package.
"""

import ast
import importlib
from pathlib import Path

import pytest

from protspace._generated import shared_constants as shared

# (module, exported name, the generated value it must hold)
REEXPORTS = [
    ("protspace.core.constants", "MISSING_VALUE_TOKENS", shared.MISSING_VALUE_TOKENS),
    ("protspace.data.io.settings_converter", "NA_INTERNAL", shared.NA_VALUE),
    (
        "protspace.data.io.settings_converter",
        "NA_PINNED_COLOR",
        shared.NA_DEFAULT_COLOR,
    ),
    ("protspace.data.io.settings_converter", "KELLYS_COLORS", shared.KELLYS_COLORS),
    (
        "protspace.utils.add_annotation_style",
        "_CATEGORICAL_PALETTE_IDS",
        frozenset(shared.CATEGORICAL_PALETTE_IDS),
    ),
    (
        "protspace.utils.add_annotation_style",
        "_GRADIENT_PALETTE_IDS",
        frozenset(shared.GRADIENT_PALETTE_IDS),
    ),
    (
        "protspace.utils.add_annotation_style",
        "ALLOWED_SHAPES",
        list(shared.POINT_SHAPES),
    ),
    (
        "protspace.data.annotations.encoding",
        "ARROW_BOOLEAN_LABELS",
        shared.ARROW_BOOLEAN_LABELS,
    ),
    (
        "protspace.data.processors.custom_annotations",
        "RESERVED_COLUMNS",
        shared.NON_ANNOTATION_COLUMNS,
    ),
    ("protspace.data.io.ids", "PROTEIN_ID_COLUMN", shared.PROTEIN_ID_COLUMN),
]


@pytest.mark.parametrize(
    ("module", "name", "expected"),
    REEXPORTS,
    ids=[f"{module}.{name}" for module, name, _ in REEXPORTS],
)
def test_exported_name_holds_the_generated_value(module, name, expected):
    assert getattr(importlib.import_module(module), name) == expected


def test_generated_module_is_plain_data():
    # No imports: the module cannot read contracts/ (absent from an installed
    # wheel) or anything else at run time.
    tree = ast.parse(Path(shared.__file__).read_text())
    imports = [
        node for node in ast.walk(tree) if isinstance(node, ast.Import | ast.ImportFrom)
    ]
    assert imports == []
