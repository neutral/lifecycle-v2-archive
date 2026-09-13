import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const guidePath = path.join(root, 'spec-source/OPERATING.md');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const guide = read('spec-source/OPERATING.md');

// These checks protect documentation size and discoverability, not agent quality.
test('operating guide stays within its explicit prompt-size budget', t => {
  const words = guide.trim().split(/\s+/u).length;
  const bytes = Buffer.byteLength(guide, 'utf8');
  t.diagnostic(`Operating guide: ${words} whitespace-delimited words; ${bytes} UTF-8 bytes. Not a tokenizer count.`);
  assert.ok(words <= 380, `Operating guide has ${words} words; budget is 380.`);
  assert.ok(bytes <= 2600, `Operating guide has ${bytes} bytes; budget is 2600.`);
});

test('conceptual and operating entry documents stay smaller together', t => {
  const bytes = Buffer.byteLength(read('spec-source/SPEC.md') + guide, 'utf8');
  t.diagnostic(`Conceptual spec plus operating guide: ${bytes} UTF-8 bytes; baseline conceptual spec alone: 11791.`);
  assert.ok(bytes <= 10000, `Combined entry documents have ${bytes} bytes; budget is 10000.`);
});

function localLinks(relative) {
  return [...read(relative).matchAll(/\[[^\]\n]+\]\(([^)\s]+)\)/gu)].map(match => {
    const href = match[1];
    assert.ok(!/^(?:[a-z][a-z0-9+.-]*:|\/)/iu.test(href), `Expected local reference in ${relative}: ${href}`);
    const target = path.resolve(root, path.dirname(relative), decodeURIComponent(href.split('#')[0]));
    const offset = path.relative(root, target);
    assert.ok(offset !== '..' && !offset.startsWith(`..${path.sep}`) && !path.isAbsolute(offset), href);
    assert.ok(fs.statSync(target).isFile(), `Missing file reference: ${relative} -> ${href}`);
    return target;
  });
}

test('operating references resolve to their existing owners', () => {
  assert.deepEqual(localLinks('spec-source/OPERATING.md').sort(), [
    'spec-source/SPEC.md', 'spec-source/spec/FORMAT.md', 'spec-source/spec/CHECKS.md',
  ].map(relative => path.join(root, relative)).sort());
});

test('human and agent entrypoints share one operating guide', () => {
  for (const relative of ['AGENTS.md', 'CONTRIBUTING.md', 'spec-source/README.md']) {
    assert.ok(read(relative).includes(relative === 'spec-source/README.md' ? '(OPERATING.md)' : '(spec-source/OPERATING.md)'), relative);
  }
  assert.ok(fs.statSync(guidePath).isFile());
});

test('behavioral review cases link to the rules instead of replacing them', () => {
  const targets = localLinks('evidence/agent-cases.md');
  assert.ok(targets.includes(guidePath));
  assert.ok(targets.includes(path.join(root, 'spec-source/SPEC.md')));
});
