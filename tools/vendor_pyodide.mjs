// Copy the Pyodide runtime (npm package "pyodide") into vendor/pyodide so the site serves it itself.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const src = path.dirname(require.resolve('pyodide/package.json'));
const dst = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'vendor', 'pyodide');
fs.mkdirSync(dst, { recursive: true });
const files = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json', 'package.json'];
for (const f of files) fs.copyFileSync(path.join(src, f), path.join(dst, f));
console.log(`vendored pyodide ${JSON.parse(fs.readFileSync(path.join(src, 'package.json'))).version} -> ${dst}`);
