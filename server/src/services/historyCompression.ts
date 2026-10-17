import type {FastifyInstance} from 'fastify';
import compress from '@fastify/compress';
import {constants} from 'node:zlib';

// Keep small control responses cheap; large histories use the async stream path.
export const historyCompression={threshold:16*1024,syncThreshold:0,encodings:['gzip' as const],zlibOptions:{level:constants.Z_BEST_SPEED}};
export async function registerHistoryCompression(app:FastifyInstance):Promise<void>{
  await app.register(compress,{global:false,globalDecompression:false});
}
