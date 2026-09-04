export const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

export function distributionSelectionFixture(): Record<string, unknown> {
  return {
    images: {
      execution: {
        agentAdapterImplementationDigest: digest("1"),
        codexVersion: "0.151.0",
        imageId: "lifecycle.execution-image.codex-standard.v1",
        indexDigest: digest("2"),
        nonRootUser: "65532:65532",
        platforms: [
          {
            architecture: "amd64",
            codexExecutableDigest: digest("3"),
            configurationDigest: digest("4"),
            manifestDigest: digest("5"),
            os: "linux",
            toolInventoryDigest: digest("6"),
            variant: null,
          },
          {
            architecture: "arm64",
            codexExecutableDigest: digest("7"),
            configurationDigest: digest("8"),
            manifestDigest: digest("9"),
            os: "linux",
            toolInventoryDigest: digest("a"),
            variant: null,
          },
        ],
        runnerContractDigest: digest("b"),
        runnerContractId: "lifecycle.execution-cell-runner.v1",
        runnerImplementationDigest: digest("1"),
      },
      runtime: {
        indexDigest: digest("c"),
        platforms: [
          {
            architecture: "amd64",
            configurationDigest: digest("d"),
            manifestDigest: digest("e"),
            os: "linux",
            variant: null,
          },
          {
            architecture: "arm64",
            configurationDigest: digest("f"),
            manifestDigest: digest("0"),
            os: "linux",
            variant: null,
          },
        ],
      },
    },
    schema: "lifecycle.distribution-build-selection.private.v1",
    sourceRevision: "1".repeat(40),
  };
}
