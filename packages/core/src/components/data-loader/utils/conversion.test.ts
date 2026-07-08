import { describe, it, expect } from 'vitest';
import { parseAnnotationValue, splitCategoricalAnnotationValues } from './conversion';

describe('parseAnnotationValue', () => {
  it('parses label without pipe as full string with empty scores', () => {
    const result = parseAnnotationValue('taxonomy_value');
    expect(result.label).toBe('taxonomy_value');
    expect(result.scores).toEqual([]);
    expect(result.evidence).toBeNull();
  });

  it('parses label|score with single numeric score', () => {
    const result = parseAnnotationValue('PF00001 (7tm_1)|1.5e-10');
    expect(result.label).toBe('PF00001 (7tm_1)');
    expect(result.scores).toHaveLength(1);
    expect(result.scores[0]).toBeCloseTo(1.5e-10);
    expect(result.evidence).toBeNull();
  });

  it('parses label|score1,score2 with multiple comma-separated scores', () => {
    const result = parseAnnotationValue('PF00001|1.5e-10,2.3e-5');
    expect(result.label).toBe('PF00001');
    expect(result.scores).toHaveLength(2);
    expect(result.scores[0]).toBeCloseTo(1.5e-10);
    expect(result.scores[1]).toBeCloseTo(2.3e-5);
    expect(result.evidence).toBeNull();
  });

  it('keeps GO:0005524|ATP binding intact (non-numeric after pipe)', () => {
    const result = parseAnnotationValue('GO:0005524|ATP binding');
    expect(result.label).toBe('GO:0005524|ATP binding');
    expect(result.scores).toEqual([]);
    expect(result.evidence).toBeNull();
  });

  it('handles empty string gracefully', () => {
    const result = parseAnnotationValue('');
    expect(result.label).toBe('');
    expect(result.scores).toEqual([]);
    expect(result.evidence).toBeNull();
  });

  it('handles whitespace-only string gracefully', () => {
    const result = parseAnnotationValue('   ');
    expect(result.label).toBe('');
    expect(result.scores).toEqual([]);
    expect(result.evidence).toBeNull();
  });

  it('handles pipe at end of string', () => {
    const result = parseAnnotationValue('label|');
    expect(result.label).toBe('label|');
    expect(result.scores).toEqual([]);
    expect(result.evidence).toBeNull();
  });

  it('handles negative numeric scores', () => {
    const result = parseAnnotationValue('domain|-3.5');
    expect(result.label).toBe('domain');
    expect(result.scores).toEqual([-3.5]);
    expect(result.evidence).toBeNull();
  });

  it('handles zero score', () => {
    const result = parseAnnotationValue('domain|0');
    expect(result.label).toBe('domain');
    expect(result.scores).toEqual([0]);
    expect(result.evidence).toBeNull();
  });

  it('handles mixed valid and invalid comma-separated values after pipe', () => {
    // If any part is non-numeric, the whole thing is kept as label
    const result = parseAnnotationValue('label|1.5,abc');
    expect(result.label).toBe('label|1.5,abc');
    expect(result.scores).toEqual([]);
    expect(result.evidence).toBeNull();
  });

  it('handles multiple pipes — uses last pipe for score detection', () => {
    const result = parseAnnotationValue('GO:123|description|1.5e-3');
    expect(result.label).toBe('GO:123|description');
    expect(result.scores).toEqual([1.5e-3]);
    expect(result.evidence).toBeNull();
  });

  // Evidence code tests
  it('parses Cytoplasm|EXP as label with EXP evidence', () => {
    const result = parseAnnotationValue('Cytoplasm|EXP');
    expect(result.label).toBe('Cytoplasm');
    expect(result.scores).toEqual([]);
    expect(result.evidence).toBe('EXP');
  });

  it('parses apoptotic process|IDA as label with IDA evidence', () => {
    const result = parseAnnotationValue('apoptotic process|IDA');
    expect(result.label).toBe('apoptotic process');
    expect(result.scores).toEqual([]);
    expect(result.evidence).toBe('IDA');
  });

  it('does not treat long unknown codes as evidence', () => {
    const result = parseAnnotationValue('value|TOOLONG123');
    expect(result.label).toBe('value|TOOLONG123');
    expect(result.scores).toEqual([]);
    expect(result.evidence).toBeNull();
  });

  it('does not treat single uppercase letter as evidence', () => {
    const result = parseAnnotationValue('value|A');
    expect(result.label).toBe('value|A');
    expect(result.scores).toEqual([]);
    expect(result.evidence).toBeNull();
  });

  it('parses all standard GO evidence codes', () => {
    const codes = [
      // Original 11
      'EXP',
      'HDA',
      'IDA',
      'TAS',
      'NAS',
      'IC',
      'ISS',
      'SAM',
      'COMB',
      'IMP',
      'IEA',
      // Additional GO evidence codes
      'IPI',
      'IGI',
      'IEP',
      'HTP',
      'HMP',
      'HGI',
      'HEP',
      'IBA',
      'IBD',
      'IKR',
      'IRD',
      'ISA',
      'ISO',
      'ISM',
      'RCA',
      'ND',
    ];
    for (const code of codes) {
      const result = parseAnnotationValue(`some label|${code}`);
      expect(result.label).toBe('some label');
      expect(result.scores).toEqual([]);
      expect(result.evidence).toBe(code);
    }
  });

  it('parses raw ECO ID format as evidence', () => {
    const result = parseAnnotationValue('Cytoplasm|ECO:0000269');
    expect(result.label).toBe('Cytoplasm');
    expect(result.scores).toEqual([]);
    expect(result.evidence).toBe('ECO:0000269');
  });

  it('prefers numeric score over evidence code for numeric suffixes', () => {
    const result = parseAnnotationValue('PF00001|162.3');
    expect(result.label).toBe('PF00001');
    expect(result.scores).toEqual([162.3]);
    expect(result.evidence).toBeNull();
  });
});

describe('splitCategoricalAnnotationValues', () => {
  it('splits distinct hits on the top-level ; separator', () => {
    expect(splitCategoricalAnnotationValues('PF00001 (7tm_1)|1.5e-10;PF00002 (Foo)|30.0')).toEqual([
      'PF00001 (7tm_1)|1.5e-10',
      'PF00002 (Foo)|30.0',
    ]);
  });

  it('keeps a CATH-Gene3D name containing ";" intact as a single category', () => {
    // Real-world shape: the name itself contains semicolons inside the parentheses.
    expect(
      splitCategoricalAnnotationValues(
        'G3DSA:3.100 (Ribosomal Protein L15; Chain: K; domain 2)|45.2',
      ),
    ).toEqual(['G3DSA:3.100 (Ribosomal Protein L15; Chain: K; domain 2)|45.2']);
  });

  it('splits two CATH hits whose names both contain ";"', () => {
    expect(
      splitCategoricalAnnotationValues(
        'G3DSA:3.100 (Ribosomal Protein L15; Chain: K; domain 2)|45.2;' +
          'G3DSA:2.40 (Acid Proteases; Chain A)|30.0',
      ),
    ).toEqual([
      'G3DSA:3.100 (Ribosomal Protein L15; Chain: K; domain 2)|45.2',
      'G3DSA:2.40 (Acid Proteases; Chain A)|30.0',
    ]);
  });

  it('handles nested balanced parentheses in a name', () => {
    expect(
      splitCategoricalAnnotationValues('G3DSA:2.60 (3-Layer(aba) Sandwich; domain 1)|12.0'),
    ).toEqual(['G3DSA:2.60 (3-Layer(aba) Sandwich; domain 1)|12.0']);
  });

  it('still splits plain multi-value cells without parentheses', () => {
    expect(splitCategoricalAnnotationValues('Cytoplasm;Nucleus;Membrane')).toEqual([
      'Cytoplasm',
      'Nucleus',
      'Membrane',
    ]);
  });

  it('falls back to a plain split when a name has an unbalanced "(" so distinct hits are not merged', () => {
    // The name "YojJ-like (1" never closes its paren; depth never returns to 0, so the
    // paren-aware scan would swallow the inter-hit ";". The fallback keeps the two hits apart.
    expect(
      splitCategoricalAnnotationValues('G3DSA:1.10 (YojJ-like (1)|9.0;G3DSA:3.40 (Bar)|8.0'),
    ).toEqual(['G3DSA:1.10 (YojJ-like (1)|9.0', 'G3DSA:3.40 (Bar)|8.0']);
  });

  it('returns an empty array for missing cells', () => {
    expect(splitCategoricalAnnotationValues(null)).toEqual([]);
    expect(splitCategoricalAnnotationValues('')).toEqual([]);
  });
});

describe('parseAnnotationValue v2', () => {
  it('decodes an encoded name and keeps the score', () => {
    const raw = 'G3DSA:1.10 (Ribosomal Protein L15%3B Chain: K)|50.2';
    const r = parseAnnotationValue(raw, 2);
    expect(r.label).toBe('G3DSA:1.10 (Ribosomal Protein L15; Chain: K)');
    expect(r.scores).toEqual([50.2]);
    expect(r.evidence).toBeNull();
  });
  it('decodes evidence-coded value', () => {
    expect(parseAnnotationValue('Cytoplasm|EXP', 2)).toEqual({
      label: 'Cytoplasm',
      scores: [],
      evidence: 'EXP',
    });
  });
  it('v2 discriminating test: decodes encoded reserved char in label with evidence code', () => {
    // Under v2, the label 'Cytop%3Blasm' (with encoded semicolon) should be decoded to 'Cytop;lasm'
    const v2Result = parseAnnotationValue('Cytop%3Blasm|EXP', 2);
    expect(v2Result).toEqual({
      label: 'Cytop;lasm',
      scores: [],
      evidence: 'EXP',
    });
    // Under v1, the label would remain encoded as 'Cytop%3Blasm' (not decoded),
    // but evidence code is still recognized
    const v1Result = parseAnnotationValue('Cytop%3Blasm|EXP', 1);
    expect(v1Result.label).toBe('Cytop%3Blasm');
    expect(v1Result.evidence).toBe('EXP');
  });
});

describe('splitCategoricalAnnotationValues v2', () => {
  it('plain-splits on ; (names carry no raw ;)', () => {
    const raw = 'A (n%3B1)|1;B (n%3B2)|2';
    expect(splitCategoricalAnnotationValues(raw, 2)).toEqual(['A (n%3B1)|1', 'B (n%3B2)|2']);
  });
});
