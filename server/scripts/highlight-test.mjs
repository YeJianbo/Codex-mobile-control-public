import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = (await fs.readFile(new URL('../public/highlight.js', import.meta.url), 'utf8')).replace('export function', 'function');
const document = {
  createElement: () => ({ textContent: '', className: '' }),
  createTextNode: text => ({ textContent: text }),
};
const context = vm.createContext({ document });
vm.runInContext(source, context);
function highlight(text, language) {
  const code = { textContent: text, classList: [`language-${language}`], dataset: {}, nodes: [],
    replaceChildren(...nodes) { this.nodes = nodes; this.textContent = nodes.map(n => n.textContent).join(''); },
  };
  context.code = code;
  vm.runInContext('highlightCodeElement(code)', context, { timeout: 1000 });
  assert.equal(code.textContent, text, `${language}: must preserve source exactly`);
  return code;
}
for (const language of ['ts', 'java', 'py', 'json', 'css', 'html', 'sh', 'yaml', 'sql', 'diff']) {
  highlight('@Decorator()\nconst text = "<img src=x onerror=alert(1)>";\n中文\n/* end */', language);
  highlight('abcdefghijklmnopqrstuvwxyz0123456789@#$%^&*()_+-=[]{};:"\'<>/?\\\n'.repeat(50), language);
}
assert(highlight('SELECT name FROM users WHERE id = 1', 'sql').nodes.some(n => n.className === 'tok-kw' && n.textContent === 'SELECT'));
assert.equal(highlight('plain text', 'unknown').nodes.length, 0);
assert.equal(highlight('x'.repeat(62 * 1024), 'js').nodes.length, 0);
const once = highlight('@Component class App {}', 'java');
const nodes = once.nodes;
context.code = once;
vm.runInContext('highlightCodeElement(code)', context, { timeout: 1000 });
assert.equal(once.nodes, nodes, 'second rendering should not nest tokens');
console.log('Highlight checks passed: decorators, source preservation, SQL, size limit, idempotence');
