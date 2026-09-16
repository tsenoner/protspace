import { describe, it, expect } from 'vitest';
import {
  buildAlphaFoldUrl,
  buildUniProtUrl,
  buildInterProUrl,
  buildTedUrl,
  RESOURCE_LINKS,
} from './header-links';

describe('header-links', () => {
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

  describe('RESOURCE_LINKS', () => {
    it('renders the whole row, in order, from the matching builders', () => {
      expect(
        RESOURCE_LINKS.map((resource) => [resource.label, resource.build('W6JQJ9.2')]),
      ).toEqual([
        ['AlphaFold', 'https://alphafold.ebi.ac.uk/entry/W6JQJ9'],
        ['UniProt', 'https://www.uniprot.org/uniprotkb/W6JQJ9/entry'],
        ['InterPro', 'https://www.ebi.ac.uk/interpro/protein/UniProt/W6JQJ9/'],
        ['TED', 'https://ted.cathdb.info/uniprot/W6JQJ9'],
      ]);
    });
  });
});
