import assert from "node:assert/strict";
import test from "node:test";
import { parseStrictJson } from "../../src/foundation/validation/strict-json.js";

test("strict JSON enforces structural resource bounds during parsing", () => {
  assert.throws(
    () => parseStrictJson("[".repeat(64) + "null" + "]".repeat(64), { maximumDepth: 16 }),
    /exceeds depth 16/u,
  );
  assert.throws(
    () => parseStrictJson('{"a":[true,false,null]}', { maximumNodes: 4 }),
    /exceeds 4 nodes/u,
  );
  assert.throws(
    () => parseStrictJson('{"a":1,"b":2}', { maximumObjectProperties: 1 }),
    /exceeds 1 properties/u,
  );
  assert.throws(
    () => parseStrictJson("[1,2]", { maximumArrayItems: 1 }),
    /exceeds 1 items/u,
  );
  assert.throws(
    () => parseStrictJson("null", { maximumDepth: 0 }),
    /maximumDepth must be one positive safe integer/u,
  );
  assert.deepEqual(
    parseStrictJson('{"__proto__":{"polluted":true}}'),
    JSON.parse('{"__proto__":{"polluted":true}}') as unknown,
  );
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});
