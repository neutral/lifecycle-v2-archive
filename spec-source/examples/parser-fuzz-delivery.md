# Parser fuzz-hardening Delivery

> Status: Non-normative worked example

## Purpose and assumptions

This example follows one bounded parser repair from governing Knowledge through
retained Candidate work, explicit integration, independent Evidence, and
conditional publication. It also follows a timed-out Attempt, an inadequate
harness, and canonical movement through their productive continuations.

The subjects and outcomes are hypothetical. The sketches explain relationships;
they are not complete Lifecycle Documents, executable fixtures, or qualification
evidence. [Knowledge](../spec/KNOWLEDGE.md),
[Delivery](../spec/DELIVERY.md), [Attempts](../spec/ATTEMPTS.md), and
[Evidence](../spec/EVIDENCE.md) own the contracts used here.

Assume a valid initialized target with complete current Knowledge, Description
coverage, the selected Atlas, and registered Check Bindings and profiles. The
existing repository configuration already binds the unit, fuzz, and repository
Checks to their exact mechanisms. Creating the fuzz harness is permitted
Candidate work; changing the Repository Contract or its Binding registry is
not part of this Delivery. The selected capability and context profiles can
support the work described below.

## From an objective to an assessable result

The repository parses untrusted uploaded bytes. Ordinary unit tests cover known
formats, but an incident showed that an unchecked length field can cause
excessive allocation. The Director supplies this objective:

> Repair the parser's length and offset handling and add a reproducible bounded
> fuzz campaign that can expose regressions in those paths.

That direction is not yet a Work Boundary. Reconnaissance must connect it to
current meaning, identify the result's limits, and propose the complete
obligations and comparison basis the Director will admit.

The current Knowledge has separate responsibilities:

| Record | Meaning it owns |
| --- | --- |
| `behavior.parser.accept-uploaded-bytes`, revision 3 | Inputs within the upload limit return either a bounded parsed result or a declared parse failure. |
| `assurance.parser.arbitrary-bytes-safe`, revision 2 | Parsing respects memory and execution limits and avoids crashes, unsafe access, and undeclared exceptions. |
| `blueprint.parser.entry-boundary`, revision 4 | External upload bytes enter through `Parser.parse`; internal readers do not accept unchecked lengths or offsets. |
| `description.parser.core`, revision 8 | The parser unit's responsibility, bounds, failure behavior, and exact implementation coverage. |
| `check.parser.fuzz-arbitrary-bytes`, revision 2 | A selected bounded campaign can expose the declared parser falsifiers under its recorded conditions. |

Behavior states what callers receive. Assurance states qualities and limits
that ordinary successful examples do not establish. Blueprint identifies the
architectural entrypoint. Description connects those meanings to implementation
paths. The Check Definition states the proposition its mechanism can support,
including that a finite campaign cannot establish universal defect absence.

The graph stores current standard relationships in their declared directions:

```text
assurance.parser.arbitrary-bytes-safe
  constrains -> behavior.parser.accept-uploaded-bytes

blueprint.parser.entry-boundary
  realizes -> behavior.parser.accept-uploaded-bytes

description.parser.core
  realizes -> blueprint.parser.entry-boundary

assurance.parser.arbitrary-bytes-safe
  verified-by -> check.parser.fuzz-arbitrary-bytes

behavior.parser.accept-uploaded-bytes
  verified-by -> check.parser.focused-units
```

The Description's coverage fields separately name exact files such as
`src/parser/index.ts`, `src/parser/reader.ts`, and `src/parser/errors.ts`.
Coverage is not a Knowledge edge or a wildcard assertion. Selecting the Behavior
can require the incoming Assurance and relevant realizations; an inverse index
helps traverse those authored edges without creating new ones.

The valid Atlas supplies project orientation and registered Resources through
exact normalized Map, Point, and Resource identities. It routes to these owners
without becoming their authority. The Registry can also expose an adopted
JavaScript testing Discipline through a Work Type. Reconnaissance may select
that guidance, but Work Type membership neither selects every record nor adds
an acceptance obligation.

## Proposal, baseline, and admission

The Orientation Projection exposes exact current records, Bindings, profiles,
implementation ownership, source provenance, and bounded retrieval. The
reconnaissance Agent receives no Candidate write capability. Its valid semantic
submission proposes a result; Runtime parsing and compilation supply exact
identities, references, ordering, and digests.

Call the resulting Work Boundary W1 and its governing Snapshot B. W1 is the
complete envelope, not just the following mandate summary:

- Repair bounded length and offset handling at `Parser.parse`.
- Add a harness that reaches the affected paths and a reproducible seed corpus.
- Update the parser Description with the implemented responsibility and limits.
- Preserve declared parse failures and existing supported formats.
- Exclude upload-service redesign, new formats, deployment, external fuzzing
  services, and claims of exhaustive or mathematical verification.

The required artifact set names exact paths, including
`src/parser/index.ts`, `src/parser/_parser.desc.md`,
`tests/fuzz/parser-harness.ts`, and `tests/fuzz/corpus/length-overflow.bin`.
The complete Boundary also binds each artifact's role and disposition,
obligations, risks, effects, selected Knowledge and advisory guidance,
acceptance propositions, exact profiles, and repository basis.

The Check selections have different temporal jobs:

| Check | Modality | Baseline | Final evaluation |
| --- | --- | --- | --- |
| Focused parser units | Regression guard | Pass | Pass against the exact Seal |
| Fuzz campaign | Postcondition | Declared `not-run` | Pass with the required campaign facts |
| Repository suite | Regression guard | Pass | Pass against the exact Seal |

The registered fuzz mechanism might run
`npm run fuzz:parser -- --time=60s --seed-corpus=tests/fuzz/corpus` under its
exact selected environment and timeout. The command is the mechanism; the
Check Definition owns the proposition and limitations. Changing the command
would change a bound input, not silently change what an earlier Receipt means.

Runtime finalizes W1 before baseline execution so every baseline Receipt can
name that exact revision. Proposal readiness requires the complete
modality-valid set, not an indiscriminate all-pass rule. The postcondition's
baseline `not-run` does not claim the missing harness already works.

The Director inspects the complete proposal and authenticates admission of W1.
The observed applied admission makes those same Boundary bytes active. Runtime
then retains the initialization Candidate Revision C1 and its reconstructible
Carrier. If admission is interrupted between those durable boundaries, recovery
finishes that initialization; it does not invent a Candidate or admit a copy of
W1.

## A timed-out Attempt can still advance the Candidate

A builder receives W1's exact Execution Projection, current Candidate, selected
capability, and fresh Investment. Its Cell contains an isolated repository on
the Delivery's stable work branch. Canonical Git administration and Runtime
custody are outside its inputs. The provider may inspect, edit, run permitted
local commands, and revise its body-only semantic submission during the Attempt.

Assume the first builder repairs the allocation check and writes a preliminary
harness, but reaches its time limit before submitting valid semantics. Runtime
contains the Cell and retrieves its exact bounded output. In this example the
Product tree is complete and valid, including current Description coverage,
although the required Description content change is still unfinished.

The outcomes are separate:

| Question | Retained conclusion in this example |
| --- | --- |
| How did provider execution end? | Timeout. |
| Was a valid Agent Work Product submitted? | No. |
| Can Product output advance the Candidate? | Yes: complete valid bytes are published in a Carrier before C2 is selected. |
| Can the Attempt Activity finish? | Yes, once output dispositions, Containment, and Runtime-owned Retirement are final. |

C2 therefore survives the unsuccessful invocation. Its exact Carrier, not the
old Cell or provider session, supplies the next Attempt. The Attempt View can
show that advancement and the still-unmet obligations. A unit command the
builder happened to run is not a final Check Receipt, and provider activity is
not Evidence of readiness.

A later builder can update the Description incrementally. A complete contiguous
Draft successor above its Current revision can be retained between Attempts
without governing the Candidate Knowledge Set. Promotion changes the prior
Current status and successor predecessor bindings coherently under the
[Knowledge revision rules](../spec/KNOWLEDGE.md#revision-and-supersession).
Review then receives both admitted and Candidate occurrences. It does not
confuse the old and new revisions or resolve them by choosing the larger number.

## Integration establishes the result to evaluate

Once Candidate work is ready for assessment, `delivery.integrate` selects one
exact current canonical parent P and constructs I in a disposable isolated
repository. The operation receives the expected read generation; the caller
supplies no parent, merge strategy, Agent semantics, or Investment.

W1's governing Snapshot B, the application parent P, and result I are different
subjects. Canonical work can have advanced since B without invalidating the
retained Candidate. Integration assesses whether W1's governing selections
still apply and validates the proposed P-to-I contribution, including protected
Atlas and Discipline bytes.

If construction conflicts with a concurrent parser edit, the current Candidate
remains selected. A correction Attempt receives exact attempted-parent conflict
context read-only, changes its Candidate under W1, and integrates again. Those
parent bytes help resolve the conflict; they do not become governing Knowledge
or grant broader capability.

Assume the successful construction preserves governing applicability. Runtime
retains the Integration Assessment and its exact successor Candidate. Evaluation
can now seal that result, run the required final Checks, and compile an
independent read-only reviewer Projection.

## A green campaign can still leave inadequate support

Suppose the preliminary harness truncates every input to four bytes before
calling `Parser.parse`. The harness file exists and the registered campaign
returns a passing outcome, but it cannot reach the length and offset paths
that motivated the repair.

Runtime observation establishes the artifact and its exact bytes. The Check
Receipt establishes the bounded execution outcome against the Seal. The
reviewer judges whether those facts support each admitted proposition and
rejects the harness-fitness proposition with exact citations. Evidence
assessment derives the unsatisfied obligation; a successful evaluation Activity
does not turn the inadequate support into acceptance readiness.

This gap is correctable under W1. Another funded builder fixes the harness and
retains its successor. Integration provenance is reestablished when required,
then fresh sealing, final Checks, and review concern the exact revised result.
A passing Receipt for the prior Seal cannot be silently relabeled as a Check of
the new one.

The final Packet can support the admitted bounded campaign and architectural
repair while retaining the Check's finite-coverage limitation. It does not
claim universal parser safety merely because the original Assurance expresses
a broader product obligation.

## When the mandate or context needs a response

A different finding can require a Material Condition. Suppose an exact retained
builder proposal identifies a second public entrypoint outside the selected
Blueprint and W1's stated assumption. Runtime validates that proposal's source
and Candidate joins before freezing the Condition. Productive continuation
pauses; the Agent cannot expand W1 itself.

Revision reconnaissance receives the frozen Candidate read-only, exact
Condition, active Boundary, and fresh Director rationale. A complete revised
proposal can include the newly required work, receive fresh modality-valid
baselines, and become active only through authenticated readmission. Candidate
identity and bytes remain available throughout. Reaffirmation instead requires
complete unchanged mandate semantics and an explicit rationale; it is not a
shortcut that suppresses the finding.

Mandatory-context failure has its own source. If complete required context
exceeds the selected profile, the compiler's conclusive measurement can produce
the exact Condition without dispatching an Agent with truncated inputs. When a
larger registered profile is explicitly permitted, resolution can select it
and carry that choice through readmission into successful continuation. Reusing
the inadequate default or merely displaying an eligible resolution operation
would not demonstrate that the promised route works.

## Conditional acceptance and interrupted settlement

For a supported result, the Packet binds the exact Boundary, Candidate, Seal,
Integration Assessment, Check and reviewer subjects, applicability judgments,
obligation ledgers, uncertainty, and selected Evidence rules. Packet retention
and historical verification recompute support from its exact inputs. They do
not authenticate the Director or establish fresh physical repository bytes.

The Director separately authenticates acceptance of that exact result over P.
The transaction retains its exact plan and intent, independently reopens and
observes the physical subject, requires Evidence verification, and conditionally
publishes only while canonical still names P. Acceptance performs no merge.

If canonical advances to P2 first, the old result and Packet remain historical
facts. The attempted effect is conclusively not applied and settles its failed
Activity and support disposition. Delivery then integrates against a newly
selected parent, resolves governing changes and readmits when needed, evaluates
the exact result, and obtains a new Director Decision. The old Decision never
authorizes a retry over P2.

If the successful publication return is lost instead, recovery reconciles the
retained exact effect. It can recognize the accepted commit after later forward
canonical movement when its required identity and ancestry facts are available.
An indeterminate observation remains exact recovery work; absence of a return
value is not proof of non-application.

Applied acceptance records exact Candidate treatment and Closure after required
Containment and Retirement. Store sealing and archive disposition can then
finish, including after restart, without reopening the terminal Delivery or
adding an event after Closure. Physical Reclamation may finish later under its
private owner.

No-ship is another deliberate Director choice when eligible. It truthfully
terminates the Delivery without publishing Candidate bytes. It is not evidence
that the productive repair course above succeeded.
