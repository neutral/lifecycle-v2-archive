import type { Sha256 } from "../validation/canonical.js";

export type FoundationAtlasProcessorFile = Readonly<{
  path: string;
  mode: "000644" | "000755";
  byteLength: number;
  sha256: Sha256;
}>;

/** Exact installed distribution selected from upstream Atlas validator 0.7.0. */
export const FOUNDATION_ATLAS_PROCESSOR_FILES: readonly FoundationAtlasProcessorFile[] = Object.freeze([
  { path: "README.md", mode: "000644", byteLength: 1242, sha256: "sha256:6d9829f454c37977a6e211969cbd1e6416a427071b5161b2ef9170a516720d19" },
  { path: "bin/atlas-validate.mjs", mode: "000755", byteLength: 202, sha256: "sha256:0b8ed84f71bc2a373fbb71f11a282fd0de07fcd859bea60cf45c4577e3cdf614" },
  { path: "package.json", mode: "000644", byteLength: 600, sha256: "sha256:04d1c8ae97d5ca4e0a541e67a53cf912b627fc6d88bafd9f3452174d79dfe50e" },
  { path: "schemas/atlas.schema.json", mode: "000644", byteLength: 1655, sha256: "sha256:bd54a3bdb3f5f0fc3d7476ca862580a9a7bd43792b25e7880643b6a63b293196" },
  { path: "schemas/check-evaluation.schema.json", mode: "000644", byteLength: 5542, sha256: "sha256:9f28a4086fa29892900a55346200583312749002a6a6c25070da31896cf3b2cb" },
  { path: "schemas/check.schema.json", mode: "000644", byteLength: 1167, sha256: "sha256:56e47e8104cf815ac3e8e0822b81cddd382cc3508fb405ec487f06d010412254" },
  { path: "schemas/common.schema.json", mode: "000644", byteLength: 6977, sha256: "sha256:933003a2442b66f8f3e3c405e4b9ba40a7ec60642eea0f4af31beb15bc37ae28" },
  { path: "schemas/fixture-manifest.schema.json", mode: "000644", byteLength: 1453, sha256: "sha256:c1a13e2114b62a4a7fffc4415c7fc968a9df8ff7ff06bc97cc31550d766c99c6" },
  { path: "schemas/frontmatter.schema.json", mode: "000644", byteLength: 398, sha256: "sha256:c1a0e96c139024111ce210a86c165635f1513a8ae32341a6988ab11d0fd1a40b" },
  { path: "schemas/map.schema.json", mode: "000644", byteLength: 1125, sha256: "sha256:617f4a13ae1d6b4f6d0cda834c5a1b0b95ef7ee2ddb8bcc7deec247b5a99b941" },
  { path: "schemas/normalized.schema.json", mode: "000644", byteLength: 11076, sha256: "sha256:3f41d30bfda796cfd90e8f61a51ef5a028b6b038077dd506df2d596021fc4e9c" },
  { path: "schemas/point.schema.json", mode: "000644", byteLength: 4099, sha256: "sha256:bc64f7017f98b8ec6eeb1711fbfeab169093a6f9be35fdb71b09e4bf7a001145" },
  { path: "schemas/publication.schema.json", mode: "000644", byteLength: 1673, sha256: "sha256:a1f01ee979c66da69248fcb0911bb15f59fb0963564df42fe4ab5cc585097dd6" },
  { path: "schemas/validation-result.schema.json", mode: "000644", byteLength: 3089, sha256: "sha256:dea1ef7cca3e61dd29d7f14b174e007c9f27563a483a8dee5be43ce4e545b59e" },
  { path: "src/cli.mjs", mode: "000644", byteLength: 2437, sha256: "sha256:cfb9dd80dfda5b9d806ec02a33fb183906b82b78d711b4ef37c793daff01c9f3" },
  { path: "src/constants.mjs", mode: "000644", byteLength: 717, sha256: "sha256:8382da802cbd362c19ca8e996019c2e36b882fbd2d8e1ae5a2f4918f5cb0f3e6" },
  { path: "src/discovery.mjs", mode: "000644", byteLength: 7001, sha256: "sha256:5c09708d7c23313ede9abb07e2470e07bdacc1440035b576acbd0bf5e8ae8613" },
  { path: "src/fixtures.mjs", mode: "000644", byteLength: 1115, sha256: "sha256:2eb33b47318789cb44cadccc036f52cc6701af70a99e8d8f225313f5c3b81b26" },
  { path: "src/frontmatter.mjs", mode: "000644", byteLength: 2618, sha256: "sha256:a7d5f5ad988f91c8a439d698abbf2df1a4f5ee288672c24a0e504127e7c95131" },
  { path: "src/index.mjs", mode: "000644", byteLength: 369, sha256: "sha256:4c5220c11e7ed6f80e704d82fcb2b81379b709e8f31885ef8b8dc8cc406e1fcd" },
  { path: "src/markdown.mjs", mode: "000644", byteLength: 2114, sha256: "sha256:9fc7d55705b422bdb26af9c4f209a0bb9c370206471669fccbd4dfe1d87a19c3" },
  { path: "src/model.mjs", mode: "000644", byteLength: 1652, sha256: "sha256:fd038c2ef91022427bbcbc31b16bbb2d40616f64e4b8bb2a5427c07b8bd7a4f4" },
  { path: "src/normalize.mjs", mode: "000644", byteLength: 4156, sha256: "sha256:12876f2b4d63c5bed10105af088961f63a32ae00448b85d24321569e49c0c58f" },
  { path: "src/resolved.mjs", mode: "000644", byteLength: 12713, sha256: "sha256:802daa5bb2d4a0538b60d11ae8991983277ea72b18cf91360d8c4d95d245298f" },
  { path: "src/schemas.mjs", mode: "000644", byteLength: 1948, sha256: "sha256:cc9ac9c1314050591aab49a52e926768e87520071916c7ce9e0b13f824d93590" },
  { path: "src/structure.mjs", mode: "000644", byteLength: 12121, sha256: "sha256:3bf14b49c663d9712950078911e110e302a575b7e7a624ae78406d9a1c9705ba" },
  { path: "src/util.mjs", mode: "000644", byteLength: 3574, sha256: "sha256:f6ccac6ed558531aca89acc7027fb29906318908ab9babf532171e90f81edada" },
  { path: "src/validator.mjs", mode: "000644", byteLength: 1900, sha256: "sha256:797ac38d33fe3cae52765d748b95ad7c6e0f57739d7135125004cf7e17ef6284" },
]);
