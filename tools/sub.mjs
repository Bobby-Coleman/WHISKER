// Exact-text replacements across files, tolerant of CRLF line endings (dev helper).
// Usage: node tools/sub.mjs edits.json   where edits.json = [{ "file": "src/x.ts", "a": "old", "b": "new" }, ...]
// Every `a` must occur in its file; the run stops before writing anything if one is missing.
import fs from 'node:fs';
const edits = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const files = new Map();
for (const e of edits) {
  if (!files.has(e.file)) files.set(e.file, fs.readFileSync(e.file, 'utf8'));
  let s = files.get(e.file);
  const crlf = s.includes('\r\n');
  const a = crlf ? e.a.replace(/\r?\n/g, '\r\n') : e.a, b = crlf ? e.b.replace(/\r?\n/g, '\r\n') : e.b;
  if (!s.includes(a)) { console.error(`missing in ${e.file}:\n${e.a}`); process.exit(1); }
  s = s.split(a).join(b);
  files.set(e.file, s);
}
for (const [f, s] of files) fs.writeFileSync(f, s);
console.log(`applied ${edits.length} edits to ${files.size} files`);
