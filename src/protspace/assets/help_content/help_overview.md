**A: Feature Selection** - Choose between protein properties to visualize<br>
**B: Projection Method** - Change between different precomputed projections<br>
**C: Search Function** - Find and highlight specific proteins and its 3D structure if provided<br>
**D: Utility Buttons** - Help menu, JSON download, JSON upload, zipped PDB upload, marker settings<br>
**E: Interactive Plot** - Click, zoom, and explore protein relationships<br>
**F: Export Graph** - Save visualization as SVG or HTML

---

##### A. Feature Selection

- Switch between features (columns provided in the CSV file)
- Color-code data points based on protein properties
- Missing values shown as `<NaN>`
- Customize colors and shapes for each feature group using the settings button

---

##### B. Projection Method

- Toggle between 2D and 3D visualizations
- PCA: Preserves global structure - [Pearson (1901)](https://doi.org/10.1080/14786440109462720)
- UMAP: Emphasizes local relationships - [McInnes et al. (2018)](https://arxiv.org/abs/1802.03426)
- PaCMAP: Can emphasizes local and global patterns, based on choosen parameters - [Wang et al. (2021)](http://jmlr.org/papers/v22/20-1061.html)
- For a comparison of dimensionality reduction methods, see [Huang et al. (2022)](https://www.nature.com/articles/s42003-022-03628-x)

---

##### C. Search Functions

- Search by protein identifier
- Select multiple proteins simultaneously
- Highlight selected proteins in plot
- View corresponding 3D structures when available

---

##### D. Utility Buttons

- *Help:* Access this guide
- *JSON Download:* Download JSON file to share with colleugues
- *JSON Upload:* Upload precomputed JSON file for visualization
- *PDB Upload:* Add protein structures as a zipped directory with PDB files named by protein identifier
- *Settings:* Customize marker shapes (circle, square, diamond, etc.) and colors

---

##### E. Interactive Plot

**2D Plot Navigation**
- *Select & Zoom:* Click and hold left mouse button to select an area
- *Reset View:* Double-click to return to full visualization

**3D Plot Navigation**
- *Orbital Rotation:* Click and hold left mouse button
- *Pan:* Click and hold right mouse button
- *Zoom:* Use mouse wheel while cursor is in graph

**Legend Interaction**
- *Hide/Show Groups:* Click on a group in legend
- *Isolate Group:* Double-click on displayed group (double-click again for all groups)

**Data Interaction**
- *View Details:* Mouse over points
- *Select Molecules:* Click on data points to select (shows protein structure if PDB structure provided)
- *Reset Selection:* Double-click on empty space in plot

---

##### F. Export Graph

- *Download Plot:* Save the current view as an SVG or HTML file for publications or presentations