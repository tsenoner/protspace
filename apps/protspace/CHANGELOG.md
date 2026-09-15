# CHANGELOG


## v4.12.0 (2026-08-19)


## v4.11.3 (2026-08-19)

### Documentation

- Untrack apps/protspace/docs/superpowers and drop its dangling refs
  ([`69a5376`](https://github.com/tsenoner/protspace/commit/69a5376255cf1d1fdff6102a19e70792b5ac1efc))


## v4.11.2 (2026-08-13)

### Bug Fixes

- **notebook**: Gate esm2_3b in the panel, not just at Generate
  ([`1f1820a`](https://github.com/tsenoner/protspace/commit/1f1820ac7cc1821946f6c7db7c2249c6f8d57dbe))

- **notebook**: Gate esm2_3b on runtime capacity, and disclose the auto fallback
  ([`94dd558`](https://github.com/tsenoner/protspace/commit/94dd558c1af3df323cbcb5ec615aa0ae46d273ca))

- **notebook**: Keep esm2_3b off the Colab local backend
  ([`a5b32f1`](https://github.com/tsenoner/protspace/commit/a5b32f179f6c2a88be92f353d8f927fe1fa69823))

- **notebook**: Survive a released-package lag, and stop advising a dead service
  ([`3e73e43`](https://github.com/tsenoner/protspace/commit/3e73e439b0feb5c914ed3866d5cf11fa72194993))

### Build System

- **deps**: Raise the pymmseqs floor to 1.2.0 for wheels
  ([`fe81f6d`](https://github.com/tsenoner/protspace/commit/fe81f6dbf98f875ef052871f41887d753c2e4958))

### Documentation

- Drop the stale compile-from-source contrast from the similarity note
  ([`4f5b89a`](https://github.com/tsenoner/protspace/commit/4f5b89a1a91959e7252f9dd29bce11bde58f7cd4))

- Qualify the pymmseqs wheel claim, which is false on Windows
  ([`41f8602`](https://github.com/tsenoner/protspace/commit/41f8602493c7e2110698eb89d3f3618499a04b3f))

### Refactoring

- **notebook**: Collapse the backend-gating duplication, and pin the fallback
  ([`3cdacf9`](https://github.com/tsenoner/protspace/commit/3cdacf9eaa7e76767b657eae61db2b398f4ad447))


## v4.11.1 (2026-08-12)

### Bug Fixes

- **cli**: Check both -s preconditions before prepare reads any input
  ([`fb8ce15`](https://github.com/tsenoner/protspace/commit/fb8ce158e7069610a1cd2b8d680602ee2cba6d31))

- **cli**: Surface the optional extras in --help and fail fast without them
  ([`9db464c`](https://github.com/tsenoner/protspace/commit/9db464c647c9e69b1378cc6abd6fc7d27de99be9))

- **deps**: Move pymmseqs to an extra, relax rich/protobuf floors
  ([`30b4353`](https://github.com/tsenoner/protspace/commit/30b4353764228b0b161d81ee79b57dc84a7ddfa2))

- **embed**: Gate completeness on the .h5, not a running total
  ([`dde4f4d`](https://github.com/tsenoner/protspace/commit/dde4f4d2e382d9cab863b434d7e64f5542f86bf9))

- **embed**: Give both backends one completeness contract
  ([`52d8b28`](https://github.com/tsenoner/protspace/commit/52d8b288375e345af9579517c936fc8762932ba5))

- **embed**: Keep embedding the remaining models after one fails
  ([`9a6b0aa`](https://github.com/tsenoner/protspace/commit/9a6b0aaf2ed96e96606da8a6c87942b2912cf5fe))

- **embed**: Raise on incomplete embeddings and stop the bar lying
  ([`70fa748`](https://github.com/tsenoner/protspace/commit/70fa74861e1f122327ee5e15a658d292644baed3))

- **embed**: Surface embedding failures instead of exiting 0
  ([`3f95316`](https://github.com/tsenoner/protspace/commit/3f95316c0c3617a1f9d0f3ad8471cdba2d249f60))

- **notebook**: Actually silence the Colab install output
  ([`c68e549`](https://github.com/tsenoner/protspace/commit/c68e5490cfe93d18c6708fd3c3854d23441c38d0))

- **notebook**: Collapse the panel, drop the stray section chevron
  ([`5068435`](https://github.com/tsenoner/protspace/commit/5068435c3acfe77008af8ccd1a70b834113334f8))

- **notebook**: Correct four defects the review pass found
  ([`27727c6`](https://github.com/tsenoner/protspace/commit/27727c6d2dd922654b4342cc3700e5b4044e45a9))

- **notebook**: Give the Transfer notebook its data step
  ([`b1f40a4`](https://github.com/tsenoner/protspace/commit/b1f40a4acebdb3a910c72a70183aed31cf67177c))

- **notebook**: Name ankh3_* in the non-commercial licence note
  ([`9e46a3a`](https://github.com/tsenoner/protspace/commit/9e46a3acce285138801fd2e2b224733d0248667e))

- **notebook**: Name the session restart when a post-install import fails
  ([`d018cb8`](https://github.com/tsenoner/protspace/commit/d018cb81baecb8e217ed1ef5d84ef964207b67c6))

- **notebook**: Retry interrupted example downloads instead of caching a stub
  ([`32b4241`](https://github.com/tsenoner/protspace/commit/32b4241592dcd7abd7477f7071ee455a26392197))

- **notebook**: Retry interrupted example fetches instead of caching a stub
  ([`de497b6`](https://github.com/tsenoner/protspace/commit/de497b648c5805af4af838abaa1306792b26c406))

- **notebook**: Show the MDS note whenever MDS is selected
  ([`36e8e16`](https://github.com/tsenoner/protspace/commit/36e8e163aa9de3e727236d762af8a9784c10fcf8))

- **notebook**: Stop re-printing pip's stderr after a successful install
  ([`8b2a299`](https://github.com/tsenoner/protspace/commit/8b2a299bc4f8cbcaca29757c82c21300a1ba1c89))

- **prepare**: Check embeddings against the supplied FASTA before similarity
  ([`a6f54a5`](https://github.com/tsenoner/protspace/commit/a6f54a5a529f4efe09a520d1a72bc55849f0edf0))

- **prepare**: Make -f reach every HDF5 input and reject a path that is not there
  ([`0591944`](https://github.com/tsenoner/protspace/commit/0591944008d7a79786a36ccab125f8970a004d57))

### Build System

- **deps**: Give protobuf a floor instead of leaving it unconstrained
  ([`c2dd455`](https://github.com/tsenoner/protspace/commit/c2dd4552e48d7739e7a9053c65c5203417e75c50))

### Chores

- **deps**: Drop unused dash-treeview-antd from the dev group
  ([`d080794`](https://github.com/tsenoner/protspace/commit/d08079481527ca4a2b0dcbdf75b52dd46d3c1c7c))

### Code Style

- **cli**: Drop the f-prefix from two placeholder-free help fragments
  ([`5147086`](https://github.com/tsenoner/protspace/commit/51470861dfeb35395fe8faa46e044a3a9cf19795))

### Documentation

- Consolidate documentation post-monorepo-merge
  ([#329](https://github.com/tsenoner/protspace/pull/329),
  [`f803ed8`](https://github.com/tsenoner/protspace/commit/f803ed8c1843c5ff1b4ef0a47a97ac4544297230))

- Document the extras and the similarity upgrade note
  ([`79ee18a`](https://github.com/tsenoner/protspace/commit/79ee18ad2c9c215f33f429552b100ec461807c14))

- Drop the version number from the similarity upgrade note
  ([`deb0e6f`](https://github.com/tsenoner/protspace/commit/deb0e6f2db46993729014f7c1335a4dda76f6933))

- ESM-C is MIT now, correct the non-commercial claims
  ([`0ada084`](https://github.com/tsenoner/protspace/commit/0ada084c9b92135889415101fbce671ab00e5f74))

- Fix issue refs broken by the monorepo rename
  ([`f22cbb8`](https://github.com/tsenoner/protspace/commit/f22cbb8e2797a9d21819f9ec6482623fd2c0d2b6))

- Note ESM-C relicence in the archived toxprot design doc
  ([`e013834`](https://github.com/tsenoner/protspace/commit/e013834269f36f77bf29faa95b45c524a015b0d8))

- Qualify the pre-rename issue refs the first pass missed
  ([`6010624`](https://github.com/tsenoner/protspace/commit/601062461453f0b1adf2705ff6f44e07965d44e6))

- Replace the em-dashes this branch added with commas and colons
  ([`1270220`](https://github.com/tsenoner/protspace/commit/12702200a1ead442535aa93b2359337019927b6f))

- Repoint stale doc links after the consolidation
  ([`12fa854`](https://github.com/tsenoner/protspace/commit/12fa8540f986b877c0cdb3d103cf89558b4c3a2f))

- **agents**: Record the squash enforcement and the docs/notebook check
  ([`279614a`](https://github.com/tsenoner/protspace/commit/279614a73f5ef81d3098be436d7536bcae135209))

- **cli**: Correct the ESM-C licensing note
  ([`dafe720`](https://github.com/tsenoner/protspace/commit/dafe7208f42c2ed9bcefc169810a2f5650bc7722))

- **embed**: Document the completeness contract and --max-length
  ([`eae28f6`](https://github.com/tsenoner/protspace/commit/eae28f6f1b66198e5f0a73d04d87c4aee86222fa))

- **notebook**: Capture the install in all three Colab notebooks
  ([`7361f5f`](https://github.com/tsenoner/protspace/commit/7361f5f38668bf387a3fbc90c8110f60f23e2bdd))

- **notebook**: Merge the two widget cells into one control panel
  ([`f687013`](https://github.com/tsenoner/protspace/commit/f68701320a64ac700634165a706129e32ecdd4ff))

- **notebook**: Move the CLI wrap-up below the EAT step
  ([`d542ab1`](https://github.com/tsenoner/protspace/commit/d542ab1bc9e56c60947ddfc57d4ea751d2591d5e))

- **notebook**: Unbreak Embeddings Colab setup cell
  ([`1244fad`](https://github.com/tsenoner/protspace/commit/1244fad50f7b36b1d4d0ceaaf5b5a551c27a124e))

- **notebook**: Unbreak setup cell, disambiguate download direction
  ([`a2c178b`](https://github.com/tsenoner/protspace/commit/a2c178b32597a2ba9736da6598004b347829d87a))

- **protspace**: Correct the ESM-C licensing note in the agent doc
  ([`440ecc7`](https://github.com/tsenoner/protspace/commit/440ecc7e4e5d1516bdd18c13762d7f4dc01c7f05))

### Features

- **embed**: Expose --max-length so a skipped sequence is actionable
  ([`51e7de5`](https://github.com/tsenoner/protspace/commit/51e7de5d652076127c6202679d91405a4ed1f701))

### Refactoring

- **cli**: Keep the MMseqs2 install hint in one place
  ([`b3ee486`](https://github.com/tsenoner/protspace/commit/b3ee486d1bfc937a27895254f08e187e31ae0ef2))

- **notebook**: Clear the merge residue from the control panel
  ([`c2c69a2`](https://github.com/tsenoner/protspace/commit/c2c69a2985faf5ba5bae82918fdab6713c94c8cb))

- **notebook**: Import the embedder list instead of copying it
  ([`10df45e`](https://github.com/tsenoner/protspace/commit/10df45e3040125ec1557f5621cab0e3b047414f5))

### Testing

- **cli**: Strip ANSI before matching Rich's error text
  ([`0c2a778`](https://github.com/tsenoner/protspace/commit/0c2a778f8703fbe17d0f50822afdeaf9c2c66518))

- **cli**: Stub only the pymmseqs lookup, not every find_spec call
  ([`a00b3d1`](https://github.com/tsenoner/protspace/commit/a00b3d1e9f087f341f291d86914238f0ec695873))

- **docs**: Pin the extras section identical in README and the CLI guide
  ([`b2a5b22`](https://github.com/tsenoner/protspace/commit/b2a5b2233e5a0404b24c05bff99dfa5167c77004))

- **embed**: Cover the completeness contract and FASTA coverage
  ([`dd184d2`](https://github.com/tsenoner/protspace/commit/dd184d26b08d36ac2af8bb8b708c6af94a61d147))

- **embed**: Cover the incomplete-embedding paths
  ([`c7be138`](https://github.com/tsenoner/protspace/commit/c7be1383d78a6ff629ea7578d6e3e8f2c93a35d2))

- **embed**: Pin the --max-length rejection independently of terminal width
  ([`5b72f4d`](https://github.com/tsenoner/protspace/commit/5b72f4d13d5dfe969d865bc1274d7d51f1d72a7b))

- **notebook**: Pin the invariants the Colab fixes rely on
  ([`2fc7c11`](https://github.com/tsenoner/protspace/commit/2fc7c11382592e79118eda6250fee834f085eaa2))


## v4.11.0 (2026-08-11)

### Bug Fixes

- **transfer**: Error when an explicit reference rule matches nothing
  ([`0a653e0`](https://github.com/tsenoner/protspace/commit/0a653e0293b1bae55460d4b7bd292340c9eee32a))

### Documentation

- **transfer**: Stop teaching the filters-are-required workflow
  ([`9864e04`](https://github.com/tsenoner/protspace/commit/9864e04f4ab10f7ca2fdca414f157e23b863ae02))

### Features

- **transfer**: Apply EAT within one dataset when no rules are given
  ([`cda36bc`](https://github.com/tsenoner/protspace/commit/cda36bc4fe324cca9b9f4235f33f2bb94d0628cf))

### Refactoring

- **transfer**: Fold the both-open branch into the shared rule checks
  ([`878e430`](https://github.com/tsenoner/protspace/commit/878e4304a151756c8aa98e60b081e331e7a955e7))


## v4.10.3 (2026-08-10)

### Bug Fixes

- **protspace**: Derive the annotation schema from every record on every path
  ([`3d31875`](https://github.com/tsenoner/protspace/commit/3d31875c47dc5877791ffcdce3ba4a8a39c8cf5f))

- **protspace**: Scope the pdb cache migration and survive a failed refresh
  ([`88b8187`](https://github.com/tsenoner/protspace/commit/88b8187bb2be324a71ae8e35d8340b10f258a8b1))

### Refactoring

- **protspace**: Consolidate annotation cache versioning and dedupe transforms
  ([`e400228`](https://github.com/tsenoner/protspace/commit/e400228402e87f6d0a78dbddc2dd58c518ef2acf))

- **protspace**: Derive cache migrations from a version table
  ([`36e2894`](https://github.com/tsenoner/protspace/commit/36e28944bfb82ede1fd850b17eeabf6d8ad827d3))


## v4.10.2 (2026-08-10)

### Bug Fixes

- **protspace**: Keep a null pLDDT from blanking a TED accession
  ([`8ed0ab6`](https://github.com/tsenoner/protspace/commit/8ed0ab6c88ce287aa8d35e11621ea8847af64f91))

- **protspace**: Migrate legacy TED labels when reading the cache
  ([`014c1de`](https://github.com/tsenoner/protspace/commit/014c1de06f8653abed7f582370c702810681bb3c))

- **protspace**: Warn on legacy TED cache from every reuse path
  ([`3c7b862`](https://github.com/tsenoner/protspace/commit/3c7b862b662120b81168fee40cf2d38559068809))


## v4.10.1 (2026-08-07)

### Bug Fixes

- **bundle**: Close the review gaps in numeric typing and N/A handling
  ([`abe27bc`](https://github.com/tsenoner/protspace/commit/abe27bcdc8bad9ff59ba6174497f2ab639b3152c))

- **settings**: Read and preserve the frontend settings envelope in Python
  ([`1c33e62`](https://github.com/tsenoner/protspace/commit/1c33e62ee897f4df261069f98ddf068262ffdebc))

### Refactoring

- **bundle**: Derive numeric column types from the parquet schema
  ([`614cb42`](https://github.com/tsenoner/protspace/commit/614cb420c7612e997d2d80f78d4900793cb87c41))


## v4.10.0 (2026-08-06)

### Bug Fixes

- Correct four defects the review agents found in the statistics feature
  ([`87cac68`](https://github.com/tsenoner/protspace/commit/87cac682a4fe353201c488e7ac77a8281713a939))

- **annotations**: Preserve cached annotation semantics
  ([`3fbe03a`](https://github.com/tsenoner/protspace/commit/3fbe03a837aea83846d5eb166870c9e3dc45f812))

- **annotations**: Preserve cached pdb states
  ([`ee02c86`](https://github.com/tsenoner/protspace/commit/ee02c86864ae3b6d3568a9b29e05779bfeef5b97))

- **annotations**: Preserve cached taxonomy migration
  ([`f42426e`](https://github.com/tsenoner/protspace/commit/f42426e81e04e88384c552e6e3bc59a14d97436e))

- **annotations**: Preserve later annotation columns
  ([`2b2c88e`](https://github.com/tsenoner/protspace/commit/2b2c88e3a575dbffd9a70bf64eb2cb4904da0501))

- **annotations**: Preserve missing pdb availability
  ([`5d9d5b8`](https://github.com/tsenoner/protspace/commit/5d9d5b89337e245f4ce64fd56c6c972933d87e59))

- **annotations**: Preserve safe cache migration
  ([`b03b8f3`](https://github.com/tsenoner/protspace/commit/b03b8f3137a52586c8f345565d2942e63c2107ae))

- **protspace**: Address legacy TED cache output
  ([`31c5a93`](https://github.com/tsenoner/protspace/commit/31c5a93496f8e9f53c60b5e42cf03050891da2b6))

- **protspace**: Preserve unlabeled TED domain names
  ([`b724fba`](https://github.com/tsenoner/protspace/commit/b724fba0b7ac550a53aa18e521153258877c2268))

- **stats**: Compute per-category parts before emitting aggregates
  ([`571ecae`](https://github.com/tsenoner/protspace/commit/571ecae71e02fa5d3b514455cd9d5bc8ed1fbdf3))

- **stats**: Score around singleton categories instead of suppressing DBI/CH
  ([`b6a103e`](https://github.com/tsenoner/protspace/commit/b6a103e5d5cebfaf941684054e218b0a70db86cc))

- **stats**: Weight per-category silhouette by category size, not DBI
  ([`5135697`](https://github.com/tsenoner/protspace/commit/51356978c402d20f61a7eff46ed53c58fe8b4255))

### Documentation

- **protspace**: Document TED cache refresh
  ([`c98f66f`](https://github.com/tsenoner/protspace/commit/c98f66f3eeb10137add1c382e232d629c07e7b03))

- **stats**: Correct the retracted invariant on the silhouette helper
  ([`86b78e6`](https://github.com/tsenoner/protspace/commit/86b78e6e107d390e81430addd7caa81f4a16fb7b))

### Features

- **stats**: Score cluster_* membership columns as annotations
  ([`be8e7e7`](https://github.com/tsenoner/protspace/commit/be8e7e785ee6a7f486c30e07eebbd3c47de509c1))

- **stats**: Score silhouette and Davies-Bouldin per category
  ([`29beab1`](https://github.com/tsenoner/protspace/commit/29beab1481427422a95bde7666e30d83d8c6ba40))

### Refactoring

- State the metric registry, ceiling rule and cluster caveat once
  ([`510335c`](https://github.com/tsenoner/protspace/commit/510335c1e86619109a3895845204bf257a2b333a))

- **annotations**: Dedupe imports and use taxonomy constant
  ([`b885e6f`](https://github.com/tsenoner/protspace/commit/b885e6f1473975322a2b89ea90b3cf6de9502cef))

- **protspace**: Collapse TED domain formatting to one emit site
  ([`a66b347`](https://github.com/tsenoner/protspace/commit/a66b3474fad58dd4a32dfa28122135d8048be4a2))

### Testing

- **stats**: Pin per-category decomposition invariants against aggregate-repeat bugs
  ([`45d20e9`](https://github.com/tsenoner/protspace/commit/45d20e90a6e5b68cdf12ffc8f6a5df350f2ac059))


## v4.9.1 (2026-07-24)

### Bug Fixes

- **ci**: Relock uv.lock to 4.9.0 after the release version bump
  ([#387](https://github.com/tsenoner/protspace/pull/387),
  [`6e6ca12`](https://github.com/tsenoner/protspace/commit/6e6ca12af95f38224e7efbe5a3db5aa717b9b1c6))

### Chores

- **scripts**: Drop broken tomli fallback in generate_examples
  ([#387](https://github.com/tsenoner/protspace/pull/387),
  [`6e6ca12`](https://github.com/tsenoner/protspace/commit/6e6ca12af95f38224e7efbe5a3db5aa717b9b1c6))

### Continuous Integration

- **release**: Keep uv.lock in sync on release so --locked CI stays green
  ([#387](https://github.com/tsenoner/protspace/pull/387),
  [`6e6ca12`](https://github.com/tsenoner/protspace/commit/6e6ca12af95f38224e7efbe5a3db5aa717b9b1c6))

### Refactoring

- **protspace**: Remove dead annoy shim and tomli fallback
  ([#387](https://github.com/tsenoner/protspace/pull/387),
  [`6e6ca12`](https://github.com/tsenoner/protspace/commit/6e6ca12af95f38224e7efbe5a3db5aa717b9b1c6))

- **reducers**: Remove dead annoy fallback shim
  ([#387](https://github.com/tsenoner/protspace/pull/387),
  [`6e6ca12`](https://github.com/tsenoner/protspace/commit/6e6ca12af95f38224e7efbe5a3db5aa717b9b1c6))

- **release**: Tidy sync_lock_version.py per review
  ([#387](https://github.com/tsenoner/protspace/pull/387),
  [`6e6ca12`](https://github.com/tsenoner/protspace/commit/6e6ca12af95f38224e7efbe5a3db5aa717b9b1c6))


## v4.9.0 (2026-07-24)

### Chores

- **protspace**: Drop duplicate deps and drifting version strings
  ([#376](https://github.com/tsenoner/protspace/pull/376),
  [`70b54f9`](https://github.com/tsenoner/protspace/commit/70b54f97867115949821482ee9fcdf12eb5b1ea6))

- **protspace**: Retire the legacy Dash container image
  ([#374](https://github.com/tsenoner/protspace/pull/374),
  [`4c36e5d`](https://github.com/tsenoner/protspace/commit/4c36e5ddead514a991a64ac70a7df9c136dd2b60))

### Continuous Integration

- **protspace**: Drop the redundant root .python-version
  ([#382](https://github.com/tsenoner/protspace/pull/382),
  [`f93f9c6`](https://github.com/tsenoner/protspace/commit/f93f9c6a51e8ac248bda64d91aa51cd8de7e21ad))

- **protspace**: Test Python 3.12-3.14, pin interpreters, add 3.15 canary
  ([#382](https://github.com/tsenoner/protspace/pull/382),
  [`f93f9c6`](https://github.com/tsenoner/protspace/commit/f93f9c6a51e8ac248bda64d91aa51cd8de7e21ad))

### Documentation

- **protspace**: Clarify why the ruff target-version pin is load-bearing
  ([#382](https://github.com/tsenoner/protspace/pull/382),
  [`f93f9c6`](https://github.com/tsenoner/protspace/commit/f93f9c6a51e8ac248bda64d91aa51cd8de7e21ad))

- **protspace**: Correct drifting facts in CLAUDE.md and installation docs
  ([#377](https://github.com/tsenoner/protspace/pull/377),
  [`fc88c03`](https://github.com/tsenoner/protspace/commit/fc88c037c2c54b6bae55b7013b230a5cb122db4d))

### Features

- **protspace**: Require Python >=3.12 ([#382](https://github.com/tsenoner/protspace/pull/382),
  [`f93f9c6`](https://github.com/tsenoner/protspace/commit/f93f9c6a51e8ac248bda64d91aa51cd8de7e21ad))

- **protspace**: Require Python >=3.12, fix the CI version matrix, add a future-Python canary
  ([#382](https://github.com/tsenoner/protspace/pull/382),
  [`f93f9c6`](https://github.com/tsenoner/protspace/commit/f93f9c6a51e8ac248bda64d91aa51cd8de7e21ad))

### Refactoring

- **protspace**: Adopt py312 idioms unmasked by the ruff bump
  ([#382](https://github.com/tsenoner/protspace/pull/382),
  [`f93f9c6`](https://github.com/tsenoner/protspace/commit/f93f9c6a51e8ac248bda64d91aa51cd8de7e21ad))


## v4.8.2 (2026-07-21)

### Bug Fixes

- **eat**: Preserve structured transfer semantics
  ([#277](https://github.com/tsenoner/protspace/pull/277),
  [`d53bc50`](https://github.com/tsenoner/protspace/commit/d53bc50e0a8d287bd5a3adf6b34e32602817c143))

- **eat**: Stabilize large-dataset remediation
  ([#277](https://github.com/tsenoner/protspace/pull/277),
  [`3917652`](https://github.com/tsenoner/protspace/commit/39176526fbf2b1b855b59084d3156b4d24591d5a))


## v4.8.1 (2026-07-20)

### Bug Fixes

- **protspace**: Keep plotly out of the CLI import path
  ([`c899ff9`](https://github.com/tsenoner/protspace/commit/c899ff9ab3acda5e468d1029da8a09545bd02d03))

- **protspace**: Preserve MARKER_SHAPES_2D public import path
  ([`33e5503`](https://github.com/tsenoner/protspace/commit/33e55034f56f285be9d13a336c2e985e94569aa2))

### Chores

- Add package metadata and web SEO after monorepo move
  ([`af65547`](https://github.com/tsenoner/protspace/commit/af65547cbb44cb9442cc44f05f1c5baa75cd2d9a))

### Code Style

- **cli**: Wrap long ANNOTATIONS_URL to satisfy ruff format
  ([`432a215`](https://github.com/tsenoner/protspace/commit/432a215c1820f7fbef8dc42042df421f7ede3112))

### Documentation

- Align product descriptions and taglines across all surfaces
  ([`51e1bec`](https://github.com/tsenoner/protspace/commit/51e1becdf15b9f42c6852694be2ef5f747aee1c4))

- Fix pre-monorepo paths and stale facts after monorepo move
  ([`44a53ad`](https://github.com/tsenoner/protspace/commit/44a53ad5ca752a15a501d5bae7d70fdf5420d61d))

- Fix stale links, correct license to MIT, add citations after monorepo move
  ([`71d0206`](https://github.com/tsenoner/protspace/commit/71d02065d7b342e3691f793f9a8b146728a2aa70))

- Rename citation label "tool paper" -> "original publication"
  ([`12d8944`](https://github.com/tsenoner/protspace/commit/12d8944b85b5f5cbc44d24cbaf3d47c2d5761372))

- Restructure README (user-focused + badges), drop legacy "ProtSpace Web" brand
  ([`650e521`](https://github.com/tsenoner/protspace/commit/650e521061c983a8a7108af2bf1deda098778163))

- **embed**: Pinpoint Biocentral ESM-C root cause (biotrainer arch mis-load)
  ([`f5c1426`](https://github.com/tsenoner/protspace/commit/f5c142692afd19e764b052dc47b3b5f7021d5ff3))

- **embed**: Record local↔Biocentral embedding parity (PR3, issue #59)
  ([`f4c4720`](https://github.com/tsenoner/protspace/commit/f4c47203fbd583e665d850022860d44edf2a78ea))

- **notebook**: Append optional in-session EAT cell to Preparation Colab (issue #59, PR6)
  ([`4e15556`](https://github.com/tsenoner/protspace/commit/4e1555652419c6d17c18a7b44ba9b7cc145ff68f))

- **notebook**: Local embedding backend in Preparation Colab (issue #59, PR4)
  ([`ebd7d37`](https://github.com/tsenoner/protspace/commit/ebd7d376d49f811d74b7de31b25befb241ebb7b3))

- **notebook**: Wire projection statistics toggle into Preparation Colab (issue #59, PR5)
  ([`10da014`](https://github.com/tsenoner/protspace/commit/10da0147cfbf05953db3510ec3223f554c854253))

### Refactoring

- **protspace**: Tidy lazy MARKER_SHAPES_2D resolution
  ([`49eb031`](https://github.com/tsenoner/protspace/commit/49eb031a51052e3bc4f11d60751ee08b62950a86))


## v4.8.0 (2026-07-16)

### Chores

- Bump API for proxy fix
  ([`66130be`](https://github.com/tsenoner/protspace/commit/66130be8d3189a37b0276695cff597e161b00215))

### Continuous Integration

- **release**: Upgrade python-semantic-release to v10 + scope releases to apps/protspace
  ([#328](https://github.com/tsenoner/protspace/pull/328),
  [`3482d85`](https://github.com/tsenoner/protspace/commit/3482d852581579f26236210b045ce14a58e5265a))

### Features

- **embed**: Local GPU/CPU embedding backend + biocentral/local switch (issue #59)
  ([`cec9334`](https://github.com/tsenoner/protspace/commit/cec933442a680ce03e9701c49a3e6e0b5b4e3beb))


## v4.7.2 (2026-07-14)

### Bug Fixes

- Point the PyPI README "ProtSpace Web" source link to tsenoner/protspace
  ([#327](https://github.com/tsenoner/protspace/pull/327),
  [`773cd81`](https://github.com/tsenoner/protspace/commit/773cd812a4978116435181b993eeeaf8666d93db))


## v4.7.1 (2026-07-14)

- Initial Release
