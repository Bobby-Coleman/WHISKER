// Binary model files (GLB, strand and shell data). The published page can only serve web file types, so the
// production build ships each one as base64 text (<name>.txt, written by make_artifact.mjs), gzipped when that
// helps; dev reads the raw file.

// Bytes received so far across every model download, for the loading bar. `expected` comes from the
// manifest make_artifact.mjs writes next to the models (0 in dev, where progress falls back to file counts).
export const downloads = {
  loaded: 0, expected: 0, files: 0, filesDone: 0,
  onProgress: null as null | (() => void),
};

let manifest: Promise<Record<string, number>> | null = null;
export function modelManifest(base: string) {
  if (!manifest) {
    manifest = !import.meta.env.PROD ? Promise.resolve({}) : fetch(base + 'manifest.json')
      .then((r) => (r.ok ? r.json() : {}))
      .then((m: Record<string, number>) => {
        downloads.expected = Object.values(m).reduce((a, b) => a + b, 0);
        downloads.onProgress?.();
        return m;
      })
      .catch(() => ({}));
  }
  return manifest;
}

// Reads a response body chunk by chunk so the loading bar moves while large files arrive.
async function readBody(res: Response): Promise<Uint8Array> {
  downloads.files++;
  let out: Uint8Array;
  if (!res.body) {
    out = new Uint8Array(await res.arrayBuffer());
    downloads.loaded += out.length;
  } else {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); n += value.length;
      downloads.loaded += value.length;
      downloads.onProgress?.();
    }
    out = new Uint8Array(n);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
  }
  downloads.filesDone++;
  downloads.onProgress?.();
  return out;
}

// Counts a file fetched by another loader (textures) once it has arrived.
export function countDownload(bytes: number) {
  downloads.files++; downloads.filesDone++; downloads.loaded += bytes;
  downloads.onProgress?.();
}

export async function fetchBinary(url: string): Promise<ArrayBuffer> {
  if (import.meta.env.PROD) {
    const res = await fetch(url + '.txt');
    if (!res.ok) throw new Error(`Could not load ${url}.txt (${res.status})`);
    const bin = atob(new TextDecoder().decode(await readBody(res)).trim());
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    if (out[0] === 0x1f && out[1] === 0x8b) {
      const stream = new Blob([out]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Response(stream).arrayBuffer();
    }
    return out.buffer;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  const b = await readBody(res);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}
