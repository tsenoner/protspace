# CLI Reference

Run `protspace-local --help` or `protspace-query --help` for the full list of options.

## Command Options

**protspace-local** (Local data):

- `-i, --input`: HDF5 file(s)/directory or CSV similarity matrix (required, supports multiple inputs)
- `-o, --output`: Output file or directory (optional, default: derived from input filename)
- `-a, --annotations`: Annotations to extract (comma-separated) or CSV metadata file path
- `-m, --methods`: Reduction methods (e.g., `pca2,umap3,tsne2`)
- `--non-binary`: Use legacy JSON format
- `--keep-tmp`: Cache intermediate files for reuse
- `--bundled`: Bundle output files (true/false, default: true)

**protspace-query** (UniProt search):

- `-q, --query`: UniProt search query (required)
- `-o, --output`: Output file or directory (optional, default: `protspace.parquetbundle`)
- `-a, --annotations`: Annotations to extract (comma-separated)
- `-m, --methods`: Reduction methods (e.g., `pca2,umap3,tsne2`)
- `--non-binary`: Use legacy JSON format
- `--keep-tmp`: Cache intermediate files for reuse
- `--bundled`: Bundle output files (true/false, default: true)

## Method Default Parameters

Default parameters for each method. Override these to fine-tune dimensionality reduction:

- **UMAP**: `--n_neighbors 15 --min_dist 0.1`
- **t-SNE**: `--perplexity 30 --learning_rate 200`
- **PaCMAP**: `--mn_ratio 0.5 --fp_ratio 2.0`
- **MDS**: `--n_init 4 --max_iter 300 --eps 1e-3`

## Custom Styling

```bash
protspace-annotation-colors input.json output.json --annotation_styles '{
  "annotation_name": {
    "colors": {"value1": "#FF0000", "value2": "#00FF00"},
    "shapes": {"value1": "circle", "value2": "square"}
  }
}'
```

Available shapes: `circle`, `circle-open`, `cross`, `diamond`, `diamond-open`, `square`, `square-open`, `x`

## File Formats

### Input

- **UniProt queries**: Text queries using UniProt syntax
- **Embeddings**: HDF5 files (.h5, .hdf5, .hdf) - supports single/multiple files and directories
- **Similarity matrices**: CSV files with symmetric matrices
- **Metadata**: CSV with protein identifiers in the first column + annotation columns
- **Structures**: ZIP files containing PDB/CIF files

### Output

- **Default**: Parquet files (projections_data.parquet, projections_metadata.parquet, selected_annotations.parquet)
- **Legacy**: JSON format with `--non-binary` flag
- **Temporary files**: FASTA sequences, similarity matrices, all annotations (with `--keep-tmp`)

See also: [Annotation Reference](annotations.md)
