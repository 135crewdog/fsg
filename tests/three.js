// Three.js in Node, for the tests of the picture's own pieces (src/render/) that need it. New in FSG, milestone
// 3 (pull request 9). The app names Three.js by a bare name ("three", "three/addons/..."), which the browser
// looks up in index.html's import map; Node has no import map, so this teaches Node the same one, with its own
// module hooks (node:module, register), and then hands back Three.js. Nothing is drawn: no WebGL is needed to
// build a scene and read it back. Import it before anything that imports Three.js:
//   const THREE = await three();
//   const { createAircraft } = await import('../src/render/aircraft.js');
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8');
const map = Object.fromEntries(Object.entries(JSON.parse(html.match(/<script type="importmap">([^]*?)<\/script>/)[1]).imports)
  .map(([name, path]) => [name, new URL(path, root).href]));

// The hook: a name in the map, or under one of its folders ("three/addons/"), is the file the map names.
const hooks = `
const map = ${JSON.stringify(map)};
export async function resolve(specifier, context, next) {
  if (map[specifier] && !specifier.endsWith('/')) return { url: map[specifier], shortCircuit: true };
  const folder = Object.keys(map).filter((key) => key.endsWith('/') && specifier.startsWith(key)).sort((a, b) => b.length - a.length)[0];
  if (folder) return { url: new URL(specifier.slice(folder.length), map[folder]).href, shortCircuit: true };
  return next(specifier, context);
}`;
let registered = false;

/** Three.js, as the app's page gets it. */
export async function three() {
  if (!registered) { register('data:text/javascript,' + encodeURIComponent(hooks)); registered = true; }
  return import('three');
}
