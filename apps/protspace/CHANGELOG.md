# CHANGELOG


## v4.16.2 (2026-10-07)

### Bug Fixes

- **annotate**: Fail the Biocentral source when the client no longer lists a model
  ([`030e5a7`](https://github.com/tsenoner/protspace/commit/030e5a76a53680723001acabb4fcfce9bafa4a06))

### Continuous Integration

- **biocentral**: Check the live server against the shipped client once a day
  ([`f4b6c90`](https://github.com/tsenoner/protspace/commit/f4b6c903e1e3fe754c7995b753eb8ba8a3b4a26f))


## v4.16.1 (2026-10-07)

### Bug Fixes

- **embed**: Hold the embedder shortcut ids instead of the client's member names
  ([`7d9d696`](https://github.com/tsenoner/protspace/commit/7d9d696b229f0899d0681a430be44bf24ed34dca))

- **embed**: Say why no Biocentral server was usable
  ([`3d6682a`](https://github.com/tsenoner/protspace/commit/3d6682a0ba9d2952cf444e8bae54a78fd207110b))

- **embed**: Stop a multi-model embed at the first connection failure
  ([`d29c348`](https://github.com/tsenoner/protspace/commit/d29c348fc03fc0c2d5559e15d74570ea3a7673b9))

- **embed**: Support the Biocentral v2 server
  ([`0741e08`](https://github.com/tsenoner/protspace/commit/0741e08fe95f1142af83a71953ce1253c8430259))

### Chores

- Default showcase build output to <suite>/protspace-showcase
  ([`996537b`](https://github.com/tsenoner/protspace/commit/996537b8e54b0e10078409215f5162f2d99cadc2))

- **examples**: Accept every top-level taxonomy node as a root
  ([`6516fed`](https://github.com/tsenoner/protspace/commit/6516fedb98525440066da1f43459e2cc75785588))

- **examples**: Accept the 2026_03 class-C and kinase counts
  ([`19cf76f`](https://github.com/tsenoner/protspace/commit/19cf76fc78f27ff4d28e0fb61ac6fac54713ad51))

- **examples**: Add the showcase bundle build script
  ([`33319c4`](https://github.com/tsenoner/protspace/commit/33319c43a184ff2acda9f1a97a56c46d448de629))

- **examples**: Build the showcase bundles as parquetbundle v3
  ([`53c9067`](https://github.com/tsenoner/protspace/commit/53c90671f283582e3669d6f12f13eea0166fd92f))

- **examples**: Check stage-release against the published release
  ([`31e7395`](https://github.com/tsenoner/protspace/commit/31e73953ada5ae5b14f83faf4426ba3b877a1645))

- **examples**: Commit the paper datasets' recipe fixes
  ([`13bffd8`](https://github.com/tsenoner/protspace/commit/13bffd811ed980f88bf0d733aaf9b657cb28fdf7))

- **examples**: Cut 3FTx references and queries by one rule
  ([`5388e2c`](https://github.com/tsenoner/protspace/commit/5388e2c3b3bfa3ff0d8ee159c5ecccbc8dd4e46d))

- **examples**: Draw the smaller groups on top, as Figs. 2A and 2B do
  ([`434210a`](https://github.com/tsenoner/protspace/commit/434210ae28409cc2bf189094b91fe0081556afc8))

- **examples**: Drop the unused long-chain rule; fix the kinase note
  ([`0a18af6`](https://github.com/tsenoner/protspace/commit/0a18af6cbb482b9ae5ea6a8d4e977ddfb7d6876a))

- **examples**: Follow the Monodnaviria to Floreoviria realm rename
  ([`f605fdd`](https://github.com/tsenoner/protspace/commit/f605fdde361c009a241f4537c2941e4450a034b8))

- **examples**: Keep machine paths out of the build provenance
  ([`afd4326`](https://github.com/tsenoner/protspace/commit/afd4326e3a96a69303481dcd850540a0dc26c85a))

- **examples**: Keep the EAT transfer count exact
  ([`c37f890`](https://github.com/tsenoner/protspace/commit/c37f89024cfbf3fd0d578d9a94bd2789a552b989))

- **examples**: Pin which rows the 3FTx hold-out withholds
  ([`137da1b`](https://github.com/tsenoner/protspace/commit/137da1bd6adb4f11de49494ba4ef0e02377954d7))

- **examples**: Read parquetbundle v3 in the manifest writer
  ([`15398db`](https://github.com/tsenoner/protspace/commit/15398db8a4b5135192b87278b6fdafe4fe441a28))

- **examples**: Record the D4 reason for Swiss-Prot's skipped Biocentral stage
  ([`8c23241`](https://github.com/tsenoner/protspace/commit/8c232416b382ce36e0710d86ae338e62ed86ee39))

- **examples**: Record the UniProt releases derived from the data
  ([`67b42cb`](https://github.com/tsenoner/protspace/commit/67b42cb50046dfecff0cc5af95b2b22d4dd4c78a))

- **examples**: Redact every spelling of a path in the build command
  ([`a9d6bfa`](https://github.com/tsenoner/protspace/commit/a9d6bfa8ff85b6535af52054b08cfba27f10f413))

- **examples**: Replace the EAT recipes with three-finger-toxins
  ([`da5dab9`](https://github.com/tsenoner/protspace/commit/da5dab97b6718dfbf522cfd08392ffc903a42e96))

- **examples**: Test N/A hits as the web does, suffix included
  ([`4b03b3c`](https://github.com/tsenoner/protspace/commit/4b03b3c48297a14df4ab835c0f66b9e4edfb6a66))

- **protspace**: Harden the example manifest writer
  ([`d227853`](https://github.com/tsenoner/protspace/commit/d227853c8172514f5b17481248cdd45bf246a8a0))

- **protspace**: Record whether an example bundle has statistics
  ([`d78f341`](https://github.com/tsenoner/protspace/commit/d78f34157d8eec0008ad111d893426ef046724a5))

- **protspace**: Stage the perf-datasets release assets
  ([`7f3081c`](https://github.com/tsenoner/protspace/commit/7f3081c9b5145e7be340d22101707309011f5916))

- **protspace**: Take the demo's legend styling from its fixture
  ([`1d621a9`](https://github.com/tsenoner/protspace/commit/1d621a9f8f5c7a6889029e789ff03e64c85e22ae))

- **protspace**: Write the example manifest from the bundle files
  ([`04529e0`](https://github.com/tsenoner/protspace/commit/04529e002b30026c27e63d14966bd3dc888962f4))

### Continuous Integration

- Run the protspace slow tests weekly with the local extra
  ([`2f0ec6c`](https://github.com/tsenoner/protspace/commit/2f0ec6c93a6506e5d552996194307f685da7d687))

### Documentation

- **examples**: Record the 2026_03 build on the released CLI
  ([`2593768`](https://github.com/tsenoner/protspace/commit/2593768d9eb59d5a54f52dadf75228203480fe5a))

- **examples**: Record the move of the showcase bundles to parquetbundle v3
  ([`6de616d`](https://github.com/tsenoner/protspace/commit/6de616d6b368a231af50d306966f87b806f70ca0))

- **examples**: Record the v4.16.0 rebuild of the showcase bundles
  ([`a876d1f`](https://github.com/tsenoner/protspace/commit/a876d1fb73cf69c985c89bb269bdee3848517066))

- **examples**: Say why the step keys still name two retired options
  ([`3b19884`](https://github.com/tsenoner/protspace/commit/3b198841e830ff6349de8bd353c9f5e34c2bd831))

- **explore**: State how the beta-lactamase set was selected
  ([`dcf351c`](https://github.com/tsenoner/protspace/commit/dcf351c3f3911627b5f8520f491696a81ff0bc9b))

- **guide**: Explain the Biocentral version error and 3.14 with pip
  ([`d82e95c`](https://github.com/tsenoner/protspace/commit/d82e95ccfe63144470b6903c314a169b4b821af2))

- **openspec**: Bring the archived change and CLAUDE.md up to date with review
  ([`5954438`](https://github.com/tsenoner/protspace/commit/59544381fef1b8673280f98b8d3599010d15497c))

- **protspace**: Drop stale silhouette wording from stats carriage
  ([`99af6ff`](https://github.com/tsenoner/protspace/commit/99af6ff6853b86855bde50be60d173918b32eed2))

- **protspace**: List the example build's test files in CLAUDE.md
  ([`c7e9ef5`](https://github.com/tsenoner/protspace/commit/c7e9ef57de7a8e72e6834485a1838db2ad60c0ca))

### Refactoring

- **data**: Name the settings-envelope check and the digest attribute publicly
  ([`7268793`](https://github.com/tsenoner/protspace/commit/72687937c04c04b3afb7f8e621ac22c0979652fa))

- **data**: Read every part of a bundle in one call
  ([`a70d003`](https://github.com/tsenoner/protspace/commit/a70d00334295057f2012f787f6597e11173b9b0d))

- **embed**: Read the client's window off the client, not at import
  ([`f96a1f4`](https://github.com/tsenoner/protspace/commit/f96a1f4756b644a325d05bfd48fedf18062a94b2))

- **examples**: Check embedded chains with protspace's digest and FASTA reader
  ([`d99ce0d`](https://github.com/tsenoner/protspace/commit/d99ce0d44170a2a66b3dc625ab64d96c23efb2d6))

- **examples**: Drop recipe options no recipe uses
  ([`04807b1`](https://github.com/tsenoner/protspace/commit/04807b1896f54d7e794b39154823383b03a1b8ca))

- **examples**: Fetch from UniProt through protspace's retrying GET
  ([`f201f61`](https://github.com/tsenoner/protspace/commit/f201f61c48079a7c8ce6b7ad1274ff02a24c12da))

- **examples**: Fill the missing taxonomy of the rows that need it only
  ([`7b8e80a`](https://github.com/tsenoner/protspace/commit/7b8e80aca681a62b65fe6cb43d3ac6f31b42c377))

- **examples**: Filter styles and wrap settings with protspace's own rules
  ([`598cccb`](https://github.com/tsenoner/protspace/commit/598cccb6ea2617277fcb4c7654195030382e6b65))

- **examples**: Move stage-perf into a script of its own
  ([`75cd23f`](https://github.com/tsenoner/protspace/commit/75cd23f0cb37e514a06f9c3963987157d5ff362b))

- **examples**: Read bundles with protspace's one-call reader
  ([`765c76e`](https://github.com/tsenoner/protspace/commit/765c76ebca17fa63bea4c41bfa69a9c296ed2cf6))

- **examples**: Read only the build's release groups in the manifest writer
  ([`da80ba2`](https://github.com/tsenoner/protspace/commit/da80ba2a24a47a37d89da6451e5b5c7cc803f67b))

- **examples**: Redact the build command with the manifest writer's rules
  ([`88dfaec`](https://github.com/tsenoner/protspace/commit/88dfaec2d82a3383ff84c096341543e6bd853eba))

- **examples**: Require protspace 4.16.0 of the CLI instead of probing its source
  ([`c802f6d`](https://github.com/tsenoner/protspace/commit/c802f6d8e37aea1813560eb5de9224a65afe7c79))

- **examples**: Search each candidate view's neighbours once in the report
  ([`9b190f9`](https://github.com/tsenoner/protspace/commit/9b190f9ddf40a922797e598718a181f350098472))

- **examples**: Share the TSV reader, the full-length evidence and the gate table
  ([`3c53277`](https://github.com/tsenoner/protspace/commit/3c5327728d311856af556ace4880b72eb9dd8e5a))

- **examples**: Summarise each column once per verify
  ([`19d9911`](https://github.com/tsenoner/protspace/commit/19d99115fee901ff57b60de2b5966c051de85fcf))

- **examples**: Take every default view from the web catalog
  ([`c8e38ba`](https://github.com/tsenoner/protspace/commit/c8e38baa979d7e9bd1d2e4709502ede87e74de3e))

- **examples**: Take the showcase build's constants and helpers from protspace
  ([`051a0ef`](https://github.com/tsenoner/protspace/commit/051a0ef3deeb3d21f10ac1bc259c9d4bc578a6a5))

- **examples**: Take the toxprot demo's palette from protspace
  ([`8c268b4`](https://github.com/tsenoner/protspace/commit/8c268b4af2bd493e3a3ce932f8b71c247473a307))

- **examples**: Write the toxprot demo's full-length FASTA with write_mature_fasta
  ([`0266241`](https://github.com/tsenoner/protspace/commit/0266241bb68b9fe1764da4e597b581b4ee647594))

- **style**: Expose the style-key resolver and a column's style keys
  ([`3dab46d`](https://github.com/tsenoner/protspace/commit/3dab46dc3e58a75506b75b1078d28e34e973a5a6))

### Testing

- **examples**: Default the one-protein bundle in the manifest tests
  ([`bf46e4e`](https://github.com/tsenoner/protspace/commit/bf46e4ea1762a55fe87ed810e4b26caf9ac57918))

- **protspace**: Assert v3 score bytes are little-endian float64
  ([`751a866`](https://github.com/tsenoner/protspace/commit/751a866e65577aa6d2153651a09b5a40c9c1d2a8))

- **protspace**: Check Biocentral dedup on what reaches the API
  ([`dfba7b8`](https://github.com/tsenoner/protspace/commit/dfba7b8eacfeece85dab39caf7933f12d8150ea4))

- **protspace**: Check the palette ids against the frontend source
  ([`fd562f3`](https://github.com/tsenoner/protspace/commit/fd562f360d3bab4437d5cdebca00df2ce3c1bc1d))

- **protspace**: Collapse protein_families identity tests into a table
  ([`291005a`](https://github.com/tsenoner/protspace/commit/291005a2900899d99bcc6cf6346fc73aed0d3f8d))

- **protspace**: Cover resume with a new protein offline, drop the slow copy
  ([`78ef81f`](https://github.com/tsenoner/protspace/commit/78ef81fe9b8c72bd1f322277f5ea64199d4e0f96))

- **protspace**: Drop constant re-assertions
  ([`0ae0fc6`](https://github.com/tsenoner/protspace/commit/0ae0fc65ed583637669574614706e01386482bd5))

- **protspace**: Drop dead test_config fixtures and existence-only output tests
  ([`61cac55`](https://github.com/tsenoner/protspace/commit/61cac55c5d051993d133b5caa9e99677cbb2b31f))

- **protspace**: Fit each reducer once, test float16 upcast for real
  ([`4d0af3f`](https://github.com/tsenoner/protspace/commit/4d0af3f9b3accb7ed25d371408564c9ad815cdb4))

- **protspace**: Fold the overlay reruns into one parametrized test
  ([`81f2997`](https://github.com/tsenoner/protspace/commit/81f299769cfbff3d412a52e2e0b6a2acb4f9314f))

- **protspace**: Keep the --max-length rejection test offline
  ([`0fd4b90`](https://github.com/tsenoner/protspace/commit/0fd4b90d53c855c3226487f2ba11a62b6deb3eaf))

- **protspace**: Make skip warnings name their own identifiers
  ([`d1f33aa`](https://github.com/tsenoner/protspace/commit/d1f33aa822ed392aaa0a5e7e35dbe6959c042c29))

- **protspace**: Merge the duplicate transfer helper, make the help test bite
  ([`b3fc4be`](https://github.com/tsenoner/protspace/commit/b3fc4bee53f641fbc74a289134560f6a771f493a))

- **protspace**: Merge UniProt fetch tests, make batching test bite
  ([`1bf7978`](https://github.com/tsenoner/protspace/commit/1bf7978f9c2b10114c10ea83ddec02790c85beb5))

- **protspace**: Parametrize GO encoding tests, cite emitters by name
  ([`2ff555f`](https://github.com/tsenoner/protspace/commit/2ff555fb6d7c5f95e3e6192ddf4a7a2627dc722a))

- **protspace**: Parametrize method-spec and colour conversion cases
  ([`9a170b9`](https://github.com/tsenoner/protspace/commit/9a170b97f06dc8ff969ccb19a1f89e0d358b24ff))

- **protspace**: Parametrize the FASTA parser cases on tmp_path
  ([`443d4b9`](https://github.com/tsenoner/protspace/commit/443d4b9526d7a032251214730c28e9b531668f92))

- **protspace**: Pin MDS similarity conversion and unbundled files
  ([`9f61280`](https://github.com/tsenoner/protspace/commit/9f612804a12d17e4afe3ae434f564e7ff17d630f))

- **protspace**: Pin the build's release groups in the manifest
  ([`d668a46`](https://github.com/tsenoner/protspace/commit/d668a46c15c6efee15ddff08362bb1b9e9885bb6))

- **protspace**: Pin transfer k and clean CLI usage errors
  ([`1b338b7`](https://github.com/tsenoner/protspace/commit/1b338b78d575f3a04fe997192c529e17fd3c531a))

- **protspace**: Pin whole InterPro annotation dicts, drop a dead patch
  ([`55a0898`](https://github.com/tsenoner/protspace/commit/55a089898c9b115a5fd220a30e0be406ede0de4d))

- **protspace**: Read the outage patterns from the prep source
  ([`21dd83a`](https://github.com/tsenoner/protspace/commit/21dd83add2c7ab89ef8e50c1d72d71b23c968421))

- **protspace**: Remove obsolete and subsumed single tests
  ([`c7c5e45`](https://github.com/tsenoner/protspace/commit/c7c5e4548d453bfa5cb2af6a955376a4a2cbcde8))

- **protspace**: Remove small duplicate tests
  ([`d2cd7aa`](https://github.com/tsenoner/protspace/commit/d2cd7aa29cf57c1e22fd742cb6b652222c59f19d))

- **protspace**: Run the offline showcase build in CI
  ([`7b0393f`](https://github.com/tsenoner/protspace/commit/7b0393fb4ccdee42d2d6a83cba9cfaf2696cc8d1))

- **protspace**: Share manager integration mocks, assert merged values
  ([`7f74c3e`](https://github.com/tsenoner/protspace/commit/7f74c3e1919b74e89b32e2a2304052502b01badd))

- **protspace**: Stop asserting the stamp read_bundle adds itself
  ([`5dc94c6`](https://github.com/tsenoner/protspace/commit/5dc94c6cd46fa129211157c052ce99c110ef4ba5))

- **protspace**: Stop claiming cluster membership carries a silhouette
  ([`07be5b3`](https://github.com/tsenoner/protspace/commit/07be5b3a0c43755e0d3019600ba6c8db695be9d4))

- **protspace**: Stop the manager swallowing forbidden refetches
  ([`f51ff9e`](https://github.com/tsenoner/protspace/commit/f51ff9e18f4e0fcc90ed1be7ff5026754264d7dc))

- **protspace**: Table annotation config cases, keep one wiring test
  ([`9b39acf`](https://github.com/tsenoner/protspace/commit/9b39acf393c6a886eb9f7f1a196bb1b1648032c1))

- **protspace**: Table embedder shortcuts, stop leaking .h5 temp files
  ([`492758e`](https://github.com/tsenoner/protspace/commit/492758e2b5a6ce9a074dac29ba105f20b1d033ff))

- **protspace**: Table transformer field mappings through transform()
  ([`dc24e14`](https://github.com/tsenoner/protspace/commit/dc24e14701abc8f0321fbd7f984dffa481d35b16))


## v4.16.0 (2026-10-02)

### Bug Fixes

- **data**: Count a point with any finite axis as placed, as the browser does
  ([`97b4682`](https://github.com/tsenoner/protspace/commit/97b468289e0473f446a1b53f669d9ea85f28a676))

- **data**: Decide a v3 numeric column's int/float type over the placed proteins
  ([`5d31feb`](https://github.com/tsenoner/protspace/commit/5d31feb640f4b7ee59e68265be8639ba5d07af0c))

- **data**: Leave a projection with no decoded rows out of the decoded metadata
  ([`6999c7e`](https://github.com/tsenoner/protspace/commit/6999c7ec8b494d3b069f8871c21e638bc09162b1))

- **data**: Re-convert venom_eat_stats without the internal lookup columns
  ([`f8618be`](https://github.com/tsenoner/protspace/commit/f8618be8f90f86b3da16783e3747c9e6a911d191))

- **protspace**: Drop the internal lookup columns when upgrading a legacy bundle
  ([`e98a124`](https://github.com/tsenoner/protspace/commit/e98a1240cb637621e0e839bf7a03d759bf6e7609))

- **transfer**: Key a legacy bundle's rows as convert does
  ([`a2a4964`](https://github.com/tsenoner/protspace/commit/a2a49649f766baa2427af8d6784d8ede46582e0f))

### Refactoring

- **data**: Drop the unreachable legacy layout from _write_parts
  ([`718a90d`](https://github.com/tsenoner/protspace/commit/718a90d07cb845d95ceab56ca15055e444bda82e))

- **data**: Move v3 hit-score parsing into its own helper
  ([`2183332`](https://github.com/tsenoner/protspace/commit/2183332f7e670f8f805576b5f9b01044dd9f5235))

- **data**: Take a pa.Table only in the format-version helpers
  ([`e2bdb03`](https://github.com/tsenoner/protspace/commit/e2bdb0352c0ef521f268154e4e18a499b58351a3))

### Testing

- **cli**: Match convert's usage error on plain text, not Rich's styling
  ([`7de9791`](https://github.com/tsenoner/protspace/commit/7de979162f36d1359ad63781aa95cb3eedae8464))


## v4.15.0 (2026-09-30)

### Bug Fixes

- **bundle**: Convert and style legacy bundles keyed as the v2 browser keyed them
  ([`6d624ca`](https://github.com/tsenoner/protspace/commit/6d624caec9686be6d65d76ab1c0c3928c9ab1ba5))

- **bundle**: Encode a list annotation column as a multi-valued column
  ([`28ff8a1`](https://github.com/tsenoner/protspace/commit/28ff8a13848f574eecea2141855cc3b326477cae))

- **bundle**: Migrate a v1 hit at its last pipe, as the browser reads it
  ([`95c0a48`](https://github.com/tsenoner/protspace/commit/95c0a4821b7932ad88aa495fedcab7e82bbb7c5d))

- **bundle**: Never infer a list annotation column as numeric
  ([`ad5e7a0`](https://github.com/tsenoner/protspace/commit/ad5e7a062fd5e35a51e3bb683597b358d775a9fe))

- **bundle**: Read the prepare annotation cache as v2 in bundle -a
  ([`a87346b`](https://github.com/tsenoner/protspace/commit/a87346b473af82c0997a535ae7d76fc62678326f))

- **bundle**: Refuse annotation tables of unknown cell grammar
  ([`babe028`](https://github.com/tsenoner/protspace/commit/babe0289b847f7cbad0975acda8fa21e5da7b3bc))

- **bundle**: Report a part 1 footer pyarrow cannot deserialize as a bundle error
  ([`d50d0ce`](https://github.com/tsenoner/protspace/commit/d50d0ce855720ee8b488f9c1d0667f196429db03))

- **bundle**: Store 64-bit integers past 2^53 as exact labels
  ([`5b4681f`](https://github.com/tsenoner/protspace/commit/5b4681f091155adf8ccfc426052820a3f403539a))

- **bundle**: Store missing coordinates as NaN, not the origin
  ([`0d591c0`](https://github.com/tsenoner/protspace/commit/0d591c0dcbdde00e527eebcee3483a528c08104d))

- **bundle**: Treat a NaN z column as 2D when deriving the dimension
  ([`8b3389f`](https://github.com/tsenoner/protspace/commit/8b3389fce988292a5a95e38d28b52b0ad12ca424))

- **bundle**: Write boolean annotations as true/false
  ([`e59073b`](https://github.com/tsenoner/protspace/commit/e59073b4d08761c556220199d7786dcd08c3812c))

- **bundle**: Write part 1 in the protein order the v2 browser built
  ([`9c239bd`](https://github.com/tsenoner/protspace/commit/9c239bda7d589741fa73c4fb7b295172e9f0bfff))

- **bundle**: Write the derived dimension into projection metadata
  ([`ba41fbe`](https://github.com/tsenoner/protspace/commit/ba41fbe70149aa6c55bf778ef7af32f89eb5132b))

- **notebooks**: Restore the cell grammar before the Colab EAT write
  ([`698a292`](https://github.com/tsenoner/protspace/commit/698a2928b585d3821ceb4bc0ab9606d53ead55ef))

- **notebooks**: Show only the predicted rows in the Transfer read-back
  ([`0c647cc`](https://github.com/tsenoner/protspace/commit/0c647cc83e95699db9732be2176f15cafa07b38b))

- **protspace**: Batch Biocentral predictions
  ([`1f3bcd5`](https://github.com/tsenoner/protspace/commit/1f3bcd58a4a453ead6690bc1325dea2e8cd161e9))

- **protspace**: Bound Biocentral requests by residues, split on failure
  ([`07faa0b`](https://github.com/tsenoner/protspace/commit/07faa0b56b6ca40d8ab55a19275cccbd789b35f5))

- **protspace**: Don't cache lookups a lost UniProt batch left empty
  ([`d53be6b`](https://github.com/tsenoner/protspace/commit/d53be6baafa31aec26e1fefde2a5b5a0041a2709))

- **protspace**: Fetch sequences for Biocentral the cache lacks
  ([`ab712e1`](https://github.com/tsenoner/protspace/commit/ab712e1b46efe4e4774c57c19ba96f534136fb77))

- **protspace**: Give InterPro matches to all proteins sharing a sequence
  ([`07be62b`](https://github.com/tsenoner/protspace/commit/07be62b70b4de0765c627bd3ec22a99aa5877ecd))

- **protspace**: Infer a v3 column's kind over the placed proteins, as v2 did
  ([`f77568b`](https://github.com/tsenoner/protspace/commit/f77568b255e2f0d121f995a02db66265f17b538a))

- **protspace**: Keep a failed source's cached values, save the rest
  ([`b6f6b27`](https://github.com/tsenoner/protspace/commit/b6f6b27bb3ed1bb0bf33a8a34fcd54c8470958b5))

- **protspace**: Keep an empty TMbed payload missing, not negative
  ([`622f6ae`](https://github.com/tsenoner/protspace/commit/622f6ae59913bcd4252dc4aa6c96367a8ef8858d))

- **protspace**: Keep InterPro-N predictions out of InterPro columns
  ([`22f17ed`](https://github.com/tsenoner/protspace/commit/22f17edc147515ff6e18ba0614947d70c25b70c9))

- **protspace**: Keep label columns labels when transfer rewrites a bundle
  ([`8a4ce83`](https://github.com/tsenoner/protspace/commit/8a4ce83e46db496ae2f9b76f6ab76e066e17ee0c))

- **protspace**: Keep UniProt family names whole
  ([`59545d3`](https://github.com/tsenoner/protspace/commit/59545d3e0a95b4f6d70e55a45e4af8c9b4e8f2de))

- **protspace**: Key a legacy id column before migrating v1 cells
  ([`cf28452`](https://github.com/tsenoner/protspace/commit/cf284523c39abe6939d733bb6072050f8c9c7367))

- **protspace**: Label TMbed negatives 'non-transmembrane', not 'none'
  ([`c05ac8d`](https://github.com/tsenoner/protspace/commit/c05ac8dc1056e1d1d7d2fc2d9f147e327e889891))

- **protspace**: Let UniProt entry lookups honour Retry-After
  ([`b314e50`](https://github.com/tsenoner/protspace/commit/b314e501e354ed19b39bc847f940fe5c9aaa3c45))

- **protspace**: List a v3 bundle's projections in the v2 browser's order
  ([`888a3d5`](https://github.com/tsenoner/protspace/commit/888a3d5b92025971b379d22ed651fb31eb76197d))

- **protspace**: Migrate a v1 dictionary-of-strings column like a string one
  ([`c4822ea`](https://github.com/tsenoner/protspace/commit/c4822ea952f34704752e6d3b7042b72893ac49bc))

- **protspace**: Never cache empty values for proteins outside a run
  ([`870e346`](https://github.com/tsenoner/protspace/commit/870e3468ad0f4abdc530d4e9a72eeae1b2fb8ca0))

- **protspace**: Never write internal columns into a bundle
  ([`de9b746`](https://github.com/tsenoner/protspace/commit/de9b74641919562bf96b7a0ebb0c476abe15d893))

- **protspace**: Persist each annotation source as it finishes
  ([`e0963d8`](https://github.com/tsenoner/protspace/commit/e0963d85edc72a07a670bc42166cf4da071d286b))

- **protspace**: Refresh cached root and TMbed values (cache v3)
  ([`17daa30`](https://github.com/tsenoner/protspace/commit/17daa3063abe743dd9f48a2eff97fa91ce60e816))

- **protspace**: Refresh caches from before the family/InterPro fixes
  ([`b8c0e7c`](https://github.com/tsenoner/protspace/commit/b8c0e7cada0ee7d11f3b14269173799f2fa854b3))

- **protspace**: Refresh every cached column of a refetched source
  ([`b3c1a39`](https://github.com/tsenoner/protspace/commit/b3c1a390d4807b360c32f2f8af88212e71fd8a37))

- **protspace**: Retry failed TED lookups after the first pass
  ([`08fa265`](https://github.com/tsenoner/protspace/commit/08fa265fbc5d9c7325adcc0165ec77c3fb55a2d4))

- **protspace**: Retry InterPro match requests before counting them lost
  ([`832d4fb`](https://github.com/tsenoner/protspace/commit/832d4fb4b008a1847f6934b4c0773171fa515c46))

- **protspace**: Skip sequences Biocentral refuses instead of the batch
  ([`c49da81`](https://github.com/tsenoner/protspace/commit/c49da81b07a56b6a401315e00a560a1f4190cc39))

- **protspace**: Stop retrying once a fetch is abandoned
  ([`58e9917`](https://github.com/tsenoner/protspace/commit/58e9917351a192036fa85ccc43aa60041eeb9cb5))

- **protspace**: Take the taxonomy root from the top of the lineage
  ([`cae6f14`](https://github.com/tsenoner/protspace/commit/cae6f141ba3104af86808bd4168a4db5ac71c84e))

- **protspace**: Wait out a Retry-After extended during the wait
  ([`84c333d`](https://github.com/tsenoner/protspace/commit/84c333ddce6c53121a98444e259b3bd8609b068c))

### Chores

- **data**: Convert the served datasets to parquetbundle v3
  ([`e0e79b7`](https://github.com/tsenoner/protspace/commit/e0e79b753e024faebc3d55d4ebcf0b61ee41bf89))

### Documentation

- Stop saying a web export writes a missing cell as a Parquet NULL
  ([`f8f2b05`](https://github.com/tsenoner/protspace/commit/f8f2b052a5d824aa7f9808aab1d1987890f38d3c))

- **bundle**: Document the container and cell-grammar keys
  ([`364c04b`](https://github.com/tsenoner/protspace/commit/364c04b96b380344e6f1c5b88a8a0f8e11087496))

- **cli**: Document protspace convert and the v1/v2 deprecation
  ([`d5f9040`](https://github.com/tsenoner/protspace/commit/d5f9040a8e7108993da90a1735b537f651711c83))

- **openspec**: Reconcile the Biocentral length and request bounds
  ([`3b3f9b0`](https://github.com/tsenoner/protspace/commit/3b3f9b06180708cd4ef75bbdb0333d814f2a4aa8))

- **protspace**: Describe kept cache values, retries and rollback
  ([`213325e`](https://github.com/tsenoner/protspace/commit/213325edc21cc2dca5cb503abf53b83d023dfc9a))

- **protspace**: Describe parallel lookups and the InterPro-N filter
  ([`977413e`](https://github.com/tsenoner/protspace/commit/977413e9ddc276c578dff1e0bca0ddc1171b41f4))

- **protspace**: Describe slow requests, stops and current TED times
  ([`eba6e3c`](https://github.com/tsenoner/protspace/commit/eba6e3c4a7097453ce9d35677ee9c1b832cb6307))

- **protspace**: Describe the retrieval and cache fixes
  ([`47a11a8`](https://github.com/tsenoner/protspace/commit/47a11a874306386b4d6b1a5ed10817ec0c0dc78b))

- **protspace**: Describe what the v3 bundle tests now cover
  ([`467e824`](https://github.com/tsenoner/protspace/commit/467e824615fdbbd4da53a8c7520ffbdaa1966bf7))

- **protspace**: Note cache version 3 in the agent guide
  ([`cbd960f`](https://github.com/tsenoner/protspace/commit/cbd960f465c818d0dc72d07f27ec688205d444fe))

- **protspace**: Say protspace style writes a legacy input as v3
  ([`efd2cb1`](https://github.com/tsenoner/protspace/commit/efd2cb143c41ae1cc8d9a15dbda0c026ea9354dc))

### Features

- **bundle**: Add projected proteins that have no annotations row
  ([`e075d9b`](https://github.com/tsenoner/protspace/commit/e075d9badbb9489b22f874b1a88ede90de90217a))

- **bundle**: Write a styled legacy bundle as v3
  ([`ccc90ad`](https://github.com/tsenoner/protspace/commit/ccc90add895ddc95b33592229706fdd4ea95ef28))

- **cli**: Add protspace convert to upgrade v1/v2 bundles to v3
  ([`41aec2e`](https://github.com/tsenoner/protspace/commit/41aec2ea987b43ea3f3238c49c387c0f45466dbd))

- **protspace**: Record the UniProt release in run.log
  ([`93f6f96`](https://github.com/tsenoner/protspace/commit/93f6f96376e67e5ae09c8bb81015e4e063937404))

- **protspace**: Resume annotate from a cache directory
  ([`5d41776`](https://github.com/tsenoner/protspace/commit/5d417761fa67d5eb09d969c76ae3a1a695517136))

### Performance Improvements

- **protspace**: Keep workers busy while one lookup is slow
  ([`2f843c6`](https://github.com/tsenoner/protspace/commit/2f843c6e0f189e64f422f7779522241cb7e30f18))

- **protspace**: Look up TED domains 8 at a time over one session
  ([`1a334e3`](https://github.com/tsenoner/protspace/commit/1a334e35b1e1bfcecf0c6759c9c4379ce9f560e6))

- **protspace**: Reuse one connection for UniProt requests
  ([`4fa7a0b`](https://github.com/tsenoner/protspace/commit/4fa7a0b956bf3915f81e8bf67cb3458cb92f1588))

- **protspace**: Send 4 InterPro match batches at a time
  ([`923cae4`](https://github.com/tsenoner/protspace/commit/923cae468b65bae5a75221fdd9cf47254f7d8202))

### Refactoring

- **bundle**: Explain the double-migration hazard once
  ([`654e716`](https://github.com/tsenoner/protspace/commit/654e71657513ac704de102e702378e0bd453e728))

- **bundle**: Name the browser's missing tokens and boolean labels
  ([`7e41439`](https://github.com/tsenoner/protspace/commit/7e414398b89f1bfd5c46992cbda80d15aa240de7))

- **bundle**: Record the v3 container version under its own key
  ([`4787720`](https://github.com/tsenoner/protspace/commit/4787720f5db30327041f70c3ca0d2148578818ac))

- **bundle**: Replace annotations without re-pivoting projections
  ([`f8c05e1`](https://github.com/tsenoner/protspace/commit/f8c05e1bf1b96c0a836e2dc7ff9ebd54fd386e5b))

- **bundle**: Reuse _flat and read_format_version in the v3 paths
  ([`7aaf04d`](https://github.com/tsenoner/protspace/commit/7aaf04d10d2ca7ee561f86686cbe59896ca735de))

- **bundle**: Share the v3 numeric entry, offsets and part I/O helpers
  ([`5d2e253`](https://github.com/tsenoner/protspace/commit/5d2e2533078de9e79a67dad04d69421b44c36e83))

- **bundle**: Spell decoded int cells with a pyarrow cast
  ([`2035c7e`](https://github.com/tsenoner/protspace/commit/2035c7e8a04869b54815e22f753e6e34d78130d7))

- **protspace**: Let the retry helpers share a session
  ([`404a9cc`](https://github.com/tsenoner/protspace/commit/404a9cc593ff4e491fbd697c0956dfff8e3fdc14))

- **protspace**: Record the UniProt release each response reports
  ([`e879922`](https://github.com/tsenoner/protspace/commit/e879922b586581d5df6f8b74a025e27c754cec5f))

- **protspace**: Report no UniProt release for non-UniProt IDs
  ([`8dc26b1`](https://github.com/tsenoner/protspace/commit/8dc26b18c22c010782a9f66fe9958f6bf200962a))

- **protspace**: Share the annotation cache logic
  ([`53c7664`](https://github.com/tsenoner/protspace/commit/53c7664608f6e6b3698debf823a98c5ce0f8be19))

- **protspace**: Stop asking InterPro for matches once it is down
  ([`35bf3e2`](https://github.com/tsenoner/protspace/commit/35bf3e2aa3b0ad4c432ff1a28f926d4b25357437))

- **protspace**: Warn of an uncached source only when it stays so
  ([`27a5d1a`](https://github.com/tsenoner/protspace/commit/27a5d1aebc4d0d3e8008478619c50b6046a0a981))

- **style**: Read existing settings from the extracted bundle
  ([`89f40de`](https://github.com/tsenoner/protspace/commit/89f40de54bff0b93ea3945fad1a15ff9bcb6e24f))

### Testing

- **bundle**: Share the v3 test builders and part readers
  ([`d0f6b70`](https://github.com/tsenoner/protspace/commit/d0f6b700bb6ef6f224214fb1a4dfe7bc30ded1bc))

- **protspace**: Check the retrieval fixes meet in one prepare run
  ([`4647050`](https://github.com/tsenoner/protspace/commit/4647050ed3d0cdc8e43dea8a84290e6d18d6719f))

- **protspace**: Check the v3 drop on a run that writes the cache
  ([`b5894e4`](https://github.com/tsenoner/protspace/commit/b5894e463d65d97d128978a7bb6ec6d63ecc79c9))

- **protspace**: Let the failing UniProt fakes accept on_response
  ([`c02ed84`](https://github.com/tsenoner/protspace/commit/c02ed84720d0e7044e7feda74e6335241406d055))

- **protspace**: Pin which sources a legacy PDB refresh reuses
  ([`ea32b94`](https://github.com/tsenoner/protspace/commit/ea32b94167bd97ef98ef4d35209fd8a0c95c7560))

- **protspace**: Strip ANSI codes before matching annotate usage errors
  ([`58423e7`](https://github.com/tsenoner/protspace/commit/58423e79cd34dc761acbcda43bec117e24acd6d3))


## v4.14.0 (2026-09-30)

### Bug Fixes

- **bundle**: Guard the v3 write path's unstamped-table and corrupt-part hazards
  ([`597afbb`](https://github.com/tsenoner/protspace/commit/597afbbf487bfded62b199eb99de750a7dabf243))

- **bundle**: Make the legacy annotation migration idempotent and stamped
  ([`2ac5bf7`](https://github.com/tsenoner/protspace/commit/2ac5bf724896cc7dc094f97e45937fe794c79fef))

- **bundle**: Reject corrupt v3 label lengths and CSR counts
  ([`9d816ad`](https://github.com/tsenoner/protspace/commit/9d816ad7a6bfdab0b51c464e8505b880c9e553ed))

- **bundle**: Store v3 CSR lengths as per-row counts, not cumulative offsets
  ([`b298c57`](https://github.com/tsenoner/protspace/commit/b298c57c91cfb858e5d0307585a4d45037bc7abd))

- **bundle**: Store v3 scores as float64 and keep missing-token spellings
  ([`7119f8b`](https://github.com/tsenoner/protspace/commit/7119f8b76e7c0aa9e19c51e033f2b334937ebda7))

### Documentation

- **bundle**: Correct the v3 zero-copy, sourceType and score-spelling claims
  ([`bc01fb3`](https://github.com/tsenoner/protspace/commit/bc01fb36d53453f1f0662061521381735ce60d85))

- **bundle**: Document the six-part v3 container and its physical schema
  ([`6db1ec7`](https://github.com/tsenoner/protspace/commit/6db1ec70e0eaecbc2e9e81ece9cee645306e2563))

### Features

- **bundle**: Add parquetbundle v3 encoder
  ([`847c55f`](https://github.com/tsenoner/protspace/commit/847c55f47f5cd1d817be8b7f299a63c03116380c))

- **bundle**: Add the parquetbundle v3 decoder
  ([`d665f33`](https://github.com/tsenoner/protspace/commit/d665f33a49fc711523d758e79eef2afad9b5ce8d))

- **bundle**: Emit v3 containers and decode them back at every read
  ([`4569a69`](https://github.com/tsenoner/protspace/commit/4569a691659d13f5dee0821a85b2d2a64b83ae54))

- **protspace**: Write shape size 10 as the per-annotation filler
  ([`298bb53`](https://github.com/tsenoner/protspace/commit/298bb538fb6a8d1b812356249c607e9bac9773e4))

### Performance Improvements

- **bundle**: Stop paying a v3 core decode for a settings read
  ([`0546d49`](https://github.com/tsenoner/protspace/commit/0546d4936fab1e683c1fba773a8d80feeebe4c4f))

### Testing

- **bundle**: Add the golden v3 fixture both languages read
  ([`b9c691f`](https://github.com/tsenoner/protspace/commit/b9c691fb3679fffb04b79a396e25c4dd0be65f80))

- **bundle**: Make the v3 golden fixture able to fail
  ([`eb237b1`](https://github.com/tsenoner/protspace/commit/eb237b14ce4dbce779a954f0c9c519616a413e13))


## v4.13.1 (2026-09-30)

### Bug Fixes

- **stats**: Drop the faithfulness ceiling that suppressed cheap results
  ([`02cb403`](https://github.com/tsenoner/protspace/commit/02cb403d0af4786d9be3fabe785416a2235ed962))

- **stats**: Reject faithfulness inputs whose rows do not align
  ([`a904336`](https://github.com/tsenoner/protspace/commit/a90433612eab8780787d89fb4c6ed9f4fa180937))


## v4.13.0 (2026-09-18)

### Bug Fixes

- **notebook**: Let the shared layer own the caches, and name each bundle
  ([`4fc7df7`](https://github.com/tsenoner/protspace/commit/4fc7df7219f2c8cf45966bdd96f06bdbf50e2f86))

- **protspace**: Apply the code review findings
  ([`7eef362`](https://github.com/tsenoner/protspace/commit/7eef362904a3313240188652cf05fe009102b042))

- **protspace**: Own cached projections, query FASTA and annotation rows by their data
  ([`c72f0fb`](https://github.com/tsenoner/protspace/commit/c72f0fba3e338c0488bf4b3a5e21acc6eeb89b91))

- **protspace**: Repair the cache-ownership work's own gaps
  ([`d6a16f3`](https://github.com/tsenoner/protspace/commit/d6a16f324a1ead8c759e3e443cc258378b7dad1e))

### Documentation

- Describe cache ownership as the code now decides it
  ([`07cedb8`](https://github.com/tsenoner/protspace/commit/07cedb80f662dc3dd5b1023c36a8e753102dac33))

- Record the embedding-identity tests and tick the change tasks
  ([`840a896`](https://github.com/tsenoner/protspace/commit/840a896b6c1b23a6e049e33cb3c2409b0e37fd83))

### Features

- **embed**: Stamp embedding identity into the HDF5
  ([`825e3a1`](https://github.com/tsenoner/protspace/commit/825e3a1b02ae04ec790c2f6ac6c424b060668fb4))

### Refactoring

- **io**: Publish every staged file through one helper
  ([`8985eff`](https://github.com/tsenoner/protspace/commit/8985eff22d79a64069ab0c96640a46b49355e454))

- **protspace**: Simplify the notebook cache-ownership changes
  ([`3eda58f`](https://github.com/tsenoner/protspace/commit/3eda58f3892b1603b4d0d8591e801d79ceed811f))


## v4.12.2 (2026-09-15)

### Bug Fixes

- **annotations**: Cache per source, so one unavailable API costs only its own columns
  ([`780ff26`](https://github.com/tsenoner/protspace/commit/780ff26ec08e32c825fad1c30e4775cfbff1a24c))

- **annotations**: Close the gaps the per-source cache design opened
  ([`f0f30c9`](https://github.com/tsenoner/protspace/commit/f0f30c98bb45252aae0072a6d59e88e7f4b25152))

- **annotations**: Never cache a UniProt fetch that lost batches
  ([`513cdaf`](https://github.com/tsenoner/protspace/commit/513cdaf5b6c8e014d6bbebb4316aaa32dc683230))

- **annotations**: Retry transient HTTP failures before treating them as data loss
  ([`063ed62`](https://github.com/tsenoner/protspace/commit/063ed62882c13dff927e45eb1b9a78a75e556437))


## v4.12.1 (2026-09-15)

### Bug Fixes

- **annotate**: Pass fasta sequences to annotation manager
  ([`5cab319`](https://github.com/tsenoner/protspace/commit/5cab3198d6ee059a65502879437b5d1bbc546c91))

- **annotations**: Enrich complete cache lengths from fasta
  ([`0e000cb`](https://github.com/tsenoner/protspace/commit/0e000cbf764cff159f2e7e62cffa4c3f9835f942))

- **annotations**: Handle fasta length edge cases
  ([`5826d8d`](https://github.com/tsenoner/protspace/commit/5826d8d9c9512af8660bec3ac2e853b52da995f6))

- **annotations**: Harden fasta length fallback and cut per-protein cost
  ([`eb66f22`](https://github.com/tsenoner/protspace/commit/eb66f22f6d341a8c0a378e5f162b757a9382f220))

- **notebook**: Isolate backends and publish fasta atomically
  ([`82b6dbb`](https://github.com/tsenoner/protspace/commit/82b6dbb25c93cf3eff1ed1234491ff4331985c92))

- **notebook**: Isolate retained caches by input
  ([`3c4b9f4`](https://github.com/tsenoner/protspace/commit/3c4b9f4cdc325c651fc6917f9e666653f7c75f5d))

- **notebook**: Recompute projections on every generate
  ([`7d80a0d`](https://github.com/tsenoner/protspace/commit/7d80a0d2a654ceea4e6c6b4b2a39ed18352b664b))

- **protspace**: Derive missing length from fasta
  ([`b02521f`](https://github.com/tsenoner/protspace/commit/b02521f6dff1af198eb9156d68b12b967aa83624))

- **protspace**: Preserve cache compatibility
  ([`5583733`](https://github.com/tsenoner/protspace/commit/55837338ca191db09bd497c3c69f8eff193503dd))

### Refactoring

- **query**: Drop dead short-write guard, narrow test patch
  ([`af4ffca`](https://github.com/tsenoner/protspace/commit/af4ffcaf8d807a2877228364c0dfceec0378602a))

### Testing

- **annotate**: Hoist UniProtRetriever import to module level
  ([`b584582`](https://github.com/tsenoner/protspace/commit/b5845824d737ad627a0d3cf87e93be16feb7df7e))


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
