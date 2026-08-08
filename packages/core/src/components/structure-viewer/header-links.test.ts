import { describe, it, expect } from 'vitest';
import {
  getBaseAccession,
  buildAlphaFoldUrl,
  buildUniProtUrl,
  buildInterProUrl,
  buildTedUrl,
} from './header-links';

describe('header-links', () => {
  describe('getBaseAccession', () => {
    it('returns the ID unchanged when there is no dot', () => {
      expect(getBaseAccession('P0DQE9')).toBe('P0DQE9');
    });

    it('strips the version suffix after the first dot', () => {
      expect(getBaseAccession('P0DQE9.2')).toBe('P0DQE9');
    });

    it('handles multiple dots by splitting on the first one', () => {
      expect(getBaseAccession('A0A.1.2')).toBe('A0A');
    });

    it('handles an empty string', () => {
      expect(getBaseAccession('')).toBe('');
    });
  });

  describe('buildAlphaFoldUrl', () => {
    it('builds the correct AlphaFold DB URL', () => {
      expect(buildAlphaFoldUrl('P0DQE9')).toBe('https://alphafold.ebi.ac.uk/entry/P0DQE9');
    });

    it('strips the version suffix', () => {
      expect(buildAlphaFoldUrl('P0DQE9.2')).toBe('https://alphafold.ebi.ac.uk/entry/P0DQE9');
    });

    it('encodes special characters in the accession', () => {
      expect(buildAlphaFoldUrl('A B')).toBe('https://alphafold.ebi.ac.uk/entry/A%20B');
    });
  });

  describe('buildUniProtUrl', () => {
    it('builds the correct UniProtKB URL', () => {
      expect(buildUniProtUrl('P0DQE9')).toBe('https://www.uniprot.org/uniprotkb/P0DQE9/entry');
    });

    it('strips the version suffix', () => {
      expect(buildUniProtUrl('Q9UHD2.3')).toBe('https://www.uniprot.org/uniprotkb/Q9UHD2/entry');
    });

    it('encodes special characters in the accession', () => {
      expect(buildUniProtUrl('A/B')).toBe('https://www.uniprot.org/uniprotkb/A%2FB/entry');
    });
  });

  describe('buildInterProUrl', () => {
    it('builds the correct InterPro URL', () => {
      expect(buildInterProUrl('P0DQE9')).toBe(
        'https://www.ebi.ac.uk/interpro/protein/UniProt/P0DQE9/',
      );
    });

    it('strips the version suffix', () => {
      expect(buildInterProUrl('P0DQE9.2')).toBe(
        'https://www.ebi.ac.uk/interpro/protein/UniProt/P0DQE9/',
      );
    });

    it('encodes special characters in the accession', () => {
      expect(buildInterProUrl('A B')).toBe('https://www.ebi.ac.uk/interpro/protein/UniProt/A%20B/');
    });

    it('works with unreviewed (TrEMBL) accessions', () => {
      expect(buildInterProUrl('A0A0C5B5G6')).toBe(
        'https://www.ebi.ac.uk/interpro/protein/UniProt/A0A0C5B5G6/',
      );
    });
  });

  describe('buildTedUrl', () => {
    it('builds a TED URL from the base accession', () => {
      expect(buildTedUrl('W6JQJ9.2')).toBe('https://ted.cathdb.info/uniprot/W6JQJ9');
    });

    it('encodes special characters in the accession', () => {
      expect(buildTedUrl('A B')).toBe('https://ted.cathdb.info/uniprot/A%20B');
    });
  });
});
