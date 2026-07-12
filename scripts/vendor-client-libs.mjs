// Copies browser builds of katex, marked, and dompurify from node_modules into
// client/public/vendor/ so the no-bundler client can load them via script tags.
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const vendor = path.join(root, 'client/public/vendor');
mkdirSync(vendor, { recursive: true });

const copies = [
  ['node_modules/katex/dist/katex.min.js', 'katex.min.js'],
  ['node_modules/katex/dist/katex.min.css', 'katex.min.css'],
  ['node_modules/katex/dist/contrib/auto-render.min.js', 'katex-auto-render.min.js'],
  ['node_modules/katex/dist/fonts', 'fonts'],
  ['node_modules/marked/lib/marked.umd.js', 'marked.min.js'],
  ['node_modules/dompurify/dist/purify.min.js', 'purify.min.js'],
];
for (const [src, dest] of copies) {
  cpSync(path.join(root, src), path.join(vendor, dest), { recursive: true });
}
console.log('[vendor] client libs copied to client/public/vendor');
