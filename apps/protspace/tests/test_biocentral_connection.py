"""Reaching the Biocentral server: one address, one wait, a failure that says why.

Biocentral's server moved from v1 to v2 while the pinned client accepted only v1. The
client reports a server it will not talk to exactly as it reports a dead one -- a 30 s
wait, then ``TimeoutError: No healthy biocentral service became available in time`` --
so the hosted app told users the service was down and the CLI printed a traceback.
"""

import tomllib
from pathlib import Path

import pytest
import requests
from typer.testing import CliRunner

from protspace.data import biocentral_connection as conn
from protspace.data.biocentral_connection import (
    BIOCENTRAL_URL,
    BiocentralUnavailableError,
    wait_for_server,
)
from tests.cli_output import plain

# The words apps/prep/.../pipeline.py matches (`_BIOCENTRAL_DOWN_PATTERNS`) to send a
# user to Colab. Copied, not imported: protspace must not depend on protspace_prep.
_ROUTING_PATTERN = "no healthy biocentral"
_LEAD = "No healthy Biocentral service became available in time"
_CLIENT_TIMEOUT = TimeoutError("No healthy biocentral service became available in time")


class _Client:
    """Stands in for ``BiocentralAPI``: its wait returns it, or raises *error*."""

    def __init__(self, error=None):
        self.error = error
        self.waits = []

    def wait_until_healthy(self, max_wait_seconds):
        self.waits.append(max_wait_seconds)
        if self.error is not None:
            raise self.error
        return self


class _Health:
    """What ``GET /health`` answers."""

    def __init__(self, body=None, status=200, reason="OK"):
        self.body = body
        self.status_code = status
        self.reason = reason

    def json(self):
        if isinstance(self.body, Exception):
            raise self.body
        return self.body


def _server(monkeypatch, answer) -> list:
    """Make ``requests.get`` answer *answer* (raise it, if it is an exception).

    Returns the list of requests made, so a test can say none were.
    """
    made: list = []

    def get(url, **kwargs):
        made.append(url)
        if isinstance(answer, Exception):
            raise answer
        return answer

    monkeypatch.setattr(requests, "get", get)
    return made


def _failed_wait(monkeypatch, answer) -> str:
    """The message raised when the wait fails and ``/health`` gives *answer*."""
    _server(monkeypatch, answer)
    with pytest.raises(BiocentralUnavailableError) as raised:
        wait_for_server(_Client(error=_CLIENT_TIMEOUT))
    return str(raised.value)


@pytest.fixture(autouse=True)
def client_2_0_0(monkeypatch):
    """Pin the installed client to 2.0.0, which supports servers v2 up to v3, so
    the messages under test do not move when the lock does."""
    monkeypatch.setattr(conn, "_CLIENT_WINDOW", ("2.0.0", "3.0.0"))
    monkeypatch.setattr(conn, "_CLIENT_VERSION", "2.0.0")


class TestWaitForServer:
    def test_a_healthy_server_costs_no_extra_request(self, monkeypatch):
        made = _server(monkeypatch, _Health({"version": "2.0.1"}))
        client = _Client()

        assert wait_for_server(client) is client
        assert client.waits == [30]
        assert made == [], "/health is looked at only after the wait has failed"

    def test_a_failed_wait_keeps_the_clients_error_as_its_cause(self, monkeypatch):
        _server(monkeypatch, _Health({"version": "2.0.1"}))

        with pytest.raises(BiocentralUnavailableError) as raised:
            wait_for_server(_Client(error=_CLIENT_TIMEOUT))

        assert raised.value.__cause__ is _CLIENT_TIMEOUT

    def test_the_failure_is_a_stage_failure_the_cli_already_catches(self):
        assert issubclass(BiocentralUnavailableError, ValueError)

    def test_the_health_check_is_made_against_the_one_server_address(self, monkeypatch):
        made = _server(monkeypatch, _Health({"version": "2.0.1"}))

        with pytest.raises(BiocentralUnavailableError):
            wait_for_server(_Client(error=_CLIENT_TIMEOUT))

        assert made == [f"{BIOCENTRAL_URL}/health"]


class TestTheReason:
    def test_a_server_that_does_not_answer(self, monkeypatch):
        message = _failed_wait(
            monkeypatch, requests.ConnectionError("Connection refused")
        )

        assert message.startswith(_LEAD)
        assert BIOCENTRAL_URL in message
        assert "did not answer" in message
        assert "Connection refused" in message

    def test_a_server_that_answers_with_an_error_status(self, monkeypatch):
        message = _failed_wait(
            monkeypatch, _Health(status=503, reason="Service Unavailable")
        )

        assert "503" in message
        assert "Service Unavailable" in message

    def test_a_server_newer_than_the_client_supports(self, monkeypatch):
        message = _failed_wait(monkeypatch, _Health({"version": "3.1.0"}))

        assert "v3.1.0" in message
        assert "biocentral-api 2.0.0" in message
        assert "v2.0.0 up to (not including) v3.0.0" in message
        assert "pip install -U protspace" in message
        assert "Python 3.12" in message

    def test_the_python_floor_in_the_remedy_is_the_packages_own(self, monkeypatch):
        """The remedy says which Python the upgrade needs, because on an older one
        pip quietly keeps the old release. That number must not drift from
        `requires-python`."""
        pyproject = Path(__file__).resolve().parents[1] / "pyproject.toml"
        requires = tomllib.loads(pyproject.read_text())["project"]["requires-python"]
        floor = requires.removeprefix(">=")

        message = _failed_wait(monkeypatch, _Health({"version": "3.1.0"}))

        assert f"Python {floor} or newer" in message

    def test_a_server_older_than_the_client_supports(self, monkeypatch):
        message = _failed_wait(monkeypatch, _Health({"version": "1.2.1"}))

        assert "v1.2.1" in message
        assert "older" in message
        assert "pip install" not in message, "upgrading cannot fix an old server"

    def test_a_two_digit_major_is_compared_as_a_number(self, monkeypatch):
        """As strings, "10" sorts between "2" and "3", which is inside the window."""
        message = _failed_wait(monkeypatch, _Health({"version": "10.0.0"}))

        assert "pip install -U protspace" in message

    def test_a_supported_server_that_did_not_pass_the_health_check(self, monkeypatch):
        message = _failed_wait(monkeypatch, _Health({"version": "2.0.1"}))

        assert "v2.0.1" in message
        assert "health check" in message
        assert "pip install" not in message, "the client is not at fault here"

    @pytest.mark.parametrize(
        "body",
        [{}, {"version": None}, {"version": "dev"}, ["not", "a", "mapping"]]
        + [ValueError("not json")],
        ids=["empty", "null", "not-a-number", "not-a-mapping", "not-json"],
    )
    def test_a_health_answer_without_a_readable_version(self, monkeypatch, body):
        message = _failed_wait(monkeypatch, _Health(body))

        assert "without a readable version" in message


@pytest.mark.parametrize(
    "answer",
    [
        requests.ConnectionError("Connection refused"),
        _Health(status=503, reason="Service Unavailable"),
        _Health({"version": "3.0.0"}),
        _Health({"version": "1.2.1"}),
        _Health({"version": "2.0.1"}),
        _Health({}),
    ],
    ids=["unreachable", "503", "newer", "older", "in-window", "unreadable"],
)
def test_every_reason_keeps_the_words_the_prep_service_routes_on(monkeypatch, answer):
    message = _failed_wait(monkeypatch, answer)

    assert message.startswith(_LEAD)
    assert _ROUTING_PATTERN in message.lower()


class TestCallSites:
    """Embedding, the embedder probe and the CLI all fail the same way."""

    @staticmethod
    def _unusable_server(monkeypatch):
        """A server on v3.0.0, which the 2.0.0 client refuses."""
        from protspace.data.embedding import biocentral as bc

        _server(monkeypatch, _Health({"version": "3.0.0"}))
        client = _Client(error=_CLIENT_TIMEOUT)
        monkeypatch.setattr(bc, "BiocentralAPI", lambda **kwargs: client)
        return bc

    def test_embedding(self, monkeypatch, tmp_path):
        bc = self._unusable_server(monkeypatch)

        with pytest.raises(BiocentralUnavailableError, match=r"v3\.0\.0"):
            bc.embed_sequences(
                {"P1": "MKVLAAGIVG"}, "Rostlab/prot_t5_xl_uniref50", tmp_path / "o.h5"
            )

    def test_probing_an_embedder(self, monkeypatch):
        bc = self._unusable_server(monkeypatch)

        with pytest.raises(BiocentralUnavailableError, match=r"v3\.0\.0"):
            bc.probe_embedder({"P1": "MKVLAAGIVG"}, "Rostlab/prot_t5_xl_uniref50")

    def test_the_cli_prints_the_reason_and_exits_1_without_a_traceback(
        self, monkeypatch, tmp_path
    ):
        from protspace.cli.app import app

        self._unusable_server(monkeypatch)
        fasta = tmp_path / "in.fasta"
        fasta.write_text(">P1\nMKVLAAGIVG\n")

        result = CliRunner().invoke(
            app,
            ["embed", "-i", str(fasta), "-e", "prot_t5", "-o", str(tmp_path / "out")],
        )

        output = plain(result.output)
        assert result.exit_code == 1, output
        assert f"ERROR: {_LEAD}" in output
        assert "v3.0.0" in output
        # An escaped exception is what typer renders as a traceback; a handled
        # failure leaves the runner a plain SystemExit.
        assert isinstance(result.exception, SystemExit), repr(result.exception)
