# GLB -> self-contained JSON glTF (the binary chunk embedded as a base64 data URI), for hosts that only serve JSON.
# Usage: python3 tools/glb2gltf.py in.glb out.gltf.json
import json, struct, sys, base64
data = open(sys.argv[1], 'rb').read()
magic, version, length = struct.unpack_from('<4sII', data, 0)
assert magic == b'glTF', 'not a GLB'
off, js, binc = 12, None, None
while off < length:
    clen, ctype = struct.unpack_from('<II', data, off)
    chunk = data[off + 8: off + 8 + clen]
    if ctype == 0x4E4F534A: js = json.loads(chunk.decode('utf8'))
    elif ctype == 0x004E4942: binc = chunk
    off += 8 + clen
if binc is not None:
    js['buffers'][0]['uri'] = 'data:application/octet-stream;base64,' + base64.b64encode(binc).decode('ascii')
json.dump(js, open(sys.argv[2], 'w'), separators=(',', ':'))
