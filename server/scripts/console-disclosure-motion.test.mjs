import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Source-level guards only: these do not measure rendered frames or browser support.
const css = readFileSync(new URL('../public/console.css', import.meta.url), 'utf8');
const targets = ['.activity-block', '.tool-group', '.completed-process'];
const compact = value => value.replace(/\s+/g, '');

// Walk balanced CSS blocks so media/supports ancestry and later overrides are checked,
// rather than treating a matching snippet as proof of the effective browser cascade.
function styleRules(source, parents = []) {
  const rules = [];
  let start = 0, quote = '', comment = false, parentheses = 0, brackets = 0;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (comment) {
      if (char === '*' && source[index + 1] === '/') { comment = false; index++; }
      continue;
    }
    if (quote) {
      if (char === '\\') index++;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && source[index + 1] === '*') { comment = true; index++; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '(') parentheses++;
    if (char === ')') parentheses--;
    if (char === '[') brackets++;
    if (char === ']') brackets--;
    if (parentheses || brackets) continue;
    if (char === ';') { start = index + 1; continue; }
    if (char !== '{') continue;

    const prelude = source.slice(start, index).replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const bodyStart = index + 1;
    let depth = 1, bodyQuote = '', bodyComment = false;
    for (index++; index < source.length; index++) {
      const next = source[index];
      if (bodyComment) {
        if (next === '*' && source[index + 1] === '/') { bodyComment = false; index++; }
        continue;
      }
      if (bodyQuote) {
        if (next === '\\') index++;
        else if (next === bodyQuote) bodyQuote = '';
        continue;
      }
      if (next === '/' && source[index + 1] === '*') { bodyComment = true; index++; continue; }
      if (next === '"' || next === "'") { bodyQuote = next; continue; }
      if (next === '{') depth++;
      if (next === '}' && --depth === 0) break;
    }
    assert.equal(depth, 0, `Unclosed CSS block: ${prelude}`);
    const body = source.slice(bodyStart, index);
    if (prelude.startsWith('@')) rules.push(...styleRules(body, [...parents, compact(prelude)]));
    else {
      const declarations = [...body.matchAll(/(?:^|;)\s*([\w-]+)\s*:\s*([^;]+)/g)]
        .map(([, property, value]) => [property, compact(value)]);
      rules.push({ selectors: prelude.split(',').map(compact), parents, declarations });
    }
    start = index + 1;
  }
  return rules;
}

const rules = styleRules(css);
const disclosureRules = rules.filter(rule => rule.selectors.some(selector => selector.includes('::details-content')));
const reducedRules = disclosureRules.filter(rule => rule.parents.includes('@media(prefers-reduced-motion:reduce)'));
const motionRules = disclosureRules.filter(rule => !reducedRules.includes(rule));
const bySelectors = selectors => motionRules.find(rule => assertSameSet(rule.selectors, selectors));
function assertSameSet(actual, expected) {
  return actual.length === expected.length && expected.every(value => actual.includes(value));
}
const closed = bySelectors(targets.map(target => `${target}::details-content`));
const open = bySelectors(targets.map(target => `${target}[open]::details-content`));
const declaration = (rule, property) => rule.declarations.filter(([key]) => key === property).map(([, value]) => value);
function assertEnhancementGate(rule) {
  assert(rule, 'Expected targeted disclosure rule');
  assert.deepEqual(rule.parents, [
    '@media(prefers-reduced-motion:no-preference)',
    '@supports(interpolate-size:allow-keywords)and(transition-behavior:allow-discrete)andselector(details::details-content)',
  ]);
}

test('only one targeted disclosure enhancement remains, with no generic open override', () => {
  assert.equal(motionRules.length, 2);
  assert(closed);
  assert(open);
  assert.equal(disclosureRules.length, 3);
});

test('intrinsic-size motion is gated on normal motion and all required CSS features', () => {
  assertEnhancementGate(closed);
  assertEnhancementGate(open);
});

test('intrinsic interpolation is scoped to activity disclosures, not inherited from root', () => {
  const interpolation = rules.filter(rule => declaration(rule, 'interpolate-size').length);
  assert.equal(interpolation.length, 1);
  assert(assertSameSet(interpolation[0].selectors, targets));
  assert.deepEqual(declaration(interpolation[0], 'interpolate-size'), ['allow-keywords']);
  assertEnhancementGate(interpolation[0]);
});

test('opening and closing share the same logical size property without a height conflict', () => {
  assert.deepEqual(declaration(closed, 'block-size'), ['0']);
  assert.deepEqual(declaration(open, 'block-size'), ['auto']);
  for (const rule of disclosureRules) {
    const dimensions = rule.declarations.filter(([property]) => /^(?:min-|max-)?(?:height|width|inline-size|block-size)$/.test(property));
    assert(dimensions.every(([property]) => property === 'block-size'));
  }
});

test('both states stay clipped and retain the same reversible transition', () => {
  assert.deepEqual(declaration(closed, 'overflow'), ['clip']);
  assert.deepEqual(declaration(closed, 'transition'), [
    'block-sizevar(--motion-surface)var(--motion-out),content-visibilityvar(--motion-surface)allow-discrete',
  ]);
  // The base pseudo-element selector also matches [open]. Its transition and clip
  // must survive opening, instead of being reset by the open-state rule.
  assert.deepEqual(open.declarations, [['block-size', 'auto']]);
  assert(rules.some(rule => declaration(rule, '--motion-surface').includes('180ms')));
});

test('reduced motion retains immediate native details with an explicit transition opt-out', () => {
  assert.equal(reducedRules.length, 1);
  assert.deepEqual(declaration(reducedRules[0], 'transition'), ['none!important']);
  assert.deepEqual(declaration(reducedRules[0], 'animation'), ['none!important']);
  assert.deepEqual(declaration(reducedRules[0], 'block-size'), []);
  assert.deepEqual(declaration(reducedRules[0], 'overflow'), []);
});

test('the guards recognize the removed legacy cascade regression', () => {
  const legacy = '\n@media (prefers-reduced-motion: no-preference) { details[open]::details-content { block-size:auto; overflow:visible; transition:none; } }';
  const normal = styleRules(css + legacy).filter(rule => rule.selectors.some(selector => selector.includes('::details-content'))
    && !rule.parents.includes('@media(prefers-reduced-motion:reduce)'));
  assert.equal(normal.length, 3, 'A reintroduced generic override changes the guarded rule count');
  assert(normal.some(rule => rule.selectors.includes('details[open]::details-content')
    && declaration(rule, 'transition').includes('none')));
});
