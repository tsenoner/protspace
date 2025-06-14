The `protspace` JSON file is designed to be self-contained, holding all the necessary data for visualization. Below is an overview of its structure.

```json
{
  "projections": {
    "PCA": {
      "dimensions": 2,
      "coordinates": [
        {"identifier": "ProteinA", "x": 0.1, "y": 0.5},
        {"identifier": "ProteinB", "x": -0.2, "y": 0.3}
      ]
    },
    "UMAP_3D": {
      "dimensions": 3,
      "coordinates": [
        {"identifier": "ProteinA", "x": 0.5, "y": 0.1, "z": 0.9},
        {"identifier": "ProteinB", "x": 0.3, "y": -0.4, "z": 0.1}
      ]
    }
  },
  "features": {
    "Family": {
      "ProteinA": "Kinase",
      "ProteinB": "Phosphatase"
    },
    "Molecular Weight": {
      "ProteinA": 55.2,
      "ProteinB": 34.1
    }
  },
  "styles": {
    "Family": {
      "colors": {
        "Kinase": "blue",
        "Phosphatase": "red"
      },
      "shapes": {
        "Kinase": "circle",
        "Phosphatase": "square"
      }
    }
  }
}
```

- **projections**: Contains one or more dimensionality reduction outputs. Each projection has a dimension (2 or 3) and a list of coordinates for each protein.
- **features**: Contains key-value pairs where the key is a feature name and the value is another dictionary mapping protein identifiers to their feature value.
- **styles**: Defines the default colors and marker shapes for the values within a given feature.