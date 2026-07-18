# What is ProtSpace?

**ProtSpace** is a browser-based tool for exploring protein language model (pLM) embeddings. It maps the embedding space — not a sequence-similarity network — to reveal relationships that sequence similarity misses, letting you overlay biological annotations and turn high-dimensional protein data into testable hypotheses. Nothing is uploaded.

## Why Use ProtSpace?

Protein language models (like ProtT5, ESM2, Ankh) create embeddings that capture biological information in hundreds or thousands of dimensions. ProtSpace helps you:

- **See patterns**: Visualize how proteins cluster based on their embeddings
- **Explore relationships**: Find proteins with similar properties
- **Discover insights**: Identify functional groupings and evolutionary clusters
- **Share findings**: Export figures or the dataset itself for others to explore

## Key Features

| Feature              | Description                                                                |
| -------------------- | -------------------------------------------------------------------------- |
| **No Installation**  | Runs entirely in your browser at [protspace.app](https://protspace.app)    |
| **Privacy-First**    | Your data never leaves your computer - all processing is client-side       |
| **Multiple Views**   | Compare several dimensionality-reduction views of the same embedding space |
| **Rich Annotations** | Color by UniProt, InterPro, Taxonomy, or custom expert annotations         |
| **3D Structures**    | View protein structures from the AlphaFold Database                        |
| **Export Options**   | Save images (PNG, PDF), data (Parquet), and protein IDs                    |

## How It Works

1. **Prepare data**: Generate a `.parquetbundle` file using our [Google Colab notebook](/guide/data-preparation) or [Python CLI](/guide/python-cli)
2. **Load file**: Drag & drop onto the [Explore page](https://protspace.app/explore)
3. **Explore**: Navigate, filter, and discover patterns in your protein data

## Privacy and Security

ProtSpace processes everything locally in your browser:

- **No uploads**: Files never leave your computer
- **No tracking**: We don't collect any usage data
- **Open source**: Fully transparent [codebase on GitHub](https://github.com/tsenoner/protspace)

## Use Cases

- **Functional Analysis**: Group proteins by predicted function
- **Evolutionary Studies**: Identify convergent evolution patterns
- **Quality Control**: Check embedding model outputs for biases
- **Education**: Teach protein bioinformatics interactively
- **Publication**: Create figures for papers and presentations

## Performance

ProtSpace can handle datasets with **570,000+ proteins** (full Swiss-Prot scale) directly in your browser without server uploads.

## Next Steps

- **[Quick Start](/)** - Get started in 5 minutes
- **[Using Google Colab](/guide/data-preparation)** - Prepare your data
- **[Using the Explore Page](/explore/)** - Learn all the features
