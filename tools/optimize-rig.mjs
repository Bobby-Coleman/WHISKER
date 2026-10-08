// Build the v3 rig payload from the original CC0 Quaternius files.
// Keep the bone hierarchy and only the rotation/pelvis tracks actually consumed by the game.
import fs from 'node:fs';
const used = new Set(['Idle_Loop','Walk_Loop','Jog_Fwd_Loop','Sprint_Loop','Jump_Start','Jump_Loop','Jump_Land',
  'Crouch_Idle_Loop','Crouch_Fwd_Loop','Walk_Carry_Loop','Push_Loop','OverhandThrow','PickUp_Table','Interact','Hit_Chest','Hit_Knockback']);
function read(name) {
  const raw = fs.readFileSync(`public/chars/${name}.glb`);
  const jsonLength = raw.readUInt32LE(12);
  const doc = JSON.parse(raw.subarray(20,20+jsonLength).toString());
  const at = 20+jsonLength;
  const bin = at+8 <= raw.length ? raw.subarray(at+8,at+8+raw.readUInt32LE(at)) : Buffer.alloc(0);
  return {doc,bin,size:raw.length};
}
function write(name, doc, bin) {
  const json = Buffer.from(JSON.stringify(doc));
  const jp = Buffer.alloc((json.length+3)&~3,0x20); json.copy(jp);
  const bp = Buffer.alloc((bin.length+3)&~3); bin.copy(bp);
  const out = Buffer.alloc(12+8+jp.length+(bp.length?8+bp.length:0));
  out.writeUInt32LE(0x46546c67,0); out.writeUInt32LE(2,4); out.writeUInt32LE(out.length,8);
  out.writeUInt32LE(jp.length,12); out.writeUInt32LE(0x4e4f534a,16); jp.copy(out,20);
  if(bp.length){const at=20+jp.length;out.writeUInt32LE(bp.length,at);out.writeUInt32LE(0x004e4942,at+4);bp.copy(out,at+8);}
  fs.writeFileSync(`public/chars/${name}-lite.glb`,out); return out.length;
}
for(const name of ['mannequin','ual_anims']) {
  const {doc,bin,size}=read(name);
  for(const n of doc.nodes) { delete n.mesh; delete n.skin; }
  for(const skin of doc.skins??[]) delete skin.inverseBindMatrices;
  for(const key of ['meshes','materials','textures','images','samplers']) delete doc[key];
  const acc = new Map(), views = new Map(); const newAcc=[],newViews=[],pieces=[]; let offset=0;
  const copyView = i => {
    if(views.has(i)) return views.get(i);
    const v=doc.bufferViews[i];
    const bytes=bin.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength);
    const padded=Buffer.alloc((bytes.length+3)&~3);bytes.copy(padded);
    const at=newViews.length;newViews.push({...v,buffer:0,byteOffset:offset});
    pieces.push(padded);offset+=padded.length;views.set(i,at);return at;
  };
  const copyAcc = i => {
    if(acc.has(i)) return acc.get(i);
    const a=doc.accessors[i]; if(a.sparse)throw new Error('Sparse rig accessors require explicit support');
    const at=newAcc.length;newAcc.push({...a,bufferView:copyView(a.bufferView)});acc.set(i,at);return at;
  };
  if(name==='mannequin') delete doc.animations;
  else doc.animations=doc.animations.filter(a=>used.has(a.name)).map(a=>{
    const channels=a.channels.filter(c=>{
      const n=doc.nodes[c.target.node].name??'';
      return !/^(index|middle|ring|pinky|thumb)_/.test(n) &&
        (c.target.path==='rotation'||(c.target.path==='translation'&&n==='pelvis'));
    });
    const samplers=[],map=new Map();
    for(const c of channels){let idx=map.get(c.sampler);if(idx===undefined){idx=samplers.length;const s=a.samplers[c.sampler];samplers.push({...s,input:copyAcc(s.input),output:copyAcc(s.output)});map.set(c.sampler,idx);}c.sampler=idx;}
    return {...a,channels,samplers};
  });
  const packed=Buffer.concat(pieces);
  if(packed.length){doc.accessors=newAcc;doc.bufferViews=newViews;doc.buffers=[{byteLength:packed.length}];}
  else {delete doc.accessors;delete doc.bufferViews;delete doc.buffers;}
  const after=write(name,doc,packed);
  console.log(`${name}: ${size.toLocaleString()} → ${after.toLocaleString()} bytes (${(100*(1-after/size)).toFixed(1)}% smaller)`);
}
