import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('external transcripts survive long streams, other threads, saves and restarts', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'agent-history-'));
  process.env.CODEX_MOBILE_CONTROL_HOME = home;
  const { StateStore } = await import('../dist/services/stateStore.js');
  const { selectConversationPage } = await import('../dist/services/codexSessions.js');
  let store = new StateStore();
  try {
    await store.load();
    for (const agent of ['antigravity', 'claude', 'grok']) {
      const threadId = `${agent}-test`;
      await store.appendEvent({type:'user.message', threadId, eventId:`${agent}-user`, text:'first question', createdAt:new Date().toISOString()});
      for (let i = 0; i < 1100; i++) {
        await store.appendEvent({type:'message.delta', threadId, eventId:`${agent}-${i}`, itemId:'answer-1', text:`${i},`, createdAt:new Date().toISOString()});
      }
      await store.appendEvent({type:'user.message', threadId, eventId:`${agent}-user-2`, text:'follow up', createdAt:new Date().toISOString()});
    }
    assert.equal(store.events.length, 1000, 'replay stays bounded');
    await store.createPairing(); // Generic state save must not wipe the transcript.
    store.close();
    store = new StateStore();
    await store.load();
    for (const agent of ['antigravity', 'claude', 'grok']) {
      const events = store.eventsForThread(`${agent}-test`);
      assert.equal(events.length, 1102, 'migration must not duplicate retained ring entries');
      assert.equal(events[0].text, 'first question');
      assert.equal(events.at(-1).text, 'follow up');
      const page = selectConversationPage(events, 200);
      assert.equal(page[0].type, 'user.message', 'a long stream must not start in the middle of an answer');
      assert.equal(page[0].text, 'first question');
      assert.equal(events.filter(e=>e.type==='message.delta').map(e=>e.text).join(''), Array.from({length:1100},(_,i)=>`${i},`).join(''));
    }
  } finally {
    store.close();
    await rm(home, {recursive:true, force:true});
  }
});

