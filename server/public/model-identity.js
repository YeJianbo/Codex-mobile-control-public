const harnessNames = {
  codex: 'Codex', claude: 'Claude Code', antigravity: 'Antigravity', grok: 'Grok Build',
  deepseek: 'DeepSeek Harness', hermes: 'Hermes', opencode: 'OpenCode', zcode: 'ZCode',
};
const ownBrands = {codex:'gpt', claude:'claude', antigravity:'gemini', grok:'grok', deepseek:'deepseek', hermes:'hermes'};
const brandPrefix = /^(gpt|claude|gemini|grok|deepseek|qwen)(?=[-\s]|\d|[vr]\d)/i;
const familyPrefix = /^(opus|sonnet|haiku|hermes|llama|kimi|glm|mistral)(?=[-\s]|\d|$)/i;
const words = /\b(gpt|claude|gemini|grok|deepseek|qwen|astra|sol|luna|codex|spark|pro|mini|nano|turbo|opus|sonnet|haiku|flash|next|thinking|chat|coder|free|preview|instruct|hermes|llama|kimi|mistral)\b/gi;
const wordLabels = {gpt:'GPT',deepseek:'DeepSeek'};

export function modelHarness(model = '') {
  if (typeof model === 'object') {
    if (Object.hasOwn(harnessNames, model.harness)) return model.harness;
    model = model.model || '';
  }
  const prefix = model.split('::')[0];
  return Object.hasOwn(harnessNames, prefix) ? prefix : 'codex';
}

export function compactModelName(label, harness = '') {
  let name = label.trim();
  const namespace = name.split('::')[0];
  if (name.includes('::') && Object.hasOwn(harnessNames, namespace)) name = name.slice(namespace.length + 2);
  const branded = brandPrefix.exec(name);
  if (!branded && !familyPrefix.test(name)) return name;
  if (branded && branded[1].toLowerCase() === ownBrands[harness]) name = name.slice(branded[0].length).replace(/^[-\s]+/, '');
  return name.replaceAll('-', ' ').replace(/\s+/g, ' ').replace(words, word => wordLabels[word.toLowerCase()] || word[0].toUpperCase() + word.slice(1).toLowerCase()).replace(/(?<=\S)\[/g, ' [');
}

export function modelDisplayName(model) {
  const harness = modelHarness(model), raw = model.model || '';
  const rawName = raw.includes('::') ? raw.slice(raw.indexOf('::') + 2) : raw;
  let label = model.shortName || model.displayName || rawName;
  const title = `${harnessNames[harness]} · `;
  if (label.startsWith(title)) label = label.slice(title.length);
  const providerId = model.providerId || (harness === 'opencode' ? rawName.split('/')[0] : '');
  for (const provider of new Set([model.providerName, providerId].filter(Boolean))) {
    for (const separator of [' / ', '/', ': ', ' · ']) {
      const prefix = provider + separator;
      if (label.toLowerCase().startsWith(prefix.toLowerCase())) label = label.slice(prefix.length).trim();
    }
  }
  return compactModelName(label, harness);
}
