import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const MIME_BY_EXTENSION = { webp: 'image/webp', m4a: 'audio/mp4', flac: 'audio/flac' };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'assets/catalog.json'), 'utf8'));
const records = [], index = {}, byDigest = new Map();
for (const item of catalog.resources) {
  const bytes = fs.readFileSync(path.join(root, 'assets/production', item.file));
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha !== item.sha256 || bytes.length !== item.bytes) throw Error(`Asset does not match catalog: ${item.file}`);
  if (!byDigest.has(sha)) {
    const mime = MIME_BY_EXTENSION[item.file.split('.').pop().toLowerCase()];
    if (!mime) throw Error(`Unknown runtime asset type: ${item.file}`);
    byDigest.set(sha, records.length); records.push({ mime, base64: bytes.toString('base64') });
  }
  index[item.file] = byDigest.get(sha);
}
const bundle = await esbuild.build({ entryPoints: [path.join(root, 'src/app.mjs')], bundle: true, write: false, format: 'iife', target: 'es2022', minify: true, legalComments: 'none' });
const css = await esbuild.transform(fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8'), { loader: 'css', minify: true });
const payload = JSON.stringify({ catalog, records, index }).replaceAll('<', '\\u003c');
let html = fs.readFileSync(path.join(root, 'src/template.html'), 'utf8');
html = html.replace('<!-- INLINE_STYLE -->', `<style>${css.code}</style>`)
  .replace('<!-- INLINE_RESOURCES -->', `<script id="embedded-resources" type="application/json">${payload}</script>`)
  .replace('<!-- INLINE_SCRIPT -->', `<script>${bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`);
if (/<(?:script|img|link|audio|video)\b[^>]*(?:src|href)\s*=\s*["'](?:https?:|\/\/|\.\/)/i.test(html) || /@import\s|url\(\s*["']?https?:/i.test(html)) throw Error('External runtime dependency remains');
const out = path.join(root, 'dist'); fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'game.html'), html);
const report = { version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, date: new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()), bytes: Buffer.byteLength(html), gzipBytes: zlib.gzipSync(html).length, sha256: crypto.createHash('sha256').update(html).digest('hex'), runtimeResourceBytes: catalog.resources.reduce((s, r) => s + r.bytes, 0), resourceCount: catalog.resources.length, uniqueResources: records.length, codeBytes: bundle.outputFiles[0].contents.length, cssBytes: Buffer.byteLength(css.code), esbuild: esbuild.version, node: process.version, externalRuntimeResources: false, assets: catalog.resources };
fs.writeFileSync(path.join(root, 'build-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ file: 'dist/game.html', bytes: report.bytes, gzipBytes: report.gzipBytes, resourceCount: report.resourceCount, uniqueResources: report.uniqueResources }, null, 2));
