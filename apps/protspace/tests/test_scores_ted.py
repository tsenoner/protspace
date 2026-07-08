import pandas as pd

from protspace.data.annotations.scores import strip_scores_from_df


def test_no_scores_strips_ted_domains():
    df = pd.DataFrame({"ted_domains": ["2.60.40.720 (Ig-like)|95.1;3.40.50.300|88.3"]})
    out = strip_scores_from_df(df)
    assert out["ted_domains"].iloc[0] == "2.60.40.720 (Ig-like);3.40.50.300"
