"""Tests for H5 identifier parsing."""

import pytest

from protspace.data.loaders.h5 import parse_identifier


class TestParseIdentifier:
    def test_swissprot_header(self):
        assert parse_identifier("sp|P12345|PROT_HUMAN") == "P12345"

    def test_trembl_header(self):
        assert parse_identifier("tr|A0A0K3AVP0|A0A0K3AVP0_HUMAN") == "A0A0K3AVP0"

    def test_generic_pipe_delimited(self):
        assert parse_identifier("custom|ABC123|extra") == "ABC123"

    def test_plain_id(self):
        assert parse_identifier("P12345") == "P12345"

    def test_accession_with_isoform(self):
        # Pipe-delimited but not UniProt pattern — takes second field
        assert parse_identifier("xx|P12345-2|name") == "P12345-2"

    def test_single_pipe(self):
        assert parse_identifier("field1|field2") == "field2"

    def test_no_pipe(self):
        assert parse_identifier("some_protein_name") == "some_protein_name"

    def test_empty_string(self):
        assert parse_identifier("") == ""

    def test_swissprot_6char_accession(self):
        assert parse_identifier("sp|Q9NR56|MBOA1_HUMAN") == "Q9NR56"
