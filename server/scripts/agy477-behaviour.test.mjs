// 0.6.477 AGY 行为定向检查：图片转本地文件、上下文窗口推导、收尾噪声、配额趋势。
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {agyContextWindow,agyTailRecovered,imageFilePrompt} from '../src/services/agentSessions.ts';
import {resolveImageFiles} from '../src/services/imageUploads.ts';
import {UsageReader} from '../src/services/usage.ts';

const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'agy477-'));
process.env.CODEX_MOBILE_CONTROL_HOME = home;
const uploads = path.join(home, 'uploads');
await fsp.mkdir(uploads, {recursive: true});
const imageId = '11111111-2222-3333-4444-555555555555.png';
await fsp.writeFile(path.join(uploads, imageId), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
await fsp.writeFile(path.join(uploads, imageId + '.json'), JSON.stringify({id: imageId, name: '相册.png'}));

const images = await resolveImageFiles([{id: imageId, name: '相册.png'}]);
assert.equal(images.length, 1);
assert.equal(images[0].name, '相册.png');
assert.equal(images[0].mime, 'image/png');
assert.equal(images[0].absolutePath, path.resolve(uploads, imageId));
const prompt = imageFilePrompt(images);
assert.ok(prompt.includes(images[0].absolutePath), 'prompt 必须带本地绝对路径');
assert.ok(prompt.includes('read_file'), 'prompt 必须提示可读取图片');
assert.equal(imageFilePrompt([]), '', '没有图片时不追加任何文字');
await assert.rejects(resolveImageFiles([{id: '../secret.png', name: 'x'}]), /无效的图片附件/);
await assert.rejects(resolveImageFiles([{id: '99999999-2222-3333-4444-555555555555.png', name: 'x'}]), /ENOENT|无效/);
console.log('ok image hand-off', images[0].absolutePath);

assert.equal(agyContextWindow('antigravity::gemini-3.8-flash'), 1_048_576);
assert.equal(agyContextWindow('antigravity::gemini-3.8-flash-high'), 1_048_576, '旧变体 id 也要识别');
assert.equal(agyContextWindow('antigravity::claude-sonnet-4-6'), 200_000);
assert.equal(agyContextWindow('antigravity::gpt-oss-120b-medium'), 131_072);
assert.equal(agyContextWindow('antigravity::fixture'), null, '未知模型不猜测窗口');
console.log('ok context windows');

const eof = 'API error (attempt 1): request failed: Post "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse": EOF';
assert.equal(agyTailRecovered(true, false, eof), true, '完整回答后的传输噪声算完成');
assert.equal(agyTailRecovered(false, false, eof), false, '没有正文时仍要报错');
assert.equal(agyTailRecovered(true, true, eof), false, '上游明确失败时不能吞掉');
assert.equal(agyTailRecovered(true, false, 'segmentation fault'), false, '非传输噪声不吞掉');
console.log('ok tail noise');

const usageReader = new UsageReader({request: async () => ({}), on() {}, off() {}});
usageReader.recordExternalQuota('antigravity:gemini-3.8-flash', [
  {name: 'Gemini Models', durationMins: 300, remainingPercent: 42},
  {name: 'Gemini Models', durationMins: 10080, remainingPercent: 78},
], Date.now());
const trend = usageReader.externalQuotaTrend('antigravity:gemini-3.8-flash', 7);
assert.equal(trend.length, 2, '两个窗口都要记录');
assert.deepEqual(trend.map((row) => row.durationMins).sort((a, b) => a - b), [300, 10080]);
assert.equal(usageReader.externalQuotaTrend('antigravity:other', 7).length, 0, '不同模型互不串扰');
usageReader.close();
console.log('ok quota trend samples', JSON.stringify(trend));

await fsp.rm(home, {recursive: true, force: true});
console.log('agy477 checks passed');
