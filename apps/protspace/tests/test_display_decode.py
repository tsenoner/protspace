from protspace.utils.add_annotation_style import _to_display_value


def test_display_decodes_encoded_name():
    # one hit, encoded ';' in the name, with a score suffix
    raw = "1.10.10.10 (Ribosomal Protein L15%3B Chain: K)|50.2"
    assert _to_display_value(raw) == ["1.10.10.10 (Ribosomal Protein L15; Chain: K)"]


def test_display_multi_hit_and_plain():
    raw = "A;B|EXP"
    assert _to_display_value(raw) == ["A", "B"]
