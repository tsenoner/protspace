# CHANGELOG


## v2.1.2 (2025-07-07)

### Fixes

* fix(examples): update jupyter notebooks to use current CLI commands

Replace deprecated 'protspace-json' command with 'protspace-local' in example notebooks:
- examples/notebook/PfamExplorer_ProtSpace.ipynb
- examples/notebook/Run_ProtSpace.ipynb

This ensures the example notebooks work with the current CLI interface and
improves the user experience for notebook-based workflows. ([`c08d241`](https://github.com/tsenoner/protspace/commit/c08d241aaf5bb0b402b6c409a577220af86a3e11))


## v2.1.1 (2025-07-07)

### Chores

* chore: update Dockerfile and improve script formatting in protspace_local.py

- Added curl installation to Dockerfile to work for pymmseqs2.
- Reformatted command arguments in run_prepare_json_script for better readability in protspace_local.py. ([`07ec5aa`](https://github.com/tsenoner/protspace/commit/07ec5aaec244c6b19efba185c0e8361ec611dfc2))

### Fixes

* fix(docker): add curl dependency and fix jupyter notebook imports

1. Docker build fix:
   - Add curl dependency to resolve pymmseqs build failure
   - The pymmseqs package requires curl to download the MMseqs2 binary during installation
   - Without curl, Docker builds fail with 'curl: not found' error
   - This resolves: scripts/download_mmseqs.sh: 37: curl: not found

2. Jupyter notebook import fix:
   - Updated import path from 'from protspace.app import ProtSpace' to 'from protspace import ProtSpace'
   - Modified src/protspace/__init__.py to expose ProtSpace at package level
   - This simplifies imports for users in notebooks and examples

Fixes the Docker build failure in GitHub Actions and improves the developer experience for notebook users. ([`26d973e`](https://github.com/tsenoner/protspace/commit/26d973e96ab8d7d2a9611af08bb493ec29d3cef7))

### Refactoring

* refactor: enhance data input handling in main.py for ProtSpace

- Consolidated JSON and Arrow directory input into a single argument.
- Implemented a new function to detect data type and validate input paths.
- Updated ProtSpace initialization to accommodate the new input structure. ([`6a5a9d6`](https://github.com/tsenoner/protspace/commit/6a5a9d6994d24c62a79ac9bccabed6082c8487b1))

* refactor: update import paths and modify ProtSpace initialization in image_creation.py

- Changed import of ProtSpace to a direct import from protspace.
- Updated initialization in image_creation.py to use arrow_dir instead of json_file.
- Cleaned up __init__.py to reflect the new import structure and removed unused imports. ([`9e65502`](https://github.com/tsenoner/protspace/commit/9e655026174dc4f167eafabfe8f24cd314fb789d))

### Unknown

* revert: manual version bump to prepare for semantic release ([`304acfc`](https://github.com/tsenoner/protspace/commit/304acfc638b0504646ff374d8f2c2e84ef7c68da))

* bump: version 2.1.0 → 2.2.0 (includes curl fix for pymmseqs build) ([`08b86f6`](https://github.com/tsenoner/protspace/commit/08b86f600a1c229baee7372dbbd7a74c2f3f35ab))


## v2.1.0 (2025-07-04)

### Documentation

* docs: update README and add new CLI scripts for protspace-query and protspace-local ([`5485a6c`](https://github.com/tsenoner/protspace/commit/5485a6c33f5847007b605bebb3432b02ae1de718))

* docs: update README to include detailed usage instructions for protspace-query and local data processing commands

- Added examples for `protspace-query` to search proteins from UniProt.
- Clarified required and optional arguments for both `protspace-query` and `protspace-local`.
- Enhanced descriptions for input types and method-specific parameters. ([`957e3b9`](https://github.com/tsenoner/protspace/commit/957e3b9f863d335a7d46d6e7f63edc6fe75d16d5))

### Features

* feat(ci): update release workflow to handle protected branches

- Add support for SEMANTIC_RELEASE_TOKEN to bypass branch protection
- Improve error handling and output management in release workflow
- Add fallback to GITHUB_TOKEN if PAT not available
- Create setup guide for PAT configuration
- Enable fully automated releases with protected main branch ([`45ccd1c`](https://github.com/tsenoner/protspace/commit/45ccd1ca0b9904f80454b6ab9570b5b84a84df37))

* feat: add support for Apache Arrow data format in ProtSpace

- Introduced ArrowReader class for reading and manipulating Arrow/Parquet files.
- Added new flags for protspace-query and protspace-local called --non-binary, if using this flag, everything is like before, otherwise using apache arrow format
- protspace cli has a new argument called --arrow, to pass a arrow files directory ([`ebac3c4`](https://github.com/tsenoner/protspace/commit/ebac3c4d9931f41af058e1c67ace6c3494b455a4))

* feat: enhance metadata validation in protspace-query, not to accept csv files as metadata ([`1a3d680`](https://github.com/tsenoner/protspace/commit/1a3d680c8375b342c2bfb9beae2ce840daffea65))

* feat: add UniProt query CLI tool and related data processing modules

This commit introduces a new CLI for querying UniProt, with several supporting modules for data retrieval and processing. Key additions include:
- `uniprot_query.py`: CLI for searching and processing proteins from UniProt.
- `uniprot_feature_retriever.py`: Renamed old `uniprot_fetcher.py` to this
- `uniprot_query_processor.py`: Handles query processing and data analysis.
- Updates in `generate_csv.py` to use the new feature retriever. ([`9f2b661`](https://github.com/tsenoner/protspace/commit/9f2b661185339976db0e4c6ac0591991d9bc49c5))

* feat: implement length binning features in ProteinFeatureExtractor
- Now a csv file is created based on all available features and then we filter them based on user requested features ([`b54f323`](https://github.com/tsenoner/protspace/commit/b54f3234eb9aad7615b20922be3d5f23c6f3cd7e))

* feat: enhance CSV processing by adding protein families handling ([`27cc6d4`](https://github.com/tsenoner/protspace/commit/27cc6d4512ef69d90a4fe9b34095f84c09a9bbc0))

* feat: expand taxonomy features and implement cache refresh logic in TaxonomyFetcher ([`0395d26`](https://github.com/tsenoner/protspace/commit/0395d26651e816d9827eac116c524a552ae43c38))

* feat: refactor DataProcessor with the new automated metadata generation logic ([`cb21caf`](https://github.com/tsenoner/protspace/commit/cb21cafb441b9a6662a84f368fa66171f6134987))

* feat(notebook): enhance ClickThrough_GenerateEmbeddings notebook with new model options and improved embedding generation logic

- Updated installation cell to include additional dependencies for ESM and Hugging Face.
- Added optional Hugging Face login cell for models requiring authentication.
- Improved model selection and embedding generation logic, including handling for different model types and sequence lengths.
- Enhanced error handling for invalid headers in the output dataset.
- Updated output file naming to include model type for clarity. ([`adc6553`](https://github.com/tsenoner/protspace/commit/adc6553988c345d4181211fab4b6d7853274885b))

### Fixes

* fix(tests): update tests for new architecture and add automatic ChromeDriver management

- Fix import paths: ProtSpace moved to server.app, DataProcessor to LocalDataProcessor
- Update LocalDataProcessor API usage in tests to match new method signatures
- Add conftest.py for automatic ChromeDriver version management using webdriver-manager
- Resolve Chrome/ChromeDriver version mismatch issues
- All tests now passing: 4/4 app tests, 4/4 sampled data processing tests ([`932734a`](https://github.com/tsenoner/protspace/commit/932734a019bfc1cb5a27a3e08e71a136c4322056))

* fix: correct import and variable names from REDUCER_METHODS to REDUCERS ([`e9f5a29`](https://github.com/tsenoner/protspace/commit/e9f5a2960dbb4290e20332929803b85552411876))

* fix: remove limit on UniProt headers in fetch_features method ([`1acdbcf`](https://github.com/tsenoner/protspace/commit/1acdbcf7146f16b1dade74ae050e41ac079ee2d1))

* fix(config): update marker shape configuration to use ValidatorCache

To work with Plotly update
This commit modifies the marker shape configuration in `config.py` to utilize `ValidatorCache` for improved performance and maintainability. The `SymbolValidator` is now retrieved from the cache, streamlining the extraction of marker shapes for both 2D and 3D plots. ([`e5931f9`](https://github.com/tsenoner/protspace/commit/e5931f9fecbc551cf3f4e3ee99f271c991a00c2b))

### Refactoring

* refactor: change data type conversion to np.float32 in BaseDataProcessor ([`c9483cb`](https://github.com/tsenoner/protspace/commit/c9483cbd2e8af3e3beddd3b44d1d80092e823b80))

* refactor: remove sp filtering from UniProt query processing, users should provide the exact query themselves ([`f077a23`](https://github.com/tsenoner/protspace/commit/f077a23b3c7641d8853d561b7b557d8ccc78f071))

* refactor: restructure data processors with inheritance-based architecture

- Replace prepare_json.py with modular BaseDataProcessor and LocalDataProcessor classes
- Extract common data processing logic into BaseDataProcessor base class
- Refactor UniProtQueryProcessor to inherit from BaseDataProcessor
- Move local data CLI functionality to dedicated cli/local_data.py module
- Update entry points and imports to reflect new module structure
- Improve code organization and reduce duplication across processors

Breaking change: rename protspace-json CLI command to protspace-local ([`9a627e6`](https://github.com/tsenoner/protspace/commit/9a627e6935ba7dad3c9ace3094b049179b0d88fa))

* refactor: update import paths to use absolute imports for consistency and clarity ([`8ee68ac`](https://github.com/tsenoner/protspace/commit/8ee68acd8c94c13d760d3440dc7f3b24618c97d5))

* refactor: update import paths and clean up whitespace in various files; enhance .gitignore to include additional data directories ([`1f1b48b`](https://github.com/tsenoner/protspace/commit/1f1b48b0af21df21f8a3f7ee2f87b35135c0cfbe))

### Unknown

* Merge branch 'stage' ([`5a0030e`](https://github.com/tsenoner/protspace/commit/5a0030eaff34b0ee5c64d56e0b98a1fd1c01f1ac))

* Rename class name ([`38fd3ff`](https://github.com/tsenoner/protspace/commit/38fd3ff81b27efe5f33e9776eae9fd82634347ae))

* Merge branch 'main' into stage ([`852ddde`](https://github.com/tsenoner/protspace/commit/852ddde1f79b6a899a15af18441a9c620941818c))

* Merge branch 'stage' of https://github.com/tsenoner/protspace into stage ([`3ecafc7`](https://github.com/tsenoner/protspace/commit/3ecafc79b25ac6b3e315f78e2c2b88b48dbadf01))

* Merge pull request #6 from heispv:develop

Extract and parse metadata from UniProt automatically ([`bd9fe6d`](https://github.com/tsenoner/protspace/commit/bd9fe6d082cadb6828c971ca6af17955cf6a5ba4))

* Merge branch 'pr/heispv/6' into stage ([`b1cafb5`](https://github.com/tsenoner/protspace/commit/b1cafb5d36015dc5cd71177449520fa9671b28d1))

* Add taxonomy fetcher, move uniprot fetcher to a separate file, update dependencies ([`d568c65`](https://github.com/tsenoner/protspace/commit/d568c6523cfb89775e94b4f7c79acb6f8c18bcfe))

* Enhance CSV generation by modifying 'annotation_score' values before writing rows ([`5e01a61`](https://github.com/tsenoner/protspace/commit/5e01a6191ee2ddee885659e0d210fefcf61a3b60))

* Removing some prefixes ([`78aa3e5`](https://github.com/tsenoner/protspace/commit/78aa3e5f6daacf1c225abf56de30b084e6d141cb))

* Using number of the seqs instead of batches for the progress bar ([`721e7cb`](https://github.com/tsenoner/protspace/commit/721e7cb0739a22ef20c9fa8a76b6a62b4f52dbeb))

* Update a package and sync uv lock ([`0a8e0e9`](https://github.com/tsenoner/protspace/commit/0a8e0e92fd61a5d89b20d35f1a5bc5ff895f9952))

* Minor fix in the custom names arg ([`53fb12f`](https://github.com/tsenoner/protspace/commit/53fb12f8575608d473a0c83b0a69a4797a1ad9fb))

* Resolve the logo issue in ui ([`ac3476d`](https://github.com/tsenoner/protspace/commit/ac3476dec0c38e280a18e9b098239f74547a89b8))

* Managing default uniprot headers to extract accession correctly ([`fbb3f90`](https://github.com/tsenoner/protspace/commit/fbb3f90d6a9d793b00f02a9108e6d8c526c59d15))

* Updating args to use comma separated inputs ([`d4f4a83`](https://github.com/tsenoner/protspace/commit/d4f4a839e30f6ec0dc925811f2022c9e9e52b895))

* Minor import update ([`57f76c3`](https://github.com/tsenoner/protspace/commit/57f76c33bd8ebd9e2804e1778975d2c1613b6403))

* Updates based on new modularization logic ([`3d5aad2`](https://github.com/tsenoner/protspace/commit/3d5aad2db50c5ffb6d62ccb541d2b8be198602bb))

* Adding server module ([`b142c74`](https://github.com/tsenoner/protspace/commit/b142c7460f9071feea91bf914bc5c47416d1f682))

* Adding visualization module ([`e67d4e9`](https://github.com/tsenoner/protspace/commit/e67d4e94ef23683c3f77d90ef44bbc8feabc6190))

* Creating ui module ([`a6f98a8`](https://github.com/tsenoner/protspace/commit/a6f98a80ba9e691a7b13de3f625c5a9473296814))

* Moving data related files to data module ([`141e511`](https://github.com/tsenoner/protspace/commit/141e5114595ab0a7b22f0c3176025a4ddcd549bf))

* Modified examples ([`fb7483f`](https://github.com/tsenoner/protspace/commit/fb7483fa3f21f3c59bdc839197cc2e183a760ebe))

* Adding progress bar during data fetching through uniprot ([`11e98f1`](https://github.com/tsenoner/protspace/commit/11e98f12a9cce6c9ee94c275bc55d55849a8c8b3))

* Adding bioservices ([`534a73a`](https://github.com/tsenoner/protspace/commit/534a73aa6b4a7993b850aba85d96c6cb1f7fe208))

* Improved ProteinFeatureExtractor class, added batch size for request ([`7c7b78d`](https://github.com/tsenoner/protspace/commit/7c7b78dd9b5dee91aaefbbb914e179dbb6c27fbb))

* Moving reducers to another file ([`6f40fb6`](https://github.com/tsenoner/protspace/commit/6f40fb6a3c8d2e7bbab0f5105e5e2b0856dc2816))

* Moving the available FEATURES to this file ([`fea0b40`](https://github.com/tsenoner/protspace/commit/fea0b4082ac9a6f647eb1a44f2361f19efacb2de))

* Adding a class for protein feature extraction from uniprot ([`7493644`](https://github.com/tsenoner/protspace/commit/74936440e60ca9ce8bd85c939490431c7cfb7f69))


## v2.0.1 (2025-06-15)

### Fixes

* fix(docker): resolve Kaleido and markdown helper dependencies

This commit addresses two critical functionality issues in the Docker container:

1. Kaleido Image Generation:
- Adds libexpat1 to the runtime stage of the Dockerfile
- Ensures proper library availability for Kaleido subprocess
- Maintains clean image by removing apt lists after installation

2. Markdown Helper:
- Adds build-essential and gcc to build stage for proper compilation
- Ensures markdown content is properly accessible in container
- Fixes path resolution for helper markdown files

These changes restore both the image generation functionality and markdown
helper features while maintaining container performance and security best
practices. ([`de89ddb`](https://github.com/tsenoner/protspace/commit/de89ddbc808e139e3b2e2cf8c98fd53505e93278))


## v2.0.0 (2025-06-15)

### Breaking

* fix(ui): dropdown direction and color synchronization

This commit addresses two UI-related issues:

1. Download Format Dropdown:
- fix: make dropdown menu open upwards by wrapping in div with drop-up class
- style: prevent dropdown from being obscured by elements below

2. Color Management:
- fix: synchronize colors between scatter plot, legend and color picker
- feat: add default color generation for JSON files without styling
- fix: properly handle color conversion between rgba and hex formats
- fix: ensure consistent color display for NaN values

BREAKING CHANGE: None ([`bd65fd2`](https://github.com/tsenoner/protspace/commit/bd65fd281cd8b74736b7fdc16992a6855e762563))

### Features

* feat(viewer): replace NGL Viewer with Molstar Viewer

- Replace NglMoleculeViewer with dash-molstar component
- Add molstar_helper.py for data handling and AlphaFold DB fetching
- Refactor styles from callbacks into centralized styles.py
- Remove obsolete NGL viewer code ([`2475c53`](https://github.com/tsenoner/protspace/commit/2475c539680b8f323bcab73ba0d21387442fef45))

* feat(app): Overhaul plotting, styling, and UI interactivity

This commit introduces a comprehensive set of improvements, including major refactoring, new features, and numerous bug fixes to enhance user experience, code maintainability, and performance.

**Refactoring:**

- Separated style application from plot generation into distinct callbacks, improving performance and preventing unintended side-effects.
- Consolidated duplicated plotting logic into a single, centralized `create_plot` function.
- Unified the side-panel (Help and Settings) logic into a single, more robust callback.
- Streamlined marker shape configuration in `config.py` for better consistency and clarity.
- Refactored the `save_plot` function to write directly to an in-memory buffer, making downloads more efficient.
- Corrected the data access pattern in `data_loader.py` to prevent crashes and align with the actual data schema.

**Features & Enhancements:**

- **Plot & Legend:**
  - Decoupled legend size from the main marker size with a new, independent "Legend Size" input field for granular control.
  - The legend size now updates instantly on input change for a better user experience.
  - Re-implemented the custom legend trace logic to ensure markers are large, clear, and free of duplicates.
  - The marker shape dropdown now dynamically updates based on whether the plot is 2D or 3D.
- **Styling:**
  - Implemented default styling for `<NaN>` values and made their shape configurable.
  - Ensured all data points correctly default to a "circle" marker if no specific shape is defined.
  - The `<NaN>` option now only appears in the styling dropdown if the selected feature actually contains missing values.
- **Downloads:**
  - Expanded download options to include PNG, JPEG, WEBP, PDF, and HTML.
  - Enforced the correct filename format for all downloads: `<dim_reduction>_<feature>.<format>`.

**Bug Fixes:**

- **CRITICAL:** Fixed a style-bleeding bug where style changes for a value in one feature would incorrectly apply to other features.
- Fixed a `KeyError: 'annotations'` crash on application startup.
- Resolved multiple crashes and errors related to the download functionality.
- Fixed a crash when using 2D-only marker shapes in 3D plots.
- Fixed an `AttributeError` crash caused by scrambled callback parameters.
- Corrected various minor UI and data handling bugs. ([`f5705eb`](https://github.com/tsenoner/protspace/commit/f5705eb7a6ff1dee3afb6fc74fed4edaccc5251d))

* feat(app): overhaul plotting, styling, and download functionality

This commit introduces a major overhaul of the application's core features, including significant refactoring, new functionality, and numerous bug fixes to improve user experience and code maintainability.

**Refactoring:**

- Consolidated all plotting logic into a single, centralized `create_plot` function in `plotting.py`, removing duplicated code from `callbacks.py`.
- Refactored the `save_plot` function to write directly to an in-memory buffer, making downloads more efficient and fixing several related bugs.
- Streamlined marker shape configuration by removing redundant variables in `config.py` and enforcing a consistent `MARKER_SHAPES_2D` and `MARKER_SHAPES_3D` structure across the application.
- Corrected the data access pattern in `data_loader.py` to prevent crashes and ensure correct feature value retrieval.

**Features & Enhancements:**

- **Legend:**
  - Resolved marker overlap in the legend for better readability.
  - Implemented a workaround using dummy traces to allow for larger legend markers.
  - Ensured the legend is always sorted alphanumerically.
- **Styling:**
  - Implemented default styling for `<NaN>` values (semi-transparent gray, circle shape) and made them configurable.
  - Ensured all data points default to a "circle" marker if no specific shape is defined, preventing inconsistent automatic shape assignment.
  - The marker shape dropdown now dynamically updates based on whether the plot is 2D or 3D.
- **Downloads:**
  - Expanded download options to include PNG, JPEG, WEBP, PDF, and HTML.
  - Implemented the correct filename format for downloads: `<dim_reduction>_<feature>.<format>`.
- **UI/UX:**
  - The `<NaN>` option now only appears in the styling dropdown if the selected feature contains missing values.

**Bug Fixes:**

- Fixed a critical bug where style changes for a value in one feature would incorrectly bleed into other features upon switching.
- Corrected a `KeyError: 'annotations'` crash on startup.
- Resolved multiple crashes related to the download functionality (`TypeError`, `ValueError: Invalid format ''`).
- Fixed an issue where the marker shape dropdown was not updating correctly.
- Prevented crashes when using 2D-only marker shapes in 3D plots. ([`a0b9299`](https://github.com/tsenoner/protspace/commit/a0b92991382c585d8748de4a70879a4ac1664526))

### Refactoring

* refactor(config): Centralize settings and simplify callbacks

This commit improves maintainability by centralizing configuration and reducing duplicated logic.

- Hardcoded side panel widths are now defined in `config.py`.
- A new `is_projection_3d` helper function was created to simplify dimension-checking logic in callbacks, removing redundancy. ([`7e70c1b`](https://github.com/tsenoner/protspace/commit/7e70c1b89e2f35c536346c48ec4e4b5b6e300ba4))

* refactor(ui): Overhaul codebase for maintainability and redesign help system

This commit introduces a major architectural refactoring to improve modularity, simplify logic, and enhance long-term maintainability. It also completely redesigns the help menu for better user experience and easier content management.

**Refactoring:**

- **Data Processing & Plotting:**
  - Eliminated the `data_processing.py` module by moving its data preparation logic directly into `plotting.py`, improving code locality.
  - The monolithic `create_plot` function was broken down into smaller, focused helper functions (`_create_base_figure`, `_add_legend_traces`, etc.) for significantly improved readability.
  - A new `helpers.py` module was created for general utility functions, starting with `standardize_missing`.

- **Callbacks:**
  - Replaced the complex, multi-purpose `toggle_side_panels` callback with a reusable `create_side_panel_callback` factory. This simplifies the logic for managing side panels and makes it easily extensible.

- **Layout:**
  - The `create_layout` function was streamlined to correctly initialize the application state from the main `ProtSpace` class, resolving multiple bugs.

**Features & Enhancements:**

- **Help Menu Overhaul:**
  - Re-implemented the help menu to use a robust, tabbed interface (`dbc.Tabs`).
  - Help content is now managed in separate, easy-to-edit Markdown files located in a dedicated `assets/help_content/` directory.
  - The "Interface Overview" tab now features interactive jump links that scroll to the relevant sections, created programmatically in the layout to ensure they always work correctly.
  - The layout for the overview tab is now generated with Dash HTML components to ensure the interface image displays reliably and scales correctly.
  - Added a main "ProtSpace Help Guide" title and removed redundant subheadings from content files for a cleaner UI. ([`6baef98`](https://github.com/tsenoner/protspace/commit/6baef98de7db3172ed50e91c32d48af167b85c4d))

### Testing

* test(app): stabilize and refactor UI test suite

This commit introduces a comprehensive set of UI tests for the main application and resolves several stability issues.

- **Initial Setup**: Created `tests/test_app.py` to validate core application functionality, including loading, feature selection, and UI interactions.

- **Stabilization**:
  - Resolved `DuplicateIdError` and race conditions by replacing `time.sleep()` with robust, explicit waits.
  - Fixed flaky tests by using reliable selectors and waiting for specific UI states before making assertions.
  - Suppressed the `kaleido` `DeprecationWarning` in the `pytest` configuration to clean up test output.

- **Refactoring**:
  - Introduced `pytest` fixtures (`protspace_app`, `protspace_app_with_data`) to eliminate redundant app setup code.
  - Created a reusable `wait_for_element_attribute_to_contain` helper function to reliably handle polling for asynchronous style changes during animations, making the tests cleaner and more maintainable.

The resulting test suite is now stable, robust, and provides solid coverage for key user interactions. ([`b928c01`](https://github.com/tsenoner/protspace/commit/b928c010cb6bdcf7965bd3a64a1312ee4a39695f))


## v1.3.0 (2025-06-13)

### Features

* feat(app): enhance plot controls and fix UI interactions

This commit introduces significant improvements to the user interface and adds new functionality for plot customization, while also resolving several bugs.

- **Marker Size Control:**
  - Adds a new input control allowing users to dynamically adjust the size of the scatter plot markers.
  - The plot now updates automatically when the marker size value is changed, providing immediate visual feedback.
  - The default marker size is now set to 10, and the previously hardcoded constant has been removed.

- **Plot Downloads:**
  - Fixes a critical bug that caused plot downloads to fail. The download callback now correctly handles different file formats by using `dcc.send_bytes` for PNGs and `dcc.send_string` for SVGs and HTML.

- **UI and Layout:**
  - The download format dropdown has been modified to open upwards, preventing it from being obscured by elements below it. This was achieved by removing an invalid property and using a custom CSS class.
  - The settings panel for marker styling now appears alongside the scatter plot instead of overlaying it. The scatter plot resizes to accommodate the panel, creating a more integrated and responsive layout.
  - The width of the settings panel has been adjusted to provide a better balance between the controls and the plot visualization.

- **Bug Fixes:**
  - Resolves a state management issue where applying a style to a feature would incorrectly reset the feature dropdown to its default value. The callback now preserves the user's selection.
  - Corrects an `AttributeError` that occurred due to a misordered function signature in a callback after a new input was added. ([`9853925`](https://github.com/tsenoner/protspace/commit/985392554a3b2824a235a0cd37b10dc7589fbb4c))

### Refactoring

* refactor(ClickThrough_GenerateEmbeddings): correct max_len handling ([`fdc3e3d`](https://github.com/tsenoner/protspace/commit/fdc3e3d7c4fee785ef882f43948190c991bf04bb))

* refactor(ClickThrough_GenerateEmbeddings): streamline code structure and enhance functionality

- Updated cell metadata and IDs for better organization.
- Improved installation instructions by adding missing dependencies.
- Enhanced model setup logic to support additional models, including ProstT5, native ESM3 (open variant), and native ESMC (300m and 600m variants).
- Refined embedding computation to handle different model types and added length checks.
- Updated output file naming convention to include model type for clarity.
- Improved error handling for invalid sequence headers.
- Added optional Hugging Face login cell for models requiring authentication. ([`7d3673b`](https://github.com/tsenoner/protspace/commit/7d3673b12ecd1f94fd08fbd3999632fe376a1e45))


## v1.2.0 (2025-04-15)

### Unknown

* Merge branch 'main' of https://github.com/tsenoner/protspace ([`4b1e33d`](https://github.com/tsenoner/protspace/commit/4b1e33d306f7fe839368a53f2683c18f1523f83a))


## v1.1.8 (2025-04-15)

### Chores

* chore: update notebooks to install protspace[frontend] ([`e5398b6`](https://github.com/tsenoner/protspace/commit/e5398b652971c026f09ed9458e168e481f7c19f5))

### Documentation

* docs: add image of the different 2D markers ([`a0da72a`](https://github.com/tsenoner/protspace/commit/a0da72ab426e21c0b1ba31c2e61660624fca5692))

* docs: add note that external mode only works on Google Chrome ([`eb9dd10`](https://github.com/tsenoner/protspace/commit/eb9dd10b6986ba506cef40684e18558e30cf045a))

* docs: add PfamExplorer notebook ([`67fc596`](https://github.com/tsenoner/protspace/commit/67fc5968b3461971cdaf8cd29c0e82f734fb3b36))

* docs: update the README to reflect the changes in frontend dependencies ([`244b7ec`](https://github.com/tsenoner/protspace/commit/244b7ecf26d496c76e076401342fd6195813ccd9))

### Features

* feat(localmap): add new LocalMAP redundancy reduction ([`38d4982`](https://github.com/tsenoner/protspace/commit/38d498206552249c724cd469a8eae1290fde2d57))

### Fixes

* fix(pca): switch to arpack solver for numerical stability

Resolves `RuntimeWarning`s during PCA on `float16` embeddings by using `svd_solver='arpack'`. Removed prior dtype casting attempts. ([`0bf5b21`](https://github.com/tsenoner/protspace/commit/0bf5b21d06ac9f97aa2fb463b5a2b41f03ebaca8))

### Refactoring

* refactor(prepare_json): Improve maintainability ([`13af68f`](https://github.com/tsenoner/protspace/commit/13af68fb7153e623e7d323f56b0a5e34a5d0bc8b))

* refactor(json-analysis): show all feature values on high verbosity ([`9b8b833`](https://github.com/tsenoner/protspace/commit/9b8b8333e4fc38967074c07da9e93cea893139ab))

### Unknown

* example(pfamExplorer): extend description ([`8887d54`](https://github.com/tsenoner/protspace/commit/8887d54e733fd24da6fa1f4b981a3849cecaf38b))

* example(pfamExplorer): add option to download generated JSON file ([`e5ba1cb`](https://github.com/tsenoner/protspace/commit/e5ba1cb4b3d0325fd2d806e84d74d513bfe34847))


## v1.1.7 (2025-03-28)

### Fixes

* fix: NaN coloring ([`b6821be`](https://github.com/tsenoner/protspace/commit/b6821becf311f745eaebedafde662e86612a28f3))


## v1.1.6 (2025-03-28)

### Documentation

* docs: clearify the file upload in the embedding jupyter notebook ([`744b5bf`](https://github.com/tsenoner/protspace/commit/744b5bfe9905a151416f92dd6c3907662c276c60))

### Fixes

* fix: NaN process + app.run update ([`5250e33`](https://github.com/tsenoner/protspace/commit/5250e336929995f5ab0c20f59669c6b15da983b9))

### Refactoring

* refactor: check types ([`921e40d`](https://github.com/tsenoner/protspace/commit/921e40d1ab9f562712976d00a12675a4265e886c))

### Unknown

* Merge branch 'main' of https://github.com/tsenoner/protspace ([`2168cf1`](https://github.com/tsenoner/protspace/commit/2168cf1799c6106b00fd9a5675dea8c20affde9f))

* Adding config file improvements (#5)

* Adding to_dict_by_method to DimensionReductionConfig

* Making parameter config matching case-insensitive

* Adding constraints to config fields

* Adding name to parameter dict

* Changing to_dict to parameters_by_method and returning List

* Adding separate key for parameter constraints

* Separating frontend dependencies to optional dependencies

* Adding frontend import error handling

* Changing param.lower() in parameter dict by method function

* Adding type hints to constraints

* Adding additional metadata constraints for parameters

* Adding experimental docstring extraction for method parameters

* Improving parameter description cleaning ([`0f9d0d1`](https://github.com/tsenoner/protspace/commit/0f9d0d16e0fdab31a90eb60497f4db50f2396981))


## v1.1.5 (2025-01-28)

### Documentation

* docs: Add citation, web-service URL, fix parameter typo ([`ebf308d`](https://github.com/tsenoner/protspace/commit/ebf308d950ed408d362bf58014b2e3ac094cd98d))

### Fixes

* fix: add metadata delimiter definition option and sanity checks when creating .h5 ([`b4591ed`](https://github.com/tsenoner/protspace/commit/b4591ed38d523936c7b3ef29abf976a9b50de1f0))


## v1.1.4 (2025-01-07)

### Documentation

* docs: add citation links to help menu ([`61dc188`](https://github.com/tsenoner/protspace/commit/61dc1887e6a63c914b8355ddfafed6edc0d40362))

### Fixes

* fix: update annotation image ([`27fed47`](https://github.com/tsenoner/protspace/commit/27fed4727fdd9926a0e7918e8762de8c48ff0e84))


## v1.1.3 (2025-01-05)

### Fixes

* fix: update the dependencies ([`f2b0009`](https://github.com/tsenoner/protspace/commit/f2b00090ff712ea4ab2ee3de4dda8f4bb15e244f))


## v1.1.2 (2025-01-05)

### Fixes

* fix: add JSON instruction layout ([`1531335`](https://github.com/tsenoner/protspace/commit/1531335417e0c2f7187e3dab2963037b6c18bcf0))


## v1.1.1 (2025-01-04)

### Code Style

* style: update help menu ([`cb4262e`](https://github.com/tsenoner/protspace/commit/cb4262e0aa2d07048d8feb386ace1bdbf49ed133))

### Fixes

* fix: update workflow image ([`bbaf9dd`](https://github.com/tsenoner/protspace/commit/bbaf9dd5ca337aea2981b17ddaf37a8059eb998b))


## v1.1.0 (2025-01-03)

### Chores

* chore: update example file ([`ec74ab7`](https://github.com/tsenoner/protspace/commit/ec74ab7090aaeb339b04c4cc53b84518f5ee36ce))

* chore: update example file ([`94ef539`](https://github.com/tsenoner/protspace/commit/94ef539cd7d40027d40bad1740ffed1e74e9262a))

### Features

* feat: add help button ([`3c2c4c4`](https://github.com/tsenoner/protspace/commit/3c2c4c47b7947d121ff0158f0d0dccf3733e0607))


## v1.0.4 (2025-01-02)

### Fixes

* fix: wrong import in prepare_json ([`82efdf4`](https://github.com/tsenoner/protspace/commit/82efdf449976c4d00ce4661a9f1f1a31a0ad77a5))

### Unknown

* refactore: add quality check to prepare_json.py ([`f87cdb6`](https://github.com/tsenoner/protspace/commit/f87cdb626b1a5dda7e49298585bc388f6e1939f8))


## v1.0.3 (2024-12-18)

### Documentation

* docs: Add full path to toxin 2D example ([`32b387e`](https://github.com/tsenoner/protspace/commit/32b387efa38a3dc00edb324520324c8595d4f3c6))

### Fixes

* fix: make embeddings without feature <NaN> ([`bf97138`](https://github.com/tsenoner/protspace/commit/bf97138a28acb79409cb177bc9b1a656119d3812))

### Unknown

* Update embedding generator ([`e0ca7fe`](https://github.com/tsenoner/protspace/commit/e0ca7fe714d4e7ed5a02399acef51ab01f7ee6f1))

* Add forgotte change ([`6446fba`](https://github.com/tsenoner/protspace/commit/6446fba99235abcbf52111f00e50056d272e3179))

* Add navigation guide to 'Explore_ProtSpace.ipynb' ([`1e14f4b`](https://github.com/tsenoner/protspace/commit/1e14f4b12a8d88cb1c3ee1bdb51bbc2a522bfd86))


## v1.0.2 (2024-12-03)

### Fixes

* fix: transparancy assignment ([`edbac07`](https://github.com/tsenoner/protspace/commit/edbac07b34021b901906e1bc77c4fb49f12030d2))

### Unknown

* Make Marker config dependent on visualization dimension ([`3e2566a`](https://github.com/tsenoner/protspace/commit/3e2566a82d6e9c0ec96efded8e74bdb55afb8626))


## v1.0.1 (2024-12-03)

### Fixes

* fix: only display possible 3D markers ([`79fe477`](https://github.com/tsenoner/protspace/commit/79fe477a4581939d17b610b533481e46d33bee2e))

### Unknown

* Add note about Safari browser limitations for google colab ([`fd141c5`](https://github.com/tsenoner/protspace/commit/fd141c520e77f3757869de0ec436fccd9e6b2c55))

* Merge branch 'main' of https://github.com/tsenoner/protspace ([`f029c37`](https://github.com/tsenoner/protspace/commit/f029c37a99af79a792ab4ca053ab4bd9f1ffd323))


## v1.0.0 (2024-11-30)

### Breaking

* fix: format README

BREAKING CHANGE: release ([`9a37e48`](https://github.com/tsenoner/protspace/commit/9a37e48295eef82198916f1980803a1315c926f3))

### Unknown

* BREAKING CHANGE: release again ([`3b3b2c6`](https://github.com/tsenoner/protspace/commit/3b3b2c6e6920d5d8ada8ca9db2fa5fb122cd961a))

* Braking Change: Release ([`366f4b7`](https://github.com/tsenoner/protspace/commit/366f4b75bef846be42d5dcb1c6e68ccfc570fd49))

* hide installation progress in exploration jupyter ([`f48f3f6`](https://github.com/tsenoner/protspace/commit/f48f3f612140e735ce41062f274eac6e4806dde0))

* update notebook: clean old cell ([`d7e6895`](https://github.com/tsenoner/protspace/commit/d7e6895b5c97baa23e40853a9ec3f68950b1d372))

* Merge branch 'main' of https://github.com/tsenoner/protspace ([`564ee64`](https://github.com/tsenoner/protspace/commit/564ee64cb2aecc6c8f6c5dd665d966e05cb9af80))


## v0.1.0 (2024-11-28)

### Chores

* chore: fix docker container version tagging ([`317570f`](https://github.com/tsenoner/protspace/commit/317570f67770c5fb5482d40a2b0f8667e2af3346))

* chore: improve uv caching ([`a62282b`](https://github.com/tsenoner/protspace/commit/a62282b55bc65cf20ef8f36a0b1138c5af7adac1))

* chore: update uv.lock file [skip ci] ([`e71a89c`](https://github.com/tsenoner/protspace/commit/e71a89c85f8f037de6841083780f8ddb9d745867))

* chore: fix build process ([`c62ac73`](https://github.com/tsenoner/protspace/commit/c62ac737c3018845dd58d8053ca49729c13cd65b))

### Continuous Integration

* ci: modularize build process ([`4da6438`](https://github.com/tsenoner/protspace/commit/4da643895d0de4ab295ae1fcaf2b077e4f389653))

### Features

* feat: update datasets ([`611c83f`](https://github.com/tsenoner/protspace/commit/611c83fe0a7277b6a00ec3bc218cbf4fa67cf448))

* feat: test update ([`95b620c`](https://github.com/tsenoner/protspace/commit/95b620cf0b3cf70325f83439a3109f78eb1921ca))

* feat(utils): add JSON analyzer for data inspection

Add a CLI utility that provides insights into ProtSpace JSON files
with configurable detail levels. The tool helps inspect:
- Number of proteins and available features
- Dimensionality reduction methods
- Feature distributions
- Visualization settings ([`202c5cc`](https://github.com/tsenoner/protspace/commit/202c5ccc353294b4c86bba877e78d2be832df67e))

* feat: add PaCMAP as a DR method ([`c7deb2d`](https://github.com/tsenoner/protspace/commit/c7deb2d5ea85209b8846ca57edd7ee26e9b9a467))

* feat: update uv caching strategy ([`ff03f33`](https://github.com/tsenoner/protspace/commit/ff03f33a7bf75c0591966332a5f3aaaa47d48ae5))

### Fixes

* fix: go back to square 1 ([`3d8e4e4`](https://github.com/tsenoner/protspace/commit/3d8e4e47d4d4dc40f60b73deca7aa85be6d0a97e))

* fix: adjust python version for numba ([`98955b4`](https://github.com/tsenoner/protspace/commit/98955b4694aba21b2ab9cea93de428f923955b25))

* fix: remove support for 3.10

Python 3.10 requires an only numy that is troublesome. ([`16c93f8`](https://github.com/tsenoner/protspace/commit/16c93f8119fbdfbc91bb30c7cecc24a1a23ca465))

* fix: remove dash-bio dependency ([`fbc4a8e`](https://github.com/tsenoner/protspace/commit/fbc4a8e36e69cdacea2c20a1e06bfb3da3e006f6))

* fix: remove explicit bio-dash dep ([`b6b59d9`](https://github.com/tsenoner/protspace/commit/b6b59d9f867d052cdf82826648520062581d4d4f))

* fix: populate __init__ file with scripts ([`621f66e`](https://github.com/tsenoner/protspace/commit/621f66eff4f53c3a814021cb4e9c61f470827dfc))

* fix: populate __init__ file with scripts ([`56cab43`](https://github.com/tsenoner/protspace/commit/56cab436b35f3df46cc10c04d3e1822283130c71))

* fix: jupyter notebook call ([`9d3ed21`](https://github.com/tsenoner/protspace/commit/9d3ed21c3154c0e51b6ef591bfb86ab3b0eef590))

* fix: allow for python version 3.10, 3.11, 3.12 ([`5531783`](https://github.com/tsenoner/protspace/commit/5531783af4ef73316f7988eb9d585f76139c031b))

* fix: psr toolname ([`20d13b9`](https://github.com/tsenoner/protspace/commit/20d13b91ac658f4cba323fa7921e0eabe8ba45fb))

* fix: github release ([`0104042`](https://github.com/tsenoner/protspace/commit/0104042b9fb0bcaa564fb9bd88b4bc6aebe3492e))

* fix: fix detached history problem ([`4e4198f`](https://github.com/tsenoner/protspace/commit/4e4198ff2c8b4339cc778f60cbdfe9f220d9fba7))

* fix: update config option in pyproject.toml ([`f9ed456`](https://github.com/tsenoner/protspace/commit/f9ed4561ea096426e1ea8c5c5623a22fc55d78b7))

* fix: check for release ([`2a9bb7b`](https://github.com/tsenoner/protspace/commit/2a9bb7b516687c5f53f836e24f0985e01ea9ee00))

* fix: add uv lock git username ([`66023b5`](https://github.com/tsenoner/protspace/commit/66023b562bec3384b733de88b79b4f6fd44414ff))

* fix: add manual uv.lock update ([`5698bab`](https://github.com/tsenoner/protspace/commit/5698bab49f43645311434f04f62c59d5a41a9563))

* fix: version command ([`b9aef74`](https://github.com/tsenoner/protspace/commit/b9aef74d6b30f4f419a5069324d7e4d74bbab345))

* fix: correct semantic-release command ([`eeb12cc`](https://github.com/tsenoner/protspace/commit/eeb12ccb87f58781a08fa77c3c6b076fd10f3db0))

* fix: remove git setup ([`1b242a3`](https://github.com/tsenoner/protspace/commit/1b242a38f39a21aa6523421cf1f8477917a02e50))

* fix: improve uv build process ([`30732d2`](https://github.com/tsenoner/protspace/commit/30732d2e4846577c4ce4e98eab5dc1157f504652))

* fix: change repository version ([`f807fd2`](https://github.com/tsenoner/protspace/commit/f807fd205eb27d19f6133a38772ee9803481076c))

* fix: add token permissions ([`1651fde`](https://github.com/tsenoner/protspace/commit/1651fde38c80eac4edcb04849283a117dc5712a2))

* fix: add version ([`c5268b9`](https://github.com/tsenoner/protspace/commit/c5268b944fd43109fdcbf3826ec17ad4e26e5afb))

* fix: correct version ([`0dd9107`](https://github.com/tsenoner/protspace/commit/0dd91070c891d353a683a34f870f126751e44ea3))

### Performance Improvements

* perf: add dev dependencies ([`f581f5d`](https://github.com/tsenoner/protspace/commit/f581f5d1862550a7c19b75caeaf4d81d34d1d6c4))

### Refactoring

* refactor: move pacmap dependence out of dev ([`18644df`](https://github.com/tsenoner/protspace/commit/18644dfdacb273d14e77bda96b8f03fd11463319))

### Testing

* test: add figures yaml files ([`0bf5147`](https://github.com/tsenoner/protspace/commit/0bf51470559dc0d2fa84a0f326856f0cd475932b))

* test: add tests for the prepare_json script ([`b9a254b`](https://github.com/tsenoner/protspace/commit/b9a254b30d64a4802e0b7d9f8352ad8292e4fc0c))

### Unknown

* update readme links to lowercase protspace ([`68f1619`](https://github.com/tsenoner/protspace/commit/68f1619f7fb92bc24fa97b97021108131090a3a1))

* Update .gitignore ([`0cdf190`](https://github.com/tsenoner/protspace/commit/0cdf190a15ee3edfd12178906d8b1c6f7838bdc5))

* Add example outputs ([`f104c30`](https://github.com/tsenoner/protspace/commit/f104c30aa1eec15836edaa83eaf4c92d9487d2e4))

* Add data ([`7c0442e`](https://github.com/tsenoner/protspace/commit/7c0442e5cd7b625448f0b7759127bbffe678fac9))

* Clear notebook output ([`abdf979`](https://github.com/tsenoner/protspace/commit/abdf979d88d760f8755c21a0c7699d1eee927b7d))

* Update Pla2g2 data: rename + fic inequality ([`61e1744`](https://github.com/tsenoner/protspace/commit/61e174465b07865780dc70552acefdfa1765d672))

* Update Notebooks to be better for walkthrough ([`8e45fa6`](https://github.com/tsenoner/protspace/commit/8e45fa6b3fa2f01d156b2926ad9ebb9947dfb3da))

* Update README: pip install + explore ProtSpace notebook ([`c19b7b3`](https://github.com/tsenoner/protspace/commit/c19b7b3bb16f39a23fc9c24bcfdb455cfc7c82fd))

* Merge branch 'main' of https://github.com/tsenoner/ProtSpace ([`2a980ea`](https://github.com/tsenoner/protspace/commit/2a980ea20eccf5c5152791f3d83216e7c3acddfa))

* add option to force SVG creation, also with many dots ([`16ff253`](https://github.com/tsenoner/protspace/commit/16ff253c23bc795a0823f44497bec46271f8fa38))

* update noteboks to be more user friendly ([`bf2999b`](https://github.com/tsenoner/protspace/commit/bf2999b458efc141e2a5a6058131da8493a572ae))

* update README.md ([`55f3caa`](https://github.com/tsenoner/protspace/commit/55f3caa94339546ddd90ba5e2e4cd386e69d551f))

* remove github action pythonversion test ([`59a3052`](https://github.com/tsenoner/protspace/commit/59a3052b3117bc3fc07bf8f65656ae0008d054ac))

* make images creation easier with a YAML config file ([`94d7ba9`](https://github.com/tsenoner/protspace/commit/94d7ba96cc4f422da6fec8d2bc61df416a81df42))

* update example and code to generate imgs from cli ([`cedbbf3`](https://github.com/tsenoner/protspace/commit/cedbbf3ad90e588b991635f3143123e5740d4bb2))

* add notebook to create embeddings ([`adde18a`](https://github.com/tsenoner/protspace/commit/adde18a4db78955ee4f8bffef2b4b10dde285b09))

* remove foldseek and mmseqs GFP data ([`b09dc4e`](https://github.com/tsenoner/protspace/commit/b09dc4e39d3f3d95fbbfe3810c32c58400c36841))

* add GFP data and output examples ([`0a32fb8`](https://github.com/tsenoner/protspace/commit/0a32fb8fc87aafea9e625a9a1c7d41d353eee40c))

* add costum naming in prepare_json.py ([`9ec409c`](https://github.com/tsenoner/protspace/commit/9ec409c8f9357bf56bff6566da1689266d8f8437))

* reduce dot size on 3D plots ([`984e303`](https://github.com/tsenoner/protspace/commit/984e303a86b93bdf3ea52bdc6794bf7e73625807))

* add natural key sorting to legend ([`d73a1c7`](https://github.com/tsenoner/protspace/commit/d73a1c7ac18edcb213595c90af1000a56d1510b7))

* Merge branch 'main' of https://github.com/tsenoner/ProtSpace ([`6981db7`](https://github.com/tsenoner/protspace/commit/6981db7a1e33f38e9bc0fe1aa354bc8c0c71d472))

* Merge branch 'main' of https://github.com/tsenoner/ProtSpace ([`e08528d`](https://github.com/tsenoner/protspace/commit/e08528d372932474219742f2a818139032daaf45))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`498ed53`](https://github.com/tsenoner/protspace/commit/498ed530757e3b63ca4d4c3f45bf0e7125d870e6))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`ec31aa0`](https://github.com/tsenoner/protspace/commit/ec31aa0880bbbdcceed977b8a5b5eeac1028b670))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`f6df935`](https://github.com/tsenoner/protspace/commit/f6df935971f026871fd772fd5029b474267c4616))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`514d4f4`](https://github.com/tsenoner/protspace/commit/514d4f46874bae77bb6f10d5f5da8de18f51c26e))

* Add uv.lock as build asset to be commited ([`1a0458d`](https://github.com/tsenoner/protspace/commit/1a0458d3f72e9702c73fc742656f130f95bf1b91))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`acaa577`](https://github.com/tsenoner/protspace/commit/acaa5777af858ea0273480f0b63efd6a8912027e))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`a2d6953`](https://github.com/tsenoner/protspace/commit/a2d695368083972b558f107f835334f2273b783b))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`c86a640`](https://github.com/tsenoner/protspace/commit/c86a640535334dc63258fb654f4b68750be554b9))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`99a2fbc`](https://github.com/tsenoner/protspace/commit/99a2fbc027edfce29647aa2b5fbbf53c79908963))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`7c2b732`](https://github.com/tsenoner/protspace/commit/7c2b7327f231d05b1505d0058b2d98b44f3ed125))

* fix invalid yaml

fix: build process ([`e624319`](https://github.com/tsenoner/protspace/commit/e62431908fca74120c07d033c2297122c3068ee1))

* fix pypi push action

fix: build process ([`aa89653`](https://github.com/tsenoner/protspace/commit/aa89653dddcadbb391bd1c42081351a50a9a83fe))

* add python semantic release

chore: Add python build and push ([`86ba04d`](https://github.com/tsenoner/protspace/commit/86ba04d53d01640a9cb4233190967b78348a92da))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`c560ddf`](https://github.com/tsenoner/protspace/commit/c560ddfdb1c8b65acad13de8eebac2afe79dbdb7))

* ignore SyntaxWarning of biopython ([`36c56a1`](https://github.com/tsenoner/protspace/commit/36c56a190610bc3f60d335e741b439491a71d3e0))

* Only build on tags ([`07dc4ac`](https://github.com/tsenoner/protspace/commit/07dc4acdf3d845dba89d501db6e2c06fa5b0bd66))

* Docker build only on src changes ([`1002211`](https://github.com/tsenoner/protspace/commit/100221166ea91063c08fb6f07f120eb25e752dcd))

* Create jekyll-gh-pages.yml ([`0c96791`](https://github.com/tsenoner/protspace/commit/0c96791079da703d9304e8e72a88d3980563db54))

* Version bump ([`78dafba`](https://github.com/tsenoner/protspace/commit/78dafba8c25efc4f5d2e2379c830802a0d7123ea))

* Update README.md ([`f6deb41`](https://github.com/tsenoner/protspace/commit/f6deb4127b04ac03a50cc056b60999691b8cf188))

* Updated README.md ([`67f1853`](https://github.com/tsenoner/protspace/commit/67f185307d898c616878379dac9c67def019f162))

* Version Bump ([`8e8629e`](https://github.com/tsenoner/protspace/commit/8e8629e6d3447dd240b55ef848c888ebf566c82c))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`77066bb`](https://github.com/tsenoner/protspace/commit/77066bb6d9941f607e18dbe5199f68b156492f76))

* Remove unneccary __init__.py lines ([`d7bbb1b`](https://github.com/tsenoner/protspace/commit/d7bbb1b02c6f0eb48fd02df5270f5d8a9208714d))

* Updated dependencies ([`ba4c297`](https://github.com/tsenoner/protspace/commit/ba4c297a2a1816d2895494decf26ab41f1ff6c13))

* Add commandline parsing ([`fe39d9b`](https://github.com/tsenoner/protspace/commit/fe39d9b887c97b4132d6fdc83d2ec2a8b52aec90))

* Add render deploy hook ([`17ee985`](https://github.com/tsenoner/protspace/commit/17ee9859494cc5fc1d9eec2102f4a4ba9d010424))

* Merge pull request #4 from tsenoner/f-transition-uv

Add data to docker image ([`0f8c2b2`](https://github.com/tsenoner/protspace/commit/0f8c2b2e171a18f1e17e752736ffb3a70491b48f))

* Add data to docker image ([`9ccc392`](https://github.com/tsenoner/protspace/commit/9ccc39263ae585968ea4712c0936bc489c112e82))

* Merge pull request #3 from tsenoner/f-transition-uv

F transition uv ([`c694b07`](https://github.com/tsenoner/protspace/commit/c694b07855b28a9c0475c474fd08b78570ff23f4))

* Fix license ([`3cd0d81`](https://github.com/tsenoner/protspace/commit/3cd0d811a281ab62e970d09f1a26701d2aa60212))

* Add Github Action to build image ([`7581401`](https://github.com/tsenoner/protspace/commit/7581401cdfaee8f9357a60372d8df64c31c806f4))

* Add relevant labels ([`f252b1f`](https://github.com/tsenoner/protspace/commit/f252b1f0a856f61a0f79517cbe262ba2fc25a2a7))

* fix docker deployment ([`54b7731`](https://github.com/tsenoner/protspace/commit/54b77314242862685fd33c2227cde0f9746821a9))

* Fix import in main from util to config ([`cab1598`](https://github.com/tsenoner/protspace/commit/cab1598266687bdb4be1974b1923ee71caf1b92a))

* Update examples ([`4ae35f2`](https://github.com/tsenoner/protspace/commit/4ae35f20e0c66a14160c177c00eaacd17802c5a9))

* Merge branch 'main' into f-transition-uv ([`41d0521`](https://github.com/tsenoner/protspace/commit/41d0521d606c8d586543982e50d7c5cf1e88d20d))

* Correct deployment path name ([`73f8027`](https://github.com/tsenoner/protspace/commit/73f8027194b2edaa2053e6b252519e2be1ec0293))

* Update Example images ([`e4c02c9`](https://github.com/tsenoner/protspace/commit/e4c02c94ad644045b5388430030cc2364e6b410c))

* Update Pla2g2 example data ([`0cbf866`](https://github.com/tsenoner/protspace/commit/0cbf86646492a4c311e6e375f1cb9a0547b7ef38))

* Change example data to Pla2g2 ([`19fe7ed`](https://github.com/tsenoner/protspace/commit/19fe7ed3f4ab5e374f887affcb40890dc33362b8))

* Add command ([`af87578`](https://github.com/tsenoner/protspace/commit/af875782d5cd776debd3cf7bbf86df8088ad40e0))

* Add dotenv ([`17979ad`](https://github.com/tsenoner/protspace/commit/17979ad9f7edfb6d8ffb5b22bdeeb39bb5c63e79))

* Fix src layout ([`e0aa9cf`](https://github.com/tsenoner/protspace/commit/e0aa9cfc0898913c3c854fa0676790fcc67afe9b))

* Update render config ([`6688f44`](https://github.com/tsenoner/protspace/commit/6688f44b4a93534bc117fd9046c3f038bf68b529))

* Add dockerfile ([`f1e7c2c`](https://github.com/tsenoner/protspace/commit/f1e7c2ce65d5e40e79b2c33fed7e1c3860bd9627))

* Switch to Env variables for more dynamic config ([`508f732`](https://github.com/tsenoner/protspace/commit/508f732f53b897148c324f70558732ea3fdfb5c3))

* Change uttils to config ([`df1fa40`](https://github.com/tsenoner/protspace/commit/df1fa40fa62f74f1550c65decda8a8b5b0af1dcd))

* Transition to uv ([`d8d8f02`](https://github.com/tsenoner/protspace/commit/d8d8f02b789f02e7672eca21ccb570849e9faffa))

* Move for easier packaging ([`2344b7e`](https://github.com/tsenoner/protspace/commit/2344b7e36f2ca6fb2103dbe2c9452002c66d606b))

* Rename to scripts ([`9c691db`](https://github.com/tsenoner/protspace/commit/9c691db4249f0af369d52799500b8cbc848f5879))

* Update LA image + add ProtSpace workflow ([`e9033e3`](https://github.com/tsenoner/protspace/commit/e9033e3ed65884e8d059554cf3cff8cda3dcaaf2))

* Remove old example file in base ([`c1a201d`](https://github.com/tsenoner/protspace/commit/c1a201d0e1658aad8b2b433f6603a1e5f3bffbab))

* Update merge script for manuscript ([`c2fb97a`](https://github.com/tsenoner/protspace/commit/c2fb97ae3faefc22129850a44fc6c6e37b6ebb2e))

* Add examples for pla2g2 and homo sapiens ([`8e7f5c8`](https://github.com/tsenoner/protspace/commit/8e7f5c8a392eb2f3faf6b09329808592e77f8a82))

* Add homo sapiens data ([`a98f417`](https://github.com/tsenoner/protspace/commit/a98f417a96853fe08993778f1bd9be67016efef0))

* Remove pdb directories from Git tracking ([`9e9374d`](https://github.com/tsenoner/protspace/commit/9e9374d72dd2afaf62f368503da3faabf8a69fdb))

* remove PDB by default in wsgi.py for gunicorn ([`333a1a8`](https://github.com/tsenoner/protspace/commit/333a1a814c2a9fa1ecd68cb45878f56e4667aac4))

* Fix broaken marker style update ([`d628b93`](https://github.com/tsenoner/protspace/commit/d628b9351f85f7ea7b5ac3dfc7209fe72f5cf571))

* Implement PDB viewer and zip upload ([`39f49ea`](https://github.com/tsenoner/protspace/commit/39f49ead785d0a0d7e85ef95813a430e41bd5963))

* Fix multiple worker run with gunicorn using dcc.Store ([`0e14933`](https://github.com/tsenoner/protspace/commit/0e149334d7f3dba8b1aea37d1852c2165f99dd4a))

* let render only install the needed dependencies ([`fbe9dfa`](https://github.com/tsenoner/protspace/commit/fbe9dfad182acc697d78e69b76a3edf1948cd067))

* move wsgi to protspace ([`4bbf489`](https://github.com/tsenoner/protspace/commit/4bbf4897d71277b53e235448eff771989823f27b))

* add __init__.py to script ([`76ba0c6`](https://github.com/tsenoner/protspace/commit/76ba0c6fd5b1bd72d695021f44c1c407f9145d89))

* Move render.yaml to base ([`e31858c`](https://github.com/tsenoner/protspace/commit/e31858c9ffcc5b2c0acf7e9043c7251ffc029504))

* Set everything up for render ([`4ab9404`](https://github.com/tsenoner/protspace/commit/4ab9404155fe90c2da6f54b99632ec85c97db952))

* add build.sh for render web service ([`ed5c057`](https://github.com/tsenoner/protspace/commit/ed5c057b6fe7c0f47d418e8e5e7940842e6201a6))

* Add Pla2g2 dataset ([`7c20fb8`](https://github.com/tsenoner/protspace/commit/7c20fb87afeaef4cc3754fe037e3fd216a400a3c))

* Extend script to add colors and shapes ([`c52650f`](https://github.com/tsenoner/protspace/commit/c52650f0656ab0bfecde1773d0eb45cd897793b1))

* Allow to append embedding spaces to existing JSON ([`18f73c0`](https://github.com/tsenoner/protspace/commit/18f73c0380eef81b283c1cebccd783ded5dd34a5))

* Rename config to utils ([`3d90fa2`](https://github.com/tsenoner/protspace/commit/3d90fa2e2ee33a8128b71ef7dfab56e552b18b43))

* Update examples ([`0efd90b`](https://github.com/tsenoner/protspace/commit/0efd90b522c246564e743d40b7a5a3e1ae210674))

* Update examples ([`be60366`](https://github.com/tsenoner/protspace/commit/be60366f7f1782fc94991e5708ace7d6c6157a5e))

* Add settings, download, and upload JSON button ([`d369a06`](https://github.com/tsenoner/protspace/commit/d369a06afd2ab841cb2afaaed8976249bbeafc6a))

* Update ProtSpace according to new JsonReader ([`87fb810`](https://github.com/tsenoner/protspace/commit/87fb810f7fde2e507e8913e356f94116e062c03b))

* JsonReader updates marker color and shape ([`13d6821`](https://github.com/tsenoner/protspace/commit/13d6821faa0e002a5ba2b92cd6f7875ee544bae0))

* Move color and marker shape update to callbacks ([`e61df93`](https://github.com/tsenoner/protspace/commit/e61df937e4bcbfd69aec628c42312f314101b5a1))

* Legend in saved image is proportional to height ([`8dc859f`](https://github.com/tsenoner/protspace/commit/8dc859f21350188af2ad3ce1c8623600e6f8c572))

* Add script to generate h_sapiens manuscript img ([`7b6e992`](https://github.com/tsenoner/protspace/commit/7b6e99224e18a46ad6a74810051a607680c18617))

* Update examples ([`42b23e2`](https://github.com/tsenoner/protspace/commit/42b23e27c611e0abcf61912b70434c3323f286ef))

* Handle <NAN> colors properly ([`6340833`](https://github.com/tsenoner/protspace/commit/6340833b182ac353d9fe91113df22fe4ac94b1b3))

* update the LA embedding creating script ([`645ece3`](https://github.com/tsenoner/protspace/commit/645ece32bf1b167fa5dd3e7d77db0f96fa4e680e))

* add script to download folcomp compressed structures ([`368cb3e`](https://github.com/tsenoner/protspace/commit/368cb3e2a1f8a837673db3780b38ff4eb3989bb3))

* add script to create LA embeddings ([`e5775f1`](https://github.com/tsenoner/protspace/commit/e5775f197292aa1710a7533e567a7a7663106aea))

* add examples for both hex and rbga colors ([`44a5f45`](https://github.com/tsenoner/protspace/commit/44a5f45e4f590516b02c91f6f3f0dec9b92d8420))

* Allow for costumized colors ([`eb6df74`](https://github.com/tsenoner/protspace/commit/eb6df744cb533fce03e279b1f57d15938bd6a229))

* Make the info key in the projections optional ([`17e07e2`](https://github.com/tsenoner/protspace/commit/17e07e2284c65dc1b24bb4b5192cdac66bdebc1f))

* Remove old notebook directory ([`b4d18ad`](https://github.com/tsenoner/protspace/commit/b4d18adca8d6cabe9e4a149186f15ed53667d7a4))

* Add notebook to explore ProtSpace w/o installation ([`180d902`](https://github.com/tsenoner/protspace/commit/180d902f502e56c9862d41595f202026043dbe65))

* Have no output when running the app interactivelly

E.g. when running in a jupyter notebook or Google colab ([`9d3426f`](https://github.com/tsenoner/protspace/commit/9d3426f1292005a53e23dcfddcfd4cfbf45c1902))

* Add some usecase examples ([`82ff759`](https://github.com/tsenoner/protspace/commit/82ff7597f0443ede4b159c46ebd98744144f47b3))

* Restructure app for better mantainability ([`c852272`](https://github.com/tsenoner/protspace/commit/c852272181cfb5cd802d3e2dc3a6de975c18e31f))

* add independent image generation ([`1d09860`](https://github.com/tsenoner/protspace/commit/1d0986017104c092b26f5c4b54ef940741b177b4))

* Update 3FTx.html file ([`1bdd44e`](https://github.com/tsenoner/protspace/commit/1bdd44ea4573916de7ad5df4aeba07bd51dda3d0))

* Correct path to 3FTx.html in README.md ([`7b3913a`](https://github.com/tsenoner/protspace/commit/7b3913ac1c7aeaf0622cbe0e6ae39362dfe97045))

* Correct path to 3FTx.html in README.md ([`fe950c4`](https://github.com/tsenoner/protspace/commit/fe950c40eb8dcae05bd045c98fafa961ae8162dc))

* Add example output to the README.md ([`beab0b7`](https://github.com/tsenoner/protspace/commit/beab0b7b0f221e1b4998fbeeb31fdfd6233cfa22))

* Update README.md ([`73cf792`](https://github.com/tsenoner/protspace/commit/73cf792334cf0ab42669a01a89f7576305a3e629))

* Add structure protein display next to scatter plot ([`e725145`](https://github.com/tsenoner/protspace/commit/e725145e7874caaf7d04efbb2637f42afb78e379))

* Update Layout, add download and search functionality ([`9e603f3`](https://github.com/tsenoner/protspace/commit/9e603f34a27be868061b3deaf3256c84f843ba3f))

* Restructure app and only keep what is necessary ([`e8cc4f3`](https://github.com/tsenoner/protspace/commit/e8cc4f3ad512de3127c099411aa4b238c71eb8a5))

* Add basic version of the main app to visualize protein embeddings ([`1ee43db`](https://github.com/tsenoner/protspace/commit/1ee43db0877054315015b8d5d50f85b801462b23))

* Add script to load JSON file for the app to handle ([`b980147`](https://github.com/tsenoner/protspace/commit/b980147eb7eea091ef49d81004ac710d1fec39bb))

* Prepare data to a JSON format to be visulaized ([`d14d71d`](https://github.com/tsenoner/protspace/commit/d14d71d2b3fb84a0273336e92977731cdb46572c))

* Create LICENSE ([`6ca4601`](https://github.com/tsenoner/protspace/commit/6ca460166d1b3c8c8a3ebf6462dba064030bb4d3))

* Directory structure ([`15dd9e4`](https://github.com/tsenoner/protspace/commit/15dd9e43f521683710e0bb8f716fac8d4766409b))

* Remove .DS_Store and add it to .gitignore ([`0def325`](https://github.com/tsenoner/protspace/commit/0def3259b892eaed3b157a8ed0244939a3527da1))

* Remove .DS_Store and add it to .gitignore ([`be45406`](https://github.com/tsenoner/protspace/commit/be454061eafab56150087dcf1459ce149f13fd81))

* Initial commit ([`51e0d75`](https://github.com/tsenoner/protspace/commit/51e0d7533b5b976a4d08fef219a35ce1ce9ae078))
