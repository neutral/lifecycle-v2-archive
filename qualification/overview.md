# Qualification

Qualification harnesses exercise installed and external boundaries for
Lifecycle Foundation rc.17. They run separately from default source builds
and checks, with their own disposable resources and explicit prerequisites.
The Foundation specification remains Draft.

- `installed/qualify.mjs` stages a private package, installs it in disposable
  support, and exercises CLI launcher transport against a qualification-owned
  fake Docker boundary. It does not operate an actual Runtime Image.
- `provider/qualify.mjs` exercises an external-provider course with retained
  recovery and cleanup observations. It requires separate disposable targets,
  private authentication, actual image selections, and authorization for
  provider execution.
- `support/atlas-fixture.mjs` supplies the pinned Atlas fixture used by these
  harnesses and bounded tests.

The installed harness uses the private `0.0.0-qualification` package identity.
It checks the single CLI bin, exact manifest bytes, argument and signal
forwarding, setup and doctor behavior, draft transport, and scoped invocation
cleanup. Its fake boundary cannot establish Docker containment or provider
behavior.

Read [verification](verification.md) for the distinction between bounded source
checks and operated harnesses. The [normative conformance contract](../spec-source/spec/CONFORMANCE.md)
defines evidence requirements. Harness source alone establishes no
qualification or conformance result.
