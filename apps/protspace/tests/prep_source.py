"""Values the prep service defines, read from its source.

protspace must not depend on protspace_prep, so the tests cannot import it. They
parse the literal instead: a copy pasted into a test would keep passing after prep
changed its list, and stop guarding the very case it was written for.
"""

import ast
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
PREP_PIPELINE = REPO_ROOT / "apps" / "prep" / "src" / "protspace_prep" / "pipeline.py"


def biocentral_down_patterns() -> tuple[str, ...]:
    """The substrings prep matches to classify a failure as BIOCENTRAL_UNAVAILABLE
    and send the user to Colab (``_BIOCENTRAL_DOWN_PATTERNS``)."""
    tree = ast.parse(PREP_PIPELINE.read_text())
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == "_BIOCENTRAL_DOWN_PATTERNS"
            for t in node.targets
        ):
            patterns = ast.literal_eval(node.value)
            break
    else:
        raise AssertionError(f"_BIOCENTRAL_DOWN_PATTERNS not found in {PREP_PIPELINE}")
    # A rename or a reshaped value must fail here, not yield an empty tuple that
    # every "not an outage" check passes trivially.
    assert isinstance(patterns, tuple) and patterns, patterns
    assert all(isinstance(p, str) and p for p in patterns), patterns
    return patterns
