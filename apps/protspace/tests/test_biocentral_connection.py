"""Reaching the Biocentral server: one address, one wait, a failure that says why."""

import importlib.util
import json
import sys

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
    """Stands in for ``BiocentralAPI``: its wait returns it, or raises *error*.

    The window is a 2.x client's, which is what a failed wait reports.
    """

    MIN_API_VERSION = "2.0.0"
    MAX_API_VERSION = "3.0.0"

    def __init__(self, error=None):
        self.error = error
        self.waits = []

    def wait_until_healthy(self, max_wait_seconds):
        self.waits.append(max_wait_seconds)
        if self.error is not None:
            raise self.error
        return self


def _response(body=None, status=200, reason="OK") -> requests.Response:
    """A real ``/health`` response, so ``json`` and ``raise_for_status`` are requests' own."""
    response = requests.Response()
    response.status_code, response.reason = status, reason
    response.url = f"{BIOCENTRAL_URL}/health"
    response._content = body if isinstance(body, bytes) else json.dumps(body).encode()
    return response


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
    """Pin the installed client's version, so the messages do not move with the lock."""
    monkeypatch.setattr(conn, "_CLIENT_VERSION", "2.0.0")


class TestWaitForServer:
    def test_a_healthy_server_costs_no_extra_request(self, monkeypatch):
        made = _server(monkeypatch, _response({"version": "2.0.1"}))
        client = _Client()

        assert wait_for_server(client) is client
        assert client.waits == [30]
        assert made == [], "/health is looked at only after the wait has failed"

    def test_a_failed_wait_asks_the_one_address_and_keeps_the_clients_error(
        self, monkeypatch
    ):
        made = _server(monkeypatch, _response({"version": "2.0.1"}))

        with pytest.raises(BiocentralUnavailableError) as raised:
            wait_for_server(_Client(error=_CLIENT_TIMEOUT))

        assert raised.value.__cause__ is _CLIENT_TIMEOUT
        assert made == [f"{BIOCENTRAL_URL}/health"]

    def test_the_failure_is_a_stage_failure_the_cli_already_catches(self):
        assert issubclass(BiocentralUnavailableError, ValueError)

    def test_the_helper_does_not_import_the_client(self, monkeypatch):
        """The retriever imports the helper lazily, while its tests have swapped the
        client for a fake. Reading the client's constants at import broke 15 of those
        tests whenever the file ran on its own."""
        monkeypatch.setitem(sys.modules, "biocentral_api", None)  # import now raises
        spec = importlib.util.spec_from_file_location(
            "_fresh_connection", conn.__file__
        )

        spec.loader.exec_module(importlib.util.module_from_spec(spec))


class TestTheReason:
    def test_the_message_keeps_the_words_the_prep_service_routes_on(self, monkeypatch):
        message = _failed_wait(monkeypatch, requests.ConnectionError("refused"))

        assert message.startswith(f"{_LEAD}: {BIOCENTRAL_URL} ")
        assert _ROUTING_PATTERN in message.lower()

    def test_a_server_that_does_not_answer(self, monkeypatch):
        message = _failed_wait(
            monkeypatch, requests.ConnectionError("Connection refused")
        )

        assert "did not answer its health check" in message
        assert "Connection refused" in message

    def test_a_server_that_answers_with_an_error_status(self, monkeypatch):
        message = _failed_wait(
            monkeypatch, _response({}, status=503, reason="Service Unavailable")
        )

        assert "did not answer its health check" in message
        assert "503 Server Error: Service Unavailable" in message

    def test_a_server_newer_than_the_client_supports(self, monkeypatch):
        message = _failed_wait(monkeypatch, _response({"version": "3.1.0"}))

        assert "v3.1.0" in message
        assert "biocentral-api 2.0.0" in message
        assert "v2.0.0 up to (not including) v3.0.0" in message
        assert "pip install -U protspace" in message

    def test_a_server_older_than_the_client_supports(self, monkeypatch):
        message = _failed_wait(monkeypatch, _response({"version": "1.2.1"}))

        assert "v1.2.1" in message
        assert "older" in message
        assert "pip install" not in message, "upgrading cannot fix an old server"

    def test_a_two_digit_major_is_compared_as_a_number(self, monkeypatch):
        """As strings "10" sorts before "2", so it would be reported as older."""
        message = _failed_wait(monkeypatch, _response({"version": "10.0.0"}))

        assert "pip install -U protspace" in message

    def test_a_supported_server_that_did_not_pass_the_health_check(self, monkeypatch):
        message = _failed_wait(monkeypatch, _response({"version": "2.0.1"}))

        assert "v2.0.1" in message
        assert "health check" in message
        assert "pip install" not in message, "the client is not at fault here"

    @pytest.mark.parametrize(
        "body",
        [{}, {"version": None}, {"version": "dev"}, ["not", "a", "mapping"], b"<html>"],
        ids=["empty", "null", "not-a-number", "not-a-mapping", "not-json"],
    )
    def test_a_health_answer_without_a_readable_version(self, monkeypatch, body):
        message = _failed_wait(monkeypatch, _response(body))

        assert "without a readable version" in message


class TestCallSites:
    """Embedding, the embedder probe and the CLI all fail the same way."""

    @staticmethod
    def _unusable_server(monkeypatch):
        """A server on v3.0.0, which the 2.0.0 client refuses; returns (module, client)."""
        from protspace.data.embedding import biocentral as bc

        _server(monkeypatch, _response({"version": "3.0.0"}))
        client = _Client(error=_CLIENT_TIMEOUT)
        monkeypatch.setattr(bc, "BiocentralAPI", lambda **kwargs: client)
        return bc, client

    def test_embedding(self, monkeypatch, tmp_path):
        bc, _ = self._unusable_server(monkeypatch)

        with pytest.raises(BiocentralUnavailableError, match=r"v3\.0\.0"):
            bc.embed_sequences(
                {"P1": "MKVLAAGIVG"}, "Rostlab/prot_t5_xl_uniref50", tmp_path / "o.h5"
            )

    def test_probing_an_embedder(self, monkeypatch):
        bc, _ = self._unusable_server(monkeypatch)

        with pytest.raises(BiocentralUnavailableError, match=r"v3\.0\.0"):
            bc.probe_embedder({"P1": "MKVLAAGIVG"}, "Rostlab/prot_t5_xl_uniref50")

    @staticmethod
    def _embed(tmp_path, *models):
        from protspace.cli.app import app

        fasta = tmp_path / "in.fasta"
        fasta.write_text(">P1\nMKVLAAGIVG\n")
        args = ["embed", "-i", str(fasta), "-o", str(tmp_path / "out")]
        for model in models:
            args += ["-e", model]
        return CliRunner().invoke(app, args)

    def test_the_cli_prints_the_reason_and_exits_1_without_a_traceback(
        self, monkeypatch, tmp_path
    ):
        self._unusable_server(monkeypatch)

        result = self._embed(tmp_path, "prot_t5")

        output = plain(result.output)
        assert result.exit_code == 1, output
        assert f"ERROR: {_LEAD}" in output
        assert "v3.0.0" in output
        # An escaped exception is what typer renders as a traceback; a handled
        # failure leaves the runner a plain SystemExit.
        assert isinstance(result.exception, SystemExit), repr(result.exception)
