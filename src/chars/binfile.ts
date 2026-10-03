// Binary model files (GLB, strand and shell data). The published page can only serve web file types, so the
// production build ships each one as base64 text (<name>.txt, written by make_artifact.mjs), gzipped when that
// helps; dev reads the raw file.
export async function fetchBinary(url: string): Promise<ArrayBuffer> {
  if (import.meta.env.PROD) {
    const res = await fetch(url + '.txt');
    if (!res.ok) throw new Error(`Could not load ${url}.txt (${res.status})`);
    const bin = atob((await res.text()).trim());
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
  return res.arrayBuffer();
}
