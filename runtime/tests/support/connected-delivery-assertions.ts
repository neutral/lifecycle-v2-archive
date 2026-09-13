import assert from "node:assert/strict";
import { connectedPreparationMarkdown, type ConnectedDeliveryFixture } from "./connected-delivery-fixture.js";

export async function prepareAndAdmit(fixture: ConnectedDeliveryFixture, markdown = connectedPreparationMarkdown()): Promise<void> {
  const prepared = await fixture.prepare(markdown);
  assert.equal(prepared.outcome, "completed");
  assert(fixture.store.state().subjects.proposedBoundary !== null);
  await fixture.admit();
  assert(fixture.store.state().subjects.activeBoundary !== null);
  assert(fixture.store.state().subjects.candidate !== null);
}

export async function integrateAndEvaluate(fixture: ConnectedDeliveryFixture): Promise<void> {
  assert.equal((await fixture.integrate()).outcome, "constructed");
  const evaluated = await fixture.evaluate();
  assert.equal(evaluated.outcome, "completed");
  const ref = fixture.store.state().subjects.evidence;
  assert(ref !== null);
  const packet = fixture.store.getRevision(ref.id, ref.revision)!;
  assert.equal(packet.payload.readiness, "acceptance-ready", JSON.stringify(packet.payload));
  assert.equal(fixture.store.state().subjects.materialCondition, null);
  assert(fixture.store.state().eligibleOperations.includes("delivery.accept"));
}
