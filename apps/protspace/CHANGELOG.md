# CHANGELOG


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
