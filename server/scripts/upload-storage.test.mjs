import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import Fastify from 'fastify';

test('manual upload cleanup preserves drafts, queues, active work and paths outside its root',async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-upload-storage-'));
  const previous=process.env.CODEX_MOBILE_CONTROL_HOME;process.env.CODEX_MOBILE_CONTROL_HOME=home;
  const {StateStore}=await import('../dist/services/stateStore.js');
  const {UploadStorage}=await import('../dist/services/uploadStorage.js');
  const {registerImageUploads}=await import('../dist/services/imageUploads.js');
  let store=new StateStore();await store.load();let blocked='';
  let storage=new UploadStorage(store,async()=>blocked);const root=path.join(home,'uploads');await fs.mkdir(path.join(root,'files'),{recursive:true});
  const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
  const image=n=>({kind:'image',id:id(n)+'.png'}),file=n=>({kind:'file',id:id(n)});
  const app=Fastify();storage.register(app);registerImageUploads(app,storage);
  try{
    for(const n of [1,2,3,4])await fs.writeFile(path.join(root,image(n).id),Buffer.alloc(n));
    const folder=path.join(root,'files',file(5).id);await fs.mkdir(folder);await fs.writeFile(path.join(folder,'content'),'content');await fs.writeFile(path.join(folder,'meta.json'),JSON.stringify({id:file(5).id,name:'资料.txt',size:7,mime:'text/plain'}));
    await fs.writeFile(path.join(root,'keep-unknown.txt'),'keep');
    const put=await app.inject({method:'PUT',url:'/api/uploads/drafts',payload:{owner:'fixture-owner',items:[image(2)]}});assert.equal(put.statusCode,200);
    store.writeFollowup('queued',{status:'queued',images:[{id:image(3).id}],files:[]});
    store.writeFollowup('editing',{status:'editing',images:[],files:[{id:file(5).id}]});
    const uploaded=await app.inject({method:'POST',url:'/api/uploads/images',headers:{'x-upload-owner':'fixture-owner'},payload:{name:'草稿图.png',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/5cAAAAASUVORK5CYII='}});
    assert.equal(uploaded.statusCode,200);const newImage={kind:'image',id:uploaded.json().id};
    const listing=(await app.inject({method:'GET',url:'/api/uploads/storage'})).json();
    assert.equal(listing.items.length,6);assert.equal(listing.items.find(row=>row.id===newImage.id).name,'草稿图.png');assert(listing.items.find(row=>row.id===newImage.id).protectedReason);
    blocked='正在运行';let result=await storage.cleanup([image(1)]);assert.equal(result.deletedCount,0);assert.equal(result.skipped[0].reason,blocked);blocked='';
    const invalid=await app.inject({method:'POST',url:'/api/uploads/cleanup',payload:{items:[image(1),{kind:'file',id:'../../outside'}]}});assert.equal(invalid.statusCode,500);assert(await fs.stat(path.join(root,image(1).id)));
    result=(await app.inject({method:'POST',url:'/api/uploads/cleanup',payload:{items:[image(1),image(2),image(3),file(5),newImage]}})).json();
    assert.equal(result.deletedCount,1);assert.equal(result.deletedBytes,1);assert.equal(result.skipped.length,4);assert.equal(result.failed.length,0);
    assert.equal(await fs.readFile(path.join(root,'keep-unknown.txt'),'utf8'),'keep');assert(await fs.stat(path.join(root,image(4).id)));assert(await fs.stat(path.join(folder,'content')));
    store.close();store=new StateStore();await store.load();storage=new UploadStorage(store,async()=>blocked);assert((await storage.list()).items.find(row=>row.id===image(2).id).protectedReason);
    store.setUploadDrafts('fixture-owner',[]);store.removeFollowup('editing');result=await storage.cleanup([image(2),file(5)]);assert.equal(result.deletedCount,2);assert(result.deletedBytes>7);assert.equal(result.failed.length,0);
    const outside=path.join(home,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'content'),'outside');await fs.writeFile(path.join(outside,'meta.json'),JSON.stringify({id:file(6).id}));
    await fs.symlink(outside,path.join(root,'files',file(6).id),'junction');result=await storage.cleanup([file(6)]);assert.equal(result.deletedCount,0);assert.equal(await fs.readFile(path.join(outside,'content'),'utf8'),'outside');
    console.log(JSON.stringify({selectedOnly:true,draftsPersist:true,uploadPinned:true,queueEditingProtected:true,busyBlocked:true,outsidePathPreserved:true}));
  }finally{await app.close();store.close();if(previous===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previous;await fs.rm(home,{recursive:true,force:true});}
});
