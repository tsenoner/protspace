from protspace_prep.sse import KEEPALIVE_FRAME, format_event


def test_format_event_emits_named_event_with_json_data():
    out = format_event("progress", {"stage": "embedding", "current": 10})
    assert out == 'event: progress\ndata: {"stage":"embedding","current":10}\n\n'


def test_keepalive_frame_is_a_comment_line():
    assert KEEPALIVE_FRAME.startswith(":")
    assert KEEPALIVE_FRAME.endswith("\n\n")
