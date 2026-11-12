/**
 * Where each kind of file goes (design decision 15): said before anything is uploaded, by the
 * Import panel and by the host's empty plot. Here rather than in @protspace/core so the
 * workbench shell can show it without loading core at first paint (design decision 5).
 */
export const IMPORT_FORMAT_NOTE =
  '.parquetbundle files are read in your browser. FASTA files (.fasta, .fa, .fna) are sent to the server for embedding.';
