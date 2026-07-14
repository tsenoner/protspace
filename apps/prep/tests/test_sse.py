from protspace_prep.sse import format_event, KEEPALIVE_FRAME


def test_format_event_emits_named_event_with_json_data():
    out = format_event("progress", {"stage": "embedding", "current": 10})
    assert out == 'event: progress\ndata: {"stage":"embedding","current":10}\n\n'


def test_format_event_handles_minimal_payload():
    out = format_event("done", {"download_url": "/api/prepare/abc/bundle"})
    assert out.startswith("event: done\n")
    assert 'data: {"download_url":"/api/prepare/abc/bundle"}' in out
    assert out.endswith("\n\n")


def test_keepalive_frame_is_a_comment_line():
    assert KEEPALIVE_FRAME.startswith(":")
    assert KEEPALIVE_FRAME.endswith("\n\n")
