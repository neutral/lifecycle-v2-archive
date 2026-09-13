import type { Sha256 } from "../validation/canonical.js";

export type FoundationAtlasProcessorFile = Readonly<{
  path: string;
  mode: "000644" | "000755";
  byteLength: number;
  sha256: Sha256;
}>;

/** Exact installed distribution selected from upstream Atlas validator 0.8.0. */
export const FOUNDATION_ATLAS_PROCESSOR_FILES: readonly FoundationAtlasProcessorFile[] = Object.freeze([
  { path: "README.md", mode: "000644", byteLength: 1539, sha256: "sha256:deb105169ff2d60e9876a279322d05b5ea8d55a41352b65fe5cd8784c5c4fd53" },
  { path: "bin/atlas-validate.mjs", mode: "000755", byteLength: 202, sha256: "sha256:0b8ed84f71bc2a373fbb71f11a282fd0de07fcd859bea60cf45c4577e3cdf614" },
  { path: "package.json", mode: "000644", byteLength: 579, sha256: "sha256:3e391a86d400e894dcc81438d16c8ba94fb36cef4ba5209591f26be210366b6a" },
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
  { path: "src/cli.mjs", mode: "000644", byteLength: 2437, sha256: "sha256:72c6d4f853bec75431c36eef38c54ebbab9637fadec2c00ac24cfba86490527b" },
  { path: "src/constants.mjs", mode: "000644", byteLength: 717, sha256: "sha256:8382da802cbd362c19ca8e996019c2e36b882fbd2d8e1ae5a2f4918f5cb0f3e6" },
  { path: "src/discovery.mjs", mode: "000644", byteLength: 7001, sha256: "sha256:5c09708d7c23313ede9abb07e2470e07bdacc1440035b576acbd0bf5e8ae8613" },
  { path: "src/fixtures.mjs", mode: "000644", byteLength: 1115, sha256: "sha256:f83b78b7b310fe098acd76e0bcfab745c64dfd30d953f98932d522d50b87af87" },
  { path: "src/frontmatter.mjs", mode: "000644", byteLength: 3045, sha256: "sha256:a4d79f4969d887a38ce32b780aa2851fbd62837d9a65d18642121d7fa4a82f39" },
  { path: "src/index.mjs", mode: "000644", byteLength: 369, sha256: "sha256:4c5220c11e7ed6f80e704d82fcb2b81379b709e8f31885ef8b8dc8cc406e1fcd" },
  { path: "src/markdown.mjs", mode: "000644", byteLength: 2145, sha256: "sha256:597bc1b14709d5d5387044023f32ac0d91eb07f36a44346b172a1e22e29b4ba4" },
  { path: "src/model.mjs", mode: "000644", byteLength: 1651, sha256: "sha256:8d8ea468833f72860ab295243dcb54a260b27c0fa0dacb40aac80a6c6738a673" },
  { path: "src/normalize.mjs", mode: "000644", byteLength: 4156, sha256: "sha256:12876f2b4d63c5bed10105af088961f63a32ae00448b85d24321569e49c0c58f" },
  { path: "src/resolved.mjs", mode: "000644", byteLength: 12713, sha256: "sha256:802daa5bb2d4a0538b60d11ae8991983277ea72b18cf91360d8c4d95d245298f" },
  { path: "src/schemas.mjs", mode: "000644", byteLength: 1948, sha256: "sha256:cc9ac9c1314050591aab49a52e926768e87520071916c7ce9e0b13f824d93590" },
  { path: "src/structure.mjs", mode: "000644", byteLength: 12134, sha256: "sha256:46cf0d635ece2842eebcc4ca002706db9d03632f98f124df5b60b09b2a8a7725" },
  { path: "src/util.mjs", mode: "000644", byteLength: 3574, sha256: "sha256:f6ccac6ed558531aca89acc7027fb29906318908ab9babf532171e90f81edada" },
  { path: "src/validator.mjs", mode: "000644", byteLength: 1900, sha256: "sha256:136b57339352ceb079b7ddfa1c915e7d2abc91d16cbf47276f217446c74ba3d8" },
]);
