import assert from "node:assert/strict";
import test from "node:test";
import { deliveryOperationDescriptor, deliveryOperationDescriptors } from "../../src/foundation/process/operation-registry.js";

test("operation metadata separates Delivery exclusion from the short canonical publication lock", () => {
  const operations = deliveryOperationDescriptors();
  assert.deepEqual(operations.filter(({canonicalPublication}) => canonicalPublication === "short-target-lock").map(({operation}) => operation),["delivery.accept"]);
  for (const descriptor of operations.filter(({operation}) => !["delivery.prepare","delivery.recover"].includes(operation))) {
    assert.equal(descriptor.concurrency,"process-exclusive",descriptor.operation);
  }
  assert.equal(deliveryOperationDescriptor("delivery.admit").canonicalPublication,"none");
  assert.equal(deliveryOperationDescriptor("delivery.no-ship").canonicalPublication,"none");
  assert.equal(deliveryOperationDescriptor("delivery.prepare").concurrency,"fresh-delivery");
  assert.equal(deliveryOperationDescriptor("delivery.recover").concurrency,"exact-recovery");
  assert.equal(deliveryOperationDescriptor("delivery.recover").canonicalPublication,"retained-operation");
});
