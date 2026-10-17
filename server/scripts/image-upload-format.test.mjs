import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import Fastify from 'fastify';
import {registerImageUploads} from '../dist/services/imageUploads.js';

test('mislabeled PNG uploads are stored and served with their actual MIME and draft owner',async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-image-format-'));
  const previous=process.env.CODEX_MOBILE_CONTROL_HOME;process.env.CODEX_MOBILE_CONTROL_HOME=home;
  const pins=[];
  const app=Fastify();registerImageUploads(app,{pin:(owner,image)=>pins.push({owner,image})});
  try{
    const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/5cAAAAASUVORK5CYII=','base64');
    const result=await app.inject({method:'POST',url:'/api/uploads/images',headers:{'x-upload-owner':'draft'},payload:{name:'相册.jpg',dataUrl:'data:image/jpeg;base64,'+bytes.toString('base64')}});
    assert.equal(result.statusCode,200);const image=result.json();assert(image.id.endsWith('.png'));assert.equal(image.name,'相册.jpg');
    assert.deepEqual(pins,[{owner:'draft',image:{kind:'image',id:image.id}}]);
    const download=await app.inject({method:'GET',url:'/api/uploads/images/'+image.id});
    assert.equal(download.headers['content-type'],'image/png');assert.equal(download.headers['x-content-type-options'],'nosniff');
    assert(download.rawPayload.equals(bytes));
  }finally{
    await app.close();if(previous===undefined)delete process.env.CODEX_MOBILE_CONTROL_HOME;else process.env.CODEX_MOBILE_CONTROL_HOME=previous;
    assert(path.resolve(home).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(home,{recursive:true,force:true});
  }
});

test('unsupported HEIC is identified rather than accepted as JPEG, and non-image bytes stay rejected',async()=>{
  const app=Fastify();registerImageUploads(app);
  app.setErrorHandler((error,request,reply)=>reply.code(400).send({error:error.message}));
  try{
    const heic=Buffer.from('000000186674797068656963000000006d69663168656963','hex');
    const result=await app.inject({method:'POST',url:'/api/uploads/images',payload:{dataUrl:'data:image/jpeg;base64,'+heic.toString('base64')}});
    assert.equal(result.statusCode,400);assert.match(result.json().error,/HEIC/);
    const invalid=await app.inject({method:'POST',url:'/api/uploads/images',payload:{dataUrl:'data:image/png;base64,'+Buffer.from('<html>bad</html>').toString('base64')}});
    assert.equal(invalid.statusCode,400);assert.match(invalid.json().error,/格式不符/);
  }finally{await app.close();}
});
