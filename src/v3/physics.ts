// Engine v2 physics: Rapier (Apache-2.0, WebAssembly) for collision, scene queries and rigid props. Characters are
// parentless capsule colliders that Rapier's kinematic character controller moves (motor.ts); the level is fixed
// colliders; moving platforms are kinematic bodies that carry what stands on them; props are dynamic bodies that the
// characters push about.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export { RAPIER };

// Collision layers. Every collider has a membership and a filter, and two meet when each one's filter includes the
// other's membership. Queries (movement, camera, probes) carry their own pair, with `query` as their membership.
export const L = {
  world: 1 << 0, // the level: stops characters, props and the camera
  detail: 1 << 1, // small fixed things (posts, fences): stop characters, not the camera
  kitten: 1 << 2,
  knight: 1 << 3,
  prop: 1 << 4, // dynamic props
  kittenOnly: 1 << 5, // solid for her alone (the edge of water too deep for her)
  knightOnly: 1 << 6, // solid for him alone (the end of a beam too weak for him)
  query: 1 << 15,
  all: 0xffff,
};
export const groups = (member: number, filter: number) => ((((member & 0xffff) << 16) | (filter & 0xffff)) >>> 0);
// What standing-ground probes and lines of sight see.
export const SOLID = L.world | L.detail;

// What a surface is, for abilities and sound: the kitten climbs `climb` faces; `kind` picks footsteps.
export type Surface = { climb?: boolean; kind?: string; name?: string };

export type Hit = { point: THREE.Vector3; normal: THREE.Vector3; dist: number; collider: RAPIER.Collider; surface: Surface | undefined };

const _inv = new THREE.Quaternion();
const _e = new THREE.Euler();
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

// A kinematic body moved along a path (a function of time): lifts, ferries, turning wheels. Whatever stands on it is
// carried: a point riding it moves by the platform's change of pose over the last step.
export class Platform {
  pos = new THREE.Vector3(); quat = new THREE.Quaternion();
  prevPos = new THREE.Vector3(); prevQuat = new THREE.Quaternion();
  vel = new THREE.Vector3(); // of its origin over the last step, m/s
  private dq = new THREE.Quaternion();
  constructor(public body: RAPIER.RigidBody, public obj: THREE.Object3D, public path: (t: number, pos: THREE.Vector3, quat: THREE.Quaternion) => void) {}
  private delta() { return this.dq.copy(this.quat).multiply(_inv.copy(this.prevQuat).invert()); }
  // Moves a point that rode the platform through its last step (in place).
  carry(p: THREE.Vector3) { return p.sub(this.prevPos).applyQuaternion(this.delta()).add(this.pos); }
  // Its turn about the vertical over the last step, radians.
  yawDelta() { return _e.setFromQuaternion(this.delta(), 'YXZ').y; }
  // Velocity of a point riding it (m/s), for a jump that leaves it.
  pointVel(p: THREE.Vector3, dt: number, out: THREE.Vector3) {
    const before = out.copy(p);
    const after = this.carry(new THREE.Vector3().copy(p));
    return out.subVectors(after, before).divideScalar(dt);
  }
}

// A dynamic body with a visual that follows it (interpolated between physics steps).
export class Prop {
  pos = new THREE.Vector3(); quat = new THREE.Quaternion();
  prevPos = new THREE.Vector3(); prevQuat = new THREE.Quaternion();
  constructor(public body: RAPIER.RigidBody, public obj: THREE.Object3D) { this.read(); this.prevPos.copy(this.pos); this.prevQuat.copy(this.quat); }
  read() {
    const t = this.body.translation(), r = this.body.rotation();
    this.pos.set(t.x, t.y, t.z); this.quat.set(r.x, r.y, r.z, r.w);
  }
}

export class Physics {
  world: RAPIER.World;
  surfaces = new Map<number, Surface>();
  platforms: Platform[] = [];
  props: Prop[] = [];
  time = 0;
  private byBody = new Map<number, Platform>();
  private ray: RAPIER.Ray;
  private balls = new Map<number, RAPIER.Ball>();

  private constructor(dt: number) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = dt;
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  }

  static async create(dt: number) {
    await RAPIER.init();
    return new Physics(dt);
  }

  // ---- Building.

  // A fixed collider (no body).
  addFixed(desc: RAPIER.ColliderDesc, surface?: Surface, member = L.world) {
    desc.setCollisionGroups(groups(member, L.all));
    const c = this.world.createCollider(desc);
    if (surface) this.surfaces.set(c.handle, surface);
    return c;
  }

  // A fixed box: centre, half extents, optional rotation.
  addBox(center: THREE.Vector3, half: THREE.Vector3, quat?: THREE.Quaternion, surface?: Surface, member = L.world) {
    const d = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(center.x, center.y, center.z);
    if (quat) d.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    return this.addFixed(d, surface, member);
  }

  // A fixed triangle mesh from a three.js mesh, its world transform baked in. Internal edges are fixed so a capsule
  // sliding over a seam between triangles does not catch on it.
  addMesh(mesh: THREE.Mesh, surface?: Surface, member = L.world) {
    mesh.updateWorldMatrix(true, false);
    const g = mesh.geometry, pos = g.getAttribute('position');
    const v = new Float32Array(pos.count * 3), t = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      t.fromBufferAttribute(pos as THREE.BufferAttribute, i).applyMatrix4(mesh.matrixWorld);
      v[i * 3] = t.x; v[i * 3 + 1] = t.y; v[i * 3 + 2] = t.z;
    }
    let idx: Uint32Array;
    if (g.index) idx = Uint32Array.from(g.index.array as ArrayLike<number>);
    else { idx = new Uint32Array(pos.count); for (let i = 0; i < pos.count; i++) idx[i] = i; }
    return this.addFixed(RAPIER.ColliderDesc.trimesh(v, idx, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES), surface, member);
  }

  // A moving platform: colliders (relative to the body) and a visual, both posed by `path` each step.
  addPlatform(obj: THREE.Object3D, shapes: RAPIER.ColliderDesc[], path: Platform['path'], surface?: Surface, member = L.world) {
    const p0 = new THREE.Vector3(), q0 = new THREE.Quaternion();
    path(this.time, p0, q0);
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p0.x, p0.y, p0.z).setRotation({ x: q0.x, y: q0.y, z: q0.z, w: q0.w }));
    for (const d of shapes) {
      d.setCollisionGroups(groups(member, L.all));
      const c = this.world.createCollider(d, body);
      if (surface) this.surfaces.set(c.handle, surface);
    }
    const pl = new Platform(body, obj, path);
    pl.pos.copy(p0); pl.quat.copy(q0); pl.prevPos.copy(p0); pl.prevQuat.copy(q0);
    obj.position.copy(p0); obj.quaternion.copy(q0);
    this.platforms.push(pl);
    this.byBody.set(body.handle, pl);
    return pl;
  }

  // A dynamic prop (crate, barrel): one collider on a body at a pose; density sets how hard it is to push.
  addProp(obj: THREE.Object3D, desc: RAPIER.ColliderDesc, at: THREE.Vector3, quat = new THREE.Quaternion(), density = 1, surface?: Surface) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y, at.z)
      .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }).setLinearDamping(0.5).setAngularDamping(0.8));
    desc.setCollisionGroups(groups(L.prop, L.all)).setDensity(density).setFriction(0.9);
    const c = this.world.createCollider(desc, body);
    if (surface) this.surfaces.set(c.handle, surface);
    const p = new Prop(body, obj);
    obj.position.copy(p.pos); obj.quaternion.copy(p.quat);
    this.props.push(p);
    return p;
  }

  platformOf(c: RAPIER.Collider | null): Platform | null {
    const b = c?.parent();
    return b ? this.byBody.get(b.handle) ?? null : null;
  }

  // ---- Stepping.

  // Platforms take their next pose, then the world steps (they move, props fall and tumble).
  step(dt: number) {
    this.time += dt;
    for (const p of this.platforms) {
      p.prevPos.copy(p.pos); p.prevQuat.copy(p.quat);
      p.path(this.time, p.pos, p.quat);
      p.vel.subVectors(p.pos, p.prevPos).divideScalar(dt);
      p.body.setNextKinematicTranslation(p.pos);
      p.body.setNextKinematicRotation(p.quat);
    }
    for (const p of this.props) { p.prevPos.copy(p.pos); p.prevQuat.copy(p.quat); }
    this.world.step();
    for (const p of this.props) p.read();
  }

  // Visuals between the last two steps.
  sync(alpha: number) {
    for (const p of this.platforms) { p.obj.position.lerpVectors(p.prevPos, p.pos, alpha); p.obj.quaternion.slerpQuaternions(p.prevQuat, p.quat, alpha); }
    for (const p of this.props) { p.obj.position.lerpVectors(p.prevPos, p.pos, alpha); p.obj.quaternion.slerpQuaternions(p.prevQuat, p.quat, alpha); }
  }

  // ---- Queries.

  // Nearest hit along a ray (dir need not be normalised).
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, filter = SOLID, exclude?: RAPIER.Collider): Hit | null {
    const l = dir.length() || 1;
    const r = this.ray;
    r.origin = { x: origin.x, y: origin.y, z: origin.z };
    r.dir = { x: dir.x / l, y: dir.y / l, z: dir.z / l };
    const h = this.world.castRayAndGetNormal(r, maxDist, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(L.query, filter), exclude);
    if (!h) return null;
    const d = h.timeOfImpact;
    return {
      point: new THREE.Vector3(origin.x + r.dir.x * d, origin.y + r.dir.y * d, origin.z + r.dir.z * d),
      normal: new THREE.Vector3(h.normal.x, h.normal.y, h.normal.z), dist: d, collider: h.collider, surface: this.surfaces.get(h.collider.handle),
    };
  }

  // A ball swept along a direction: the distance it travels before touching something.
  sphereCast(origin: THREE.Vector3, dir: THREE.Vector3, radius: number, maxDist: number, filter = SOLID, exclude?: RAPIER.Collider): Hit | null {
    let ball = this.balls.get(radius);
    if (!ball) { ball = new RAPIER.Ball(radius); this.balls.set(radius, ball); }
    const l = dir.length() || 1;
    const h = this.world.castShape(origin, IDENTITY, { x: dir.x / l, y: dir.y / l, z: dir.z / l }, ball, 0, maxDist, true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(L.query, filter), exclude);
    if (!h) return null;
    return {
      point: new THREE.Vector3(h.witness1.x, h.witness1.y, h.witness1.z), normal: new THREE.Vector3(h.normal1.x, h.normal1.y, h.normal1.z),
      dist: h.time_of_impact, collider: h.collider, surface: this.surfaces.get(h.collider.handle),
    };
  }

  // Whether a ball at a point overlaps anything solid.
  overlaps(center: THREE.Vector3, radius: number, filter = SOLID, exclude?: RAPIER.Collider) {
    let ball = this.balls.get(radius);
    if (!ball) { ball = new RAPIER.Ball(radius); this.balls.set(radius, ball); }
    let hit = false;
    this.world.intersectionsWithShape(center, IDENTITY, ball, () => { hit = true; return false; }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(L.query, filter), exclude);
    return hit;
  }

  // Height of the standing ground under (x, z), searching down from y; null if nothing is within `depth`.
  groundY(x: number, y: number, z: number, depth = 3, filter = SOLID | L.prop) {
    const h = this.raycast(_o.set(x, y, z), DOWN, depth, filter);
    return h ? h.point.y : null;
  }
}

const _o = new THREE.Vector3();
export const DOWN = new THREE.Vector3(0, -1, 0);
export const UP = new THREE.Vector3(0, 1, 0);
