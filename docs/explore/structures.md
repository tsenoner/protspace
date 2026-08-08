# Viewing 3D Structures

ProtSpace integrates with AlphaFold to display 3D protein structures alongside your embedding visualization.

<img src="./images/structure-viewer.png" alt="Structure Viewer - showing 3D protein structure" style="max-width: 50%; display: block; margin: 1em 0;" />

## How It Works

When you select a protein with a UniProt accession:

1. The structure viewer appears in the sidebar below the legend
2. Links to [AlphaFold Database](https://alphafold.ebi.ac.uk/), [UniProt](https://www.uniprot.org/), and [InterPro](https://www.interpro.org/) appear at the top - click them anytime
3. The AlphaFold structure file is fetched directly from the [AlphaFold Database API](https://alphafold.ebi.ac.uk/api-docs); the [3D-Beacons API](https://www.ebi.ac.uk/pdbe/pdbe-kb/3dbeacons/) is used only to look up the model page link
4. Optional TED domain annotations are requested from `https://alphafold.ebi.ac.uk/api/domains/{accession}`; the structure still loads if annotations are unavailable

::: tip Supported Structures
Currently, ProtSpace supports **AlphaFold structures** only. PDB experimental structures are not yet integrated.
:::

## Confidence and Domain Coloring

Structures initially use **predicted Local Distance Difference Test (pLDDT)** confidence scores—the same scheme used on the [AlphaFold Database](https://alphafold.ebi.ac.uk/). Regions in **blue** are high-confidence, **yellow** moderate, and **red** low-confidence. This helps you quickly spot which parts of the model are more reliable.

Use the **Color by** control to switch between **pLDDT** and **TED domains** without reloading the structure. TED mode assigns a consistent categorical color to every segment of a domain and shows residues without a TED assignment in gray. The TED domains option is disabled when valid annotations are unavailable for the selected protein.

## Viewer Controls

| Action                         | Effect                                    |
| ------------------------------ | ----------------------------------------- |
| **Color by pLDDT/TED domains** | Switch the loaded structure's color theme |
| **Left drag**                  | Rotate the structure                      |
| **Right drag**                 | Pan the view                              |
| **Scroll**                     | Zoom in/out                               |
| **Double-click**               | Reset the view                            |

## When Structures Aren't Available

Not all proteins have AlphaFold structures. When no structure is found, the viewer displays:

> "No 3D structure was found for \<Protein ID\>"

## Next Steps

- [Exporting Results](/explore/exporting) - Save your findings
- [FAQ](/guide/faq) - Common questions
