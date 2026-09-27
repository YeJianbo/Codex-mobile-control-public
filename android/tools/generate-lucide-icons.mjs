import { mkdir, writeFile } from 'node:fs/promises';

const names = [
  'square-pen', 'ellipsis', 'plus', 'arrow-up', 'square', 'chevron-down', 'chevron-right',
  'x', 'images', 'folder-open', 'settings-2', 'monitor', 'file-text',
  'check', 'sliders-horizontal', 'folder', 'chart-no-axes-column',
  'terminal', 'info', 'pin', 'copy', 'corner-down-right', 'rotate-cw',
];
const output = new URL('../app/src/main/res/drawable/', import.meta.url);
await mkdir(output, { recursive: true });

function attrs(element) {
  return Object.fromEntries([...element.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}
function path(tag, a) {
  if (tag === 'path') return a.d;
  if (tag === 'line') return `M${a.x1},${a.y1} L${a.x2},${a.y2}`;
  if (tag === 'polyline' || tag === 'polygon') return `M${a.points.trim().replace(/\s+/g, ' L')}${tag === 'polygon' ? ' Z' : ''}`;
  if (tag === 'circle') {
    const cx = +a.cx, cy = +a.cy, r = +a.r;
    return `M${cx+r},${cy} A${r},${r} 0 1,0 ${cx-r},${cy} A${r},${r} 0 1,0 ${cx+r},${cy}`;
  }
  if (tag === 'rect') {
    const x = +a.x || 0, y = +a.y || 0, w = +a.width, h = +a.height, r = +a.rx || 0;
    return r ? `M${x+r},${y} H${x+w-r} A${r},${r} 0 0,1 ${x+w},${y+r} V${y+h-r} A${r},${r} 0 0,1 ${x+w-r},${y+h} H${x+r} A${r},${r} 0 0,1 ${x},${y+h-r} V${y+r} A${r},${r} 0 0,1 ${x+r},${y} Z` : `M${x},${y} H${x+w} V${y+h} H${x} Z`;
  }
  throw new Error(`Unsupported SVG tag: ${tag}`);
}

const results = await Promise.allSettled(names.map(async (name) => {
  const response = await fetch(`https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/${name}.svg`);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const svg = await response.text();
  const shapes = [...svg.matchAll(/<(path|line|polyline|polygon|circle|rect)\s+([^>]*?)\s*\/>/gs)]
    .map((match) => `  <path android:pathData="${path(match[1], attrs(match[2]))}"
    android:strokeColor="#ff000000" android:strokeWidth="2"
    android:strokeLineCap="round" android:strokeLineJoin="round"
    android:fillColor="#00000000" />`);
  if (!shapes.length) throw new Error(`${name}: no shapes parsed`);
  const xml = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp"
    android:viewportWidth="24" android:viewportHeight="24">
${shapes.join('\n')}
</vector>
`;
  await writeFile(new URL(`ic_lucide_${name.replaceAll('-', '_')}.xml`, output), xml);
}));
const failures = results.flatMap((result, index) => result.status === 'rejected' ? [`${names[index]}: ${result.reason}`] : []);
if (failures.length) throw new Error(failures.join('\n'));
console.log(`Generated ${names.length} Lucide vector drawables.`);
