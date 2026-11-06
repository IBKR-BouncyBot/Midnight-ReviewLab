import { cp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { build } from 'esbuild';
import { nativeWasmPlugin } from './native-wasm-plugin.mjs';
import { collectNotices } from './collect-notices.mjs';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
if (relative(root, dist) !== 'dist') throw new Error('Unsafe build directory');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(join(root, 'src'), dist, { recursive: true });
const assets = new Map();
const result = await build({
  absWorkingDir: root, entryPoints: [join(root, 'lib/native-engine.mjs')],
  outfile: join(dist, 'native.js'), bundle: true, format: 'esm', platform: 'browser',
  target: 'es2022', mainFields: ['browser', 'module', 'main'], conditions: ['browser', 'import'],
  plugins: [nativeWasmPlugin(assets, { projectRoot: root })],
  minify: true, legalComments: 'inline', metafile: true,
});
if (!assets.size) throw new Error('Build must include actual Midnight WASM');
if (!Object.keys(result.metafile.inputs).some(name => name.includes('managed/') && name.endsWith('contract/index.js'))) throw new Error('Build must contain generated Compact code');
if (Object.values(result.metafile.outputs).flatMap(value => value.imports).some(item => item.external)) throw new Error('Unexpected external native dependency');
await collectNotices(root, dist, Object.keys(result.metafile.inputs));
for (const [path, bytes] of assets) {
  await mkdir(resolve(dist, path, '..'), { recursive: true });
  await writeFile(join(dist, path), bytes);
}
await writeFile(join(dist, '.nojekyll'), '');
await writeFile(join(dist, 'native-build.json'), JSON.stringify({
  enabled: true, mode: 'native-local', compiler: '0.31.1', runtime: '0.16.0',
  wasm: [...assets.keys()], proofGenerationInBrowser: false, networkSubmission: false,
}, null, 2));
for (const file of ['README.md', 'LICENSE', 'NOTICE.md']) {
  if (await stat(join(root, file)).catch(() => false)) await cp(join(root, file), join(dist, file));
}
if (await stat(join(root, 'docs')).catch(() => false)) await cp(join(root, 'docs'), join(dist, 'docs'), { recursive: true });
console.log(JSON.stringify({ built: 'dist', wasmAssets: assets.size, nativeContract: true }));
