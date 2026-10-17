import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

// Deterministic logic/DOM-geometry model, not browser layout, animation appearance,
// native scroll physics, or CSS support QA. All scroll/render/handler bodies are
// extracted from the shipped source. Core block grouping is the real implementation.
// Override a source under test with CMC_CONSOLE_SOURCE=/absolute/path/console.js;
// CMC_CONSOLE_CORE optionally selects its matching console-core.js.
const defaultSource = fileURLToPath(new URL('../public/console.js', import.meta.url));
const sourcePath = path.resolve(process.env.CMC_CONSOLE_SOURCE || defaultSource);
const source = readFileSync(sourcePath, 'utf8').replaceAll('\r\n', '\n');
const core = await import(pathToFileURL(path.resolve(process.env.CMC_CONSOLE_CORE || path.join(path.dirname(defaultSource), 'console-core.js'))));
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, `Missing shipped source section: ${start}`);
  return source.slice(from, to);
}
const scrollCode = section('let conversationCache =', 'async function showUsage()');
const handlerCode = section('$("conversationScroll").onscroll =', '$("threadGoal").onclick');
const historyCode = section('function sameConversationEvents(', 'const slashCommands=');
const threadKeyCode = section('function conversationThreadKey(', 'async function refreshThreads()');

function rng(seed) {
  let value = seed >>> 0;
  return () => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return (value >>> 0) / 0x100000000; };
}
function fixture(seed = 1, { reduced = false, height = 420 } = {}) {
  const random = rng(seed), elements = new Map(), frames = new Map(), observers = [];
  let now = 100, frameId = 0, nativeTarget = null, nextResponse = null;
  const scrollCalls = [], writes = [];
  class Node {
    constructor(tag = 'div', className = '', text = '') {
      this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.parentElement = null;
      this.hidden = false; this.open = false; this.disabled = false; this.attributes = {}; this.listeners = new Map();
      this.textContent = text || ''; this.value = ''; this.extraHeight = 0;
      this.classes = new Set((className || '').split(/\s+/).filter(Boolean));
      this.classList = {
        add: (...names) => names.forEach(name => this.classes.add(name)),
        remove: (...names) => names.forEach(name => this.classes.delete(name)),
        contains: name => this.classes.has(name),
        toggle: (name, force) => {
          const on = force === undefined ? !this.classes.has(name) : Boolean(force);
          if (on) this.classes.add(name); else this.classes.delete(name); return on;
        },
      };
    }
    get childNodes() { return this.children; }
    get lastElementChild() { return this.children.at(-1); }
    append(...nodes) { nodes.forEach(node => this.insertBefore(node, null)); }
    insertBefore(node, reference) {
      if (node === reference) return node;
      node.remove(); const index = reference === null ? this.children.length : this.children.indexOf(reference);
      assert(index >= 0, 'Geometry model insertBefore target must be a child');
      this.children.splice(index, 0, node); node.parentElement = this; return node;
    }
    remove() {
      if (this.parentElement) {
        const siblings = this.parentElement.children, index = siblings.indexOf(this);
        if (index >= 0) siblings.splice(index, 1); this.parentElement = null;
      }
    }
    replaceChildren(...nodes) { [...this.children].forEach(node => node.remove()); this.append(...nodes); }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    addEventListener(name, fn) {
      const handlers = this.listeners.get(name) || []; handlers.push(fn); this.listeners.set(name, handlers);
    }
    fire(name, event = {}) { for (const fn of this.listeners.get(name) || []) fn(event); }
    matches(selector) {
      return selector === 'details[data-activity-key]' ? this.tagName === 'DETAILS' && this.dataset.activityKey !== undefined
        : selector === 'summary' ? this.tagName === 'SUMMARY'
        : selector.startsWith('.') ? this.classes.has(selector.slice(1)) : this.tagName.toLowerCase() === selector;
    }
    querySelectorAll(selector) {
      const found = []; const visit = node => node.children.forEach(child => { if (child.matches(selector)) found.push(child); visit(child); });
      visit(this); return found;
    }
    querySelector(selector) {
      if (selector === '.markdown > :last-child, .markdown') return this.querySelectorAll('.markdown').at(-1) || null;
      return this.querySelectorAll(selector)[0] || null;
    }
    closest(selector) {
      for (let node = this; node; node = node.parentElement) if (selector.split(',').some(part => node.matches(part.trim()))) return node;
      return null;
    }
    measuredHeight() {
      if (this.classes.has('stream-cursor')) return 0;
      if (this.tagName === 'DETAILS' && !this.open) return 34 + this.extraHeight;
      if (this.id === 'events') return this.children.reduce((sum, node) => sum + node.measuredHeight(), 0);
      const own = this.textContent ? 16 + Math.ceil(String(this.textContent).length / 36) * 16 : 8;
      return own + this.children.reduce((sum, node) => sum + node.measuredHeight(), 0) + this.extraHeight;
    }
    contentTop() {
      if (!this.parentElement || this.parentElement.id !== 'events') return 0;
      let top = 0; for (const node of this.parentElement.children) { if (node === this) break; top += node.measuredHeight(); } return top;
    }
    getBoundingClientRect() {
      if (this.id === 'conversationScroll') return { top: 100, bottom: 100 + scroll.clientHeight, right: 520 };
      const top = 100 + this.contentTop() - scroll.scrollTop;
      return { top, bottom: top + this.measuredHeight(), right: 520 };
    }
  }
  const $ = name => {
    if (!elements.has(name)) { const node = new Node(); node.id = name; elements.set(name, node); }
    return elements.get(name);
  };
  const scroll = $('conversationScroll'), host = $('events'); let position = 0;
  scroll.clientHeight = height;
  Object.defineProperties(scroll, {
    scrollHeight: { get: () => Math.max(scroll.clientHeight, host.measuredHeight()) },
    scrollTop: {
      get: () => Math.min(position, Math.max(0, scroll.scrollHeight - scroll.clientHeight)),
      set: value => { position = Math.max(0, Math.min(Number(value), scroll.scrollHeight - scroll.clientHeight)); writes.push(position); },
    },
  });
  scroll.scrollTo = options => {
    scrollCalls.push({ ...options });
    // Abstract a fixed target resolved when motion starts; this is not native scroll-physics QA.
    if (options.behavior === 'smooth') nativeTarget = Math.max(0,Math.min(options.top,scroll.scrollHeight-scroll.clientHeight));
    else { nativeTarget = null; scroll.scrollTop = options.top; }
  };
  const state = {
    threadId: 'first', chatProject: 'p', harness: 'codex', showWarnings: false,
    events: new Map(), historyMore: new Map(), historyLoading: new Set(), historyCount: new Map(), hydrating: new Map(),
    threads: [{ id: 'first', title: 'First', status: 'running' }, { id: 'second', title: 'Second', status: 'running' }],
    projects: [{ id: 'p', name: 'Fixture' }], pending: null, approvals: [], writerLocked: new Set(), models: [],
  };
  const context = {
    state, $, ...core, console, menuAnchor: null,
    iconNode: () => new Node('svg'),
    performance: { now: () => now }, matchMedia: () => ({ matches: reduced }),
    requestAnimationFrame: fn => { frames.set(++frameId, fn); return frameId; }, cancelAnimationFrame: id => frames.delete(id),
    ResizeObserver: class { constructor(fn) { observers.push(fn); } observe() {} },
    document: { querySelector: () => $('composerWrap') },
    activeThread: () => state.threads.find(thread => thread.id === state.threadId),
    isRunning: () => state.threads.find(thread => thread.id === state.threadId)?.status === 'running',
    el: (tag, classes, text) => new Node(tag, classes, text),
    markdownNode: text => new Node('div', 'markdown', text), diffCode: text => new Node('pre', '', text),
    button: (text, fn, classes) => { const node = new Node('button', classes, text); node.onclick = fn; return node; },
    messageActions: () => new Node('div'), imageGallery: () => new Node('div'), fileCards: () => new Node('div'),
    updateContext() {}, updateControls() {}, refreshQueue: async () => {},
    run: fn => fn(), api: async () => { assert(nextResponse, 'Unexpected fixture API request'); return nextResponse; },
    desktopModelSettings: new Map(), fillChatEfforts() {}, safeWrite() {},
  };
  vm.createContext(context);
  vm.runInContext(threadKeyCode + historyCode + scrollCode + handlerCode, context, { filename: sourcePath });
  const evaluate = code => vm.runInContext(code, context);
  const render = options => evaluate(`renderConversation(${JSON.stringify(options || {})})`);
  const dispatch = (name, event = {}) => scroll.fire(name, { target: scroll, ...event });
  const step = (elapsed = 16) => {
    now += elapsed; const callbacks = [...frames]; frames.clear(); for (const [, fn] of callbacks) fn(now);
  };
  const drain = () => {
    for (let ticks = 0; frames.size && ticks < 240; ticks++) step(16);
    assert.equal(frames.size, 0, `seed ${seed}: follow scheduling did not converge in 240 ticks`);
  };
  const resize = () => observers.forEach(fn => fn());
  const read = () => evaluate('({followConversation,jumpScrolling,jumpScrollingUntil,userScrollUntil,readingAnchor,followFrame,cache:[...conversationCache]})');
  const visibleAnchor = () => host.children.find(node => node.getBoundingClientRect().bottom > 100);
  const event = (type, id, text = '', extra = {}) => ({ threadId: state.threadId, turnId: 'turn', type, eventId: id, itemId: id, text, ...extra });
  const initial = () => {
    const events = [event('user.message', 'user', 'Review fixture')];
    for (let index = 0; index < 8; index++) events.push(event('message.delta', `old-${index}`, 'past '.repeat(30 + Math.floor(random() * 15))));
    events.push(event('turn.started', 'start'), event('message.delta', 'comment', 'Working '.repeat(24)), event('tool.started', 'tool', '', { title: 'exec' }), event('message.delta', 'answer', 'Answer '.repeat(20)));
    state.events.set(state.threadId, events); state.historyMore.set(state.threadId, false); render({ followLatest: true }); drain(); return events;
  };
  return {
    seed, state, scroll, host, frames, scrollCalls, writes, read, evaluate, render, dispatch, step, drain, resize, event, initial, visibleAnchor,
    setReduced: value => { reduced = value; },
    setNow: value => { now = value; }, now: () => now, getNativeTarget: () => nativeTarget,
    setResponse: value => { nextResponse = value; },
    scrollEvent: () => scroll.onscroll(),
    nativeStep: () => { if (nativeTarget !== null) { scroll.scrollTop = nativeTarget; nativeTarget = null; scroll.onscroll(); } },
  };
}

function anchorSnapshot(f) {
  const node = f.visibleAnchor(); assert(node, 'Expected a visible modeled message');
  return { key: node.dataset.messageKey, offset: node.getBoundingClientRect().top - 100, node };
}
function assertAnchor(f, before, label) {
  const node = f.host.children.find(node => node.dataset.messageKey === before.key);
  assert(node, `${label}: reading key disappeared`);
  assert(Math.abs(node.getBoundingClientRect().top - 100 - before.offset) < 1e-7, `${label}: reading anchor offset moved`);
}

for (const seed of [1, 7, 42, 126, 20260930]) {
  test(`seed ${seed}: stream → review → resize → completed folding → End → jump interrupt → switch`, () => {
    const f = fixture(seed), events = f.initial();
    const user = f.host.children[0];
    for (let index = 0; index < 6; index++) {
      events.push(f.event('message.delta', `delta-${index}`, 'stream '.repeat(2 + index), { itemId: 'answer' }));
      f.render(); assert(f.frames.size <= 1, 'Repeated deltas must share the pending follow callback'); f.step();
      assert.equal(f.host.children[0], user, 'Unchanged earlier message should retain its node');
    }
    f.dispatch('keydown', { key: 'PageUp' });
    f.scroll.scrollTop -= 350; f.scrollEvent();
    const anchor = anchorSnapshot(f); assert.equal(f.read().followConversation, false); assert.equal(f.frames.size, 0);
    f.host.children[0].extraHeight += 90 + seed % 25; f.resize(); assertAnchor(f, anchor, 'resize');
    events.push(f.event('tool.completed', 'tool-end', '', { itemId: 'tool' }), f.event('turn.completed', 'done', '', { status: 'completed' }));
    f.state.threads[0].status = 'idle'; f.render();
    const process = f.host.children.find(node => node.classes.has('completed-process'));
    assert(process && !process.open, 'A newly completed process defaults to folded during review too');
    assert.equal(f.frames.size, 0);
    f.dispatch('keydown', { key: 'End' }); f.scroll.scrollTop = f.scroll.scrollHeight; f.scrollEvent();
    assert.equal(f.read().followConversation, true); f.render(); f.drain();
    assert(f.host.children.some(node => node.classes.has('completed-process')), 'Rejoining should allow completed process folding');
    f.dispatch('keydown', { key: 'PageUp' }); f.scroll.scrollTop -= 300; f.scrollEvent();
    f.evaluate("$('jumpLatest').onclick()"); assert.equal(f.read().jumpScrolling, true);
    f.dispatch('wheel', { deltaY: -10 }); assert.equal(f.read().jumpScrolling, false); assert.equal(f.read().followConversation, false);
    assert.equal(f.getNativeTarget(), null, 'Upward wheel must cancel the modeled native smooth operation');
    const second = [f.event('user.message', 'second-user', 'second conversation')].map(event => ({ ...event, threadId: 'second' }));
    f.state.events.set('second', second); f.state.threadId = 'second'; f.render({ followLatest: true }); f.drain();
    assert.equal(f.read().followConversation, true); assert.equal(f.read().jumpScrolling, false); assert.equal(f.read().userScrollUntil, 0);
    assert.equal(f.read().readingAnchor, null); assert.equal(f.frames.size, 0);
    assert([...f.read().cache].every(([key]) => key.startsWith('second:')), 'Switch must remove unrelated cached messages');
  });
}

test('seeded follow property: changing targets converge, repeated restore does not multiply frames', () => {
  for (const seed of [9, 31, 103]) {
    const f = fixture(seed), random = rng(seed); f.initial();
    for (let step = 0; step < 80; step++) {
      f.host.lastElementChild.extraHeight += Math.floor(random() * 31);
      f.resize(); f.resize(); f.evaluate('followLatestPosition()');
      assert(f.frames.size <= 1, `seed ${seed}, step ${step}: duplicate follow callback`);
      const previous = f.scroll.scrollTop; f.step(1 + Math.floor(random() * 130));
      assert(f.scroll.scrollTop >= previous, `seed ${seed}, step ${step}: follow moved backwards for a growing target`);
      assert(f.scroll.scrollTop <= f.scroll.scrollHeight - f.scroll.clientHeight);
    }
    f.drain(); assert(Math.abs(f.scroll.scrollHeight - f.scroll.clientHeight - f.scroll.scrollTop) < 1);
  }
});

test('seeded review property: repeated prepends and resizes preserve the same key and offset', () => {
  for (const seed of [13, 39, 127]) {
    const f = fixture(seed), random = rng(seed), events = f.initial();
    f.dispatch('keydown', { key: 'PageUp' }); f.scroll.scrollTop -= 410; f.scrollEvent();
    const anchor = anchorSnapshot(f), unchanged = f.host.children[4];
    for (let step = 0; step < 20; step++) {
      if (step % 2) f.host.children[0].extraHeight += Math.floor(random() * 91);
      else {
        events.unshift(f.event('user.message', `prepended-${step}`, 'history '.repeat(2 + Math.floor(random() * 40))));
        f.render();
      }
      f.resize(); assertAnchor(f, anchor, `seed ${seed}, step ${step}`);
      assert.equal(f.read().followConversation, false); assert.equal(f.frames.size, 0);
      assert(f.host.children.includes(unchanged), 'Review should keep unchanged cached nodes mounted');
    }
  }
});

test('loadOlder preserves anchor after the actual async history prepend and releases loading controls', async () => {
  const f = fixture(57), events = f.initial(); f.state.historyMore.set('first', true);
  f.dispatch('keydown', { key: 'PageUp' }); f.scroll.scrollTop -= 510; f.scrollEvent();
  const anchor = anchorSnapshot(f);
  f.setResponse({ events: [f.event('user.message', 'earlier', 'older '.repeat(60)), ...events], status: 'running', hasMore: false });
  await f.evaluate('loadOlderMessages()');
  assertAnchor(f, anchor, 'loadOlder'); assert.equal(f.read().followConversation, false); assert.equal(f.frames.size, 0);
  assert.equal(f.state.historyLoading.size, 0); assert.equal(f.evaluate("$('loadOlder').disabled"), false);
  assert.equal(f.evaluate("$('loadOlder').hidden"), true);
});

test('wheel, touch, and scrollbar review ignore horizontal intent and preserve a paused anchor after the input window expires', () => {
  for (const input of ['wheel', 'touch', 'scrollbar']) {
    const f = fixture(91); f.initial();
    f.dispatch('touchstart', { touches: [{ clientX: 100, clientY: 100 }] });
    f.dispatch('touchmove', { touches: [{ clientX: 150, clientY: 105 }] }); assert.equal(f.read().followConversation, true);
    if (input === 'wheel') f.dispatch('wheel', { deltaY: -10 });
    else if (input === 'touch') f.dispatch('touchmove', { touches: [{ clientX: 100, clientY: 125 }] });
    else f.dispatch('pointerdown', { clientX: 515 });
    f.scroll.scrollTop -= 200; f.scrollEvent(); const anchor = anchorSnapshot(f);
    assert.equal(f.read().followConversation, false); assert(f.read().userScrollUntil > f.now());
    f.setNow(f.read().userScrollUntil + 20); f.host.children[0].extraHeight += 150; f.resize(); f.scrollEvent();
    assert.equal(f.read().followConversation, false); assertAnchor(f, anchor, input);
  }
});

test('reduced-motion changes cancel an existing follow frame and keep later resize/delta writes immediate', () => {
  const f = fixture(33), events = f.initial();
  events.push(f.event('message.delta', 'grow', 'stream '.repeat(10), { itemId: 'answer' })); f.render(); assert.equal(f.frames.size, 1);
  f.setReduced(true); f.resize(); assert.equal(f.frames.size, 0);
  assert.equal(f.scroll.scrollTop, f.scroll.scrollHeight - f.scroll.clientHeight);
  f.dispatch('keydown', { key: 'PageUp' }); f.scroll.scrollTop -= 200; f.scrollEvent(); f.evaluate("$('jumpLatest').onclick()");
  assert.equal(f.frames.size,0);assert.equal(f.getNativeTarget(),null);assert.equal(f.scroll.scrollTop,f.scroll.scrollHeight-f.scroll.clientHeight);f.scrollEvent();assert.equal(f.read().jumpScrolling,false);
  f.host.lastElementChild.extraHeight += 80; f.resize(); assert.equal(f.frames.size, 0);
  assert.equal(f.scroll.scrollTop, f.scroll.scrollHeight - f.scroll.clientHeight);
});

// These are intended behavior assertions, not tests that bless current bugs.
// They should fail on the pre-fix source and pass when the parent patches it.
test('End/ArrowDown/PageDown at an already-bottom position do not silently detach streaming follow', () => {
  for (const key of ['End', 'ArrowDown', 'PageDown', ' ']) {
    const f = fixture(12), events = f.initial();
    f.dispatch('keydown', { key }); // Native no-op at the boundary emits no scroll event.
    f.step();
    events.push(f.event('message.delta', 'after-key', 'continued '.repeat(20), { itemId: 'answer' })); f.render(); f.drain();
    assert.equal(f.read().followConversation, true, `${JSON.stringify(key)} at bottom must retain follow`);
    assert.equal(f.scroll.scrollTop, f.scroll.scrollHeight - f.scroll.clientHeight);
  }
});

test('downward wheel/touch input cancels any active jump before later streaming renders restore the reader', () => {
  for (const input of ['wheel', 'touch']) {
    const f = fixture(61), events = f.initial();
    f.dispatch('keydown', { key: 'PageUp' }); f.scroll.scrollTop -= 600; f.scrollEvent(); f.evaluate("$('jumpLatest').onclick()");
    assert.equal(f.read().jumpScrolling, true);
    assert(f.frames.size > 0 || f.getNativeTarget() !== null, 'Jump should own an active operation until settling');
    if (input === 'wheel') f.dispatch('wheel', { deltaY: 10 });
    else { f.dispatch('touchstart', { touches: [{ clientX: 100, clientY: 150 }] }); f.dispatch('touchmove', { touches: [{ clientX: 100, clientY: 125 }] }); }
    assert.equal(f.getNativeTarget(), null, `${input} must cancel any started native smooth operation`);
    assert.equal(f.frames.size, 0, `${input} must cancel any application-owned follow callback`);
    assert.equal(f.read().jumpScrolling, false);
    f.scroll.scrollTop += 30; f.scrollEvent(); const anchor = anchorSnapshot(f);
    events.push(f.event('message.delta', 'while-reading', 'continued '.repeat(15), { itemId: 'answer' })); f.render(); f.resize();
    assert.equal(f.read().followConversation, false); assertAnchor(f, anchor, input);
  }
});


test('stream growth during jump settles at the moving latest target without depending on another scroll event', () => {
  for (const seed of [3, 27, 125]) {
    const f = fixture(seed), events = f.initial();
    f.dispatch('keydown', { key: 'PageUp' }); f.scroll.scrollTop -= 650; f.scrollEvent();
    f.evaluate("$('jumpLatest').onclick()"); assert.equal(f.read().jumpScrolling, true);
    const oldTarget = f.scroll.scrollHeight - f.scroll.clientHeight;
    events.push(f.event('message.delta', 'during-jump', 'new streaming content '.repeat(30), { itemId: 'answer' })); f.render();
    assert(f.scroll.scrollHeight - f.scroll.clientHeight > oldTarget + 8, 'Streaming must move the latest target materially');
    // Finish any native fixed-target operation, then let application callbacks run.
    // No fabricated final scroll event is dispatched to make an expired flag clear.
    f.nativeStep(); f.drain(); f.setNow(f.now() + 3000); f.resize(); f.drain();
    assert.equal(f.read().jumpScrolling, false, `seed ${seed}: jump intent remained stuck after its target moved`);
    assert.equal(f.read().followConversation, true);
    assert(Math.abs(f.scroll.scrollHeight - f.scroll.clientHeight - f.scroll.scrollTop) < 1, `seed ${seed}: streaming latest never reached`);
  }
});
