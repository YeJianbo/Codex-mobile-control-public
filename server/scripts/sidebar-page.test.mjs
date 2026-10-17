import assert from 'node:assert/strict';
import {sidebarPage,sidebarPageQuery} from '../dist/services/sidebarPage.js';
const rows=Array.from({length:31},(_,id)=>({id}));
let page=sidebarPage(rows,10);
assert.deepEqual(page.rows.map(t=>t.id),Array.from({length:10},(_,i)=>i));
assert.equal(page.hasMore,true);
page=sidebarPage(rows,20);
assert.equal(page.rows.length,20);
assert.equal(page.hasMore,true);
assert.equal(sidebarPage(rows,40).hasMore,false);
// A selected old thread and a pinned thread survive every refresh without
// shrinking the requested number of recent entries.
page=sidebarPage(rows,10,row=>row.id===29||row.id===30);
assert.deepEqual(page.rows.map(t=>t.id),[0,1,2,3,4,5,6,7,8,9,29,30]);
const reordered=[rows[25],...rows.filter(t=>t.id!==25)];
assert.equal(sidebarPage(reordered,20).rows[0].id,25);
assert.equal(new Set(sidebarPage(reordered,20).rows).size,20);
assert.equal(sidebarPage(rows,5).rows.length,5);
assert.deepEqual(sidebarPage(rows,undefined).rows,rows);
for(const limit of ['0','-1','1.5','20001','bad'])assert.equal(sidebarPageQuery.safeParse({limit}).success,false);
assert.equal(sidebarPageQuery.parse({limit:'10',agent:'codex'}).limit,10);
console.log('Sidebar paging: first batch, expansion, selection, ordering and bounds passed');
