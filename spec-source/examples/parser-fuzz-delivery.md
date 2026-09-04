# Parser fuzz-hardening Delivery

> Status: Non-normative worked example

## Purpose

This example shows how one product obligation moves from repository Knowledge to
an admitted Delivery, a role-specific Projection, a lower-cost builder attempt,
independent proof, and founder-authorized acceptance.

The example is explanatory. Stable identifiers and field names illustrate the
normative contracts but do not replace the JSON fixtures in this publication.

## Product situation

A repository contains a byte-stream parser used on untrusted uploaded data. The
parser has unit tests for known formats, but no fuzz harness. A prior incident
showed an unchecked length field could allocate excessive memory.

The founder objective is:

> Make the parser safe under arbitrary byte input and add the evidence required
> to prevent the same class of regression.

The objective is not yet a Work Boundary. It does not identify the relevant
product behavior, failure limits, implementation boundary, required harness,
proof modality, exclusions, or acceptance propositions.

## Atlas context selection

The complete valid normalized Atlas selects the smallest current semantic
context by exact Map and Point-record identity:

```text
atlas/atlas.md
  -> parser Map and explained Area membership
  -> exact upload-ingestion Point anchor or context record
  -> registered Resources for the Behavior, Assurance, Blueprint,
     Description, and Check Definition owners
```

Atlas does not become the owner of those records. The selected Content and
Reference edges preserve their Resource provenance, while the linked records
retain their own authority and stable identities.

## Knowledge records

### Behavior

```text
id: knowledge.behavior.parser.accept-uploaded-bytes
kind: behavior
revision: 3
statement:
  The upload ingestion path accepts an arbitrary byte sequence and returns
  either one bounded parsed result or one declared parse failure.
```

The Behavior owns the admitted functional outcome. It does not claim that the
parser can never crash or exhaust resources; those are Assurance obligations.

### Assurance

```text
id: knowledge.assurance.parser.arbitrary-bytes-safe
kind: assurance
revision: 2
statement:
  For every finite input up to the configured upload limit, parser execution
  does not panic, access memory unsafely, loop without the declared bound, or
  allocate beyond the configured parser resource budget.
falsifiers:
  - process crash or sanitizer finding
  - uncaught exception outside the declared parse-failure result
  - execution beyond the per-input time bound
  - allocation beyond the parser memory bound
```

The Assurance owns a nonfunctional obligation and explicit falsifiers. It is
not satisfied merely because ordinary example inputs still parse.

### Blueprint

```text
id: knowledge.blueprint.parser.entry-boundary
kind: blueprint
revision: 4
statement:
  Every external upload byte sequence enters parsing through Parser.parse.
  Format-specific readers remain internal and do not accept unvalidated
  offsets or lengths directly.
```

The Blueprint gives the harness a precise architectural target. A fuzz test that
calls a helper bypassing `Parser.parse` would not exercise the admitted external
boundary.

### Description

```text
id: knowledge.description.parser.core
kind: description
revision: 8
covers:
  - src/parser/index.ts
  - src/parser/reader.ts
  - src/parser/errors.ts
responsibility:
  Own the parser's byte-boundary validation, bounded reads, resource limits,
  and declared parse-failure behavior.
```

The Description is the primary code-adjacent owner for the governed
implementation units. It explains implementation responsibility but cannot
weaken the Assurance or redefine the Behavior.

### Check Definition

```text
id: knowledge.check.parser.fuzz-arbitrary-bytes
kind: check-definition
revision: 2
claim:
  The sealed parser candidate survives the configured arbitrary-byte campaign
  without any Assurance falsifier.
requiredEvidence:
  - one harness targeting Parser.parse
  - one reproducible corpus and seed policy
  - sanitizer or runtime failure detection appropriate to the language
  - bounded campaign receipt against the sealed candidate
limitations:
  A bounded campaign does not prove universal absence of parser defects. It
  establishes the exact observed campaign and guards known failure classes.
```

The Check Definition owns what must be falsifiable and what evidence means. It
is independent from the executable command selected by this repository.

## Relationships

The validated Knowledge graph contains, conceptually:

```text
behavior parser.accept-uploaded-bytes
  requires-assurance -> assurance parser.arbitrary-bytes-safe

behavior parser.accept-uploaded-bytes
  realized-by -> blueprint parser.entry-boundary

blueprint parser.entry-boundary
  described-by -> description parser.core

assurance parser.arbitrary-bytes-safe
  checked-by -> check parser.fuzz-arbitrary-bytes

description parser.core
  describes -> implementation src/parser/*
```

The `checked-by` relationship does not mean that a command has passed. It means
the Assurance requires the named Check Definition for the applicable profile.

## Check Binding

The target repository binds the Check Definition to one executable environment:

```text
binding id: check-binding.parser.fuzz.local-v1
check: knowledge.check.parser.fuzz-arbitrary-bytes@2
command:
  npm run fuzz:parser -- --time=60s --seed-corpus=tests/fuzz/corpus
capability:
  filesystem: sealed-candidate-read
  candidateMutation: forbidden
  network: none
timeout: 90s
environment:
  node: exact selected toolchain
  sanitizer: configured JavaScript runtime checks
```

Changing the command, timeout, corpus location, or environment can create a new
Binding revision. It does not silently change the Check Definition's claim.

## Reconnaissance Projection

The reconnaissance role receives:

- the founder objective;
- the relevant exact normalized Atlas Point-record and Resource provenance;
- the Behavior, Assurance, Blueprint, Description, and Check Definition;
- repository reality for the parser and existing tests;
- the registered Check Binding;
- current implementation ownership;
- known incident context when it is governed Knowledge; and
- conflicts, assumptions, or unresolved references.

It does not receive builder write capability. Its job is product judgment and
boundary preparation.

## Proposed Work Boundary

The resulting Work Boundary includes this meaning:

```text
selected result:
  Enforce bounded length and offset handling at Parser.parse and add a
  meaningful arbitrary-byte fuzz harness and campaign binding for the parser
  Assurance.

included behavior:
  - arbitrary finite byte sequences return a parsed result or declared failure
  - parser resource bounds apply before allocation and slice construction
  - fuzz harness targets the external Parser.parse boundary
  - current Description and Check-related repository knowledge are updated

excluded behavior:
  - redesign of the upload service
  - support for new file formats
  - production deployment
  - external fuzzing service integration
  - claims of mathematical proof or exhaustive input coverage

assumptions:
  - Parser.parse is the sole external byte entrypoint
  - the local runtime can enforce the declared campaign timeout

falsifiers:
  - another external parser entrypoint exists
  - required sanitizer capability is unavailable
  - satisfying the memory bound requires a product tradeoff not currently
    admitted

required artifacts:
  - src/parser/index.ts                    code, must change
  - src/parser/reader.ts                   code, may change
  - src/parser/_parser.desc.md             description, must change
  - tests/fuzz/parser-harness.ts           test, must change
  - tests/fuzz/corpus/*                    test, may change
  - records/assurance/parser-safety.md     assurance, may change
  - repository Check Binding carrier      documentation/config, must change

checks:
  - parser focused unit tests              regression guard
  - parser fuzz campaign                   postcondition
  - full repository tests                  regression guard

acceptance propositions:
  - every external byte sequence reaches validated bounded reads
  - declared parse failures remain the only ordinary invalid-input result
  - the harness targets Parser.parse and can reach length/offset handling
  - the exact registered fuzz campaign passes on the sealed candidate
  - no required artifact is missing
  - exclusions remain absent
  - Description coverage is current
```

The founder can inspect and refuse this boundary before productive work. The
builder cannot later replace the fuzz campaign with a few random unit examples
or broaden the result to a parser redesign.

## Builder Projection

The builder's mandatory core is concise:

```text
objective and selected result
explicit exclusions
assumptions and falsifiers
obligation ledger
required artifacts
exact Check identities and temporal modalities
material-condition return rules
```

Its supporting partition contains exact current revisions of the implicated
Behavior, Assurance, Blueprint, Description, Check Definition, relevant
incident context, and current parser implementation.

Its reachable index can expose adjacent parser design records and neighboring
implementation by exact identity. It does not ask the builder to rediscover the
mandatory chain from the whole repository.

## Agent Attempt

A lower-cost builder can receive an attempt conceptually equivalent to:

```text
role: builder
subject:
  active Work Boundary digest
  candidate base and current candidate digest
projection:
  exact builder Projection digest
capability:
  candidate and private tool-state writes
  repository toolchain subprocesses
  loopback only when the profile requires it
  no canonical Git, Control, founder secrets, publication, or deployment
investment:
  selected model
  reasoning effort
  15-minute initial wall-time allocation
result contract:
  completed proposal | correctable gap | material condition | no useful result
```

Model choice and timeout do not enter product authority. A stronger or cheaper
model can operate the same semantic and capability subject.

## First invocation outcome

Assume the cheaper model fixes the unchecked allocation and writes a harness,
but its 15-minute invocation ends before the fuzz campaign completes.

The candidate is retained. Provider events show activity but do not establish
progress. The agent's final output, if any, is a proposal.

The derived Attempt View reports authenticated facts such as:

```text
boundary coherent: yes
candidate preserved: yes
changed required artifacts:
  - src/parser/index.ts
  - tests/fuzz/parser-harness.ts
missing required artifacts:
  - src/parser/_parser.desc.md
checks:
  focused units: pass against current candidate
  fuzz campaign: not established
  full repository tests: not established
material condition: none authenticated
eligible action:
  continue same candidate and Work Boundary
```

This is enough for a strong outer investor to fund another bounded invocation
without treating elapsed time or diff size as completion.

## Half-done completion claim

Assume the next builder returns `completed` after running only the focused unit
tests. It says the fuzz harness is present and the full suite is probably
unnecessary.

Lifecycle does not accept that judgment.

- the required Description artifact is still absent;
- the registered fuzz postcondition has no passing receipt;
- the full regression guard has no passing final receipt; and
- required acceptance propositions cannot all be supported.

The Process remains correctable. The candidate survives. A cheaper model's
optimistic completion claim does not lower the gate.

## Meaningful-harness review

Assume the builder later adds the Description and all commands pass, but the
harness always truncates input to four bytes before calling `Parser.parse`.

The runtime can establish that the file exists and the command passed. The
independent reviewer still rejects the proposition that the harness can reach
the length and offset paths implicated by the Assurance.

This demonstrates the evidence separation:

```text
artifact exists             -> runtime observation
command passed               -> Check Receipt
campaign meaning and limits  -> Check Definition
harness is fit for claim     -> independent review
result becomes truth         -> founder acceptance and runtime transaction
```

A green command alone does not make a no-op harness acceptable.

## Material condition

During implementation, the builder may discover a second public parser entry
point used by streaming uploads. That fact falsifies the Blueprint and the Work
Boundary assumption.

The correct result is a Material Condition, not silent expansion:

```text
kind: mandate-falsifier
detail:
  StreamingParser.parseChunk is an external byte entrypoint not covered by the
  admitted boundary or current primary Description.
affected obligations:
  - behavior parser.accept-uploaded-bytes
  - assurance parser.arbitrary-bytes-safe
  - blueprint parser.entry-boundary
candidate treatment:
  preserve exact candidate
suggested action:
  revise the complete boundary or close no-ship
```

A strong model can assess whether to revise the boundary, split the work, or
terminate. Existing candidate work remains a proposal and can be conserved only
under an explicitly readmitted mandate.

## Final evidence

For a conforming candidate, the runtime seals one exact candidate tree and
runs the registered final Checks. The Evidence Packet binds, among other facts:

- Work Boundary and candidate identities;
- required-artifact inventory;
- Description coverage result;
- focused-unit, fuzz-campaign, and full-suite receipts;
- proof environment and Check Binding identities;
- independent decision for every acceptance proposition;
- unresolved uncertainty and evidence limitations; and
- the exact canonical transaction requested next.

The fuzz receipt states the bounded campaign it observed. It does not claim
universal proof. Independent review can accept the proposition with that
limitation because the Work Boundary required a bounded regression campaign,
not exhaustive verification.

## Acceptance

Founder acceptance authenticates the exact Evidence Packet and candidate
subject. The runtime revalidates canonical product state, active boundary,
Knowledge bases, candidate, evidence, lock, and transaction package before
moving canonical truth.

A changed candidate, Check Binding, Assurance revision, or canonical base
requires new evidence or authority as defined by the Process. Similarity is not
subject identity.

## Invalid shortcuts

The following do not satisfy this Delivery:

- telling the agent to "read all relevant specs" without compiling the
  mandatory Projection;
- placing the fuzz requirement only in an initial prompt;
- treating an existing fuzz script name as a Check Definition;
- letting the builder choose a weaker command after admission;
- counting changed paths or tool calls as progress;
- accepting the builder's `completed` disposition without final proof;
- letting proof mutate the harness until it passes;
- letting the reviewer edit the candidate it judges;
- inferring missing Description meaning from code at acceptance; or
- reusing founder authority after the candidate or Assurance subject changes.

## Result

The example demonstrates the intended division of labor:

```text
repository Knowledge defines what matters
Delivery admits one exact result
Projection makes required context hard to miss
Agent Attempt grants broad reversible labor, not truth
runtime establishes artifacts and Check receipts
fresh review judges claim fitness
founder authority permits one exact repository transition
```
