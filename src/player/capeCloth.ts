// Simulate the cape in world space, with its stitched edge held by the animated rig.
// Weld a small simulation mesh under the original fabric and keep the asset's trim and colors.
import * as THREE from 'three';

const PANEL_CELL = 0.046;
const STEP = 1 / 90;
const SOLVER_PASSES = 3;
const COLLISION_BATCH = 20;
const CLOTH_CLEARANCE = 0.027;
/** The largest clearance any projection asks for (bounds the colliders' early-out spheres). */
const MAX_CLEARANCE = 0.03;

interface Particle {
  vertex: number;
  mobility: number;
  rest: THREE.Vector3;
  guide: THREE.Vector3;
  position: THREE.Vector3;
  previous: THREE.Vector3;
  velocity: THREE.Vector3;
}

interface Collider {
  readonly bounds: THREE.Box3;
  update(): void;
  /** Push the point out of the collider; true if it moved. */
  project(point: THREE.Vector3, clearance: number): boolean;
}

/** Find complete sewn panels, even where the upper fabric is weighted only to the chest. */
function capePanels(geometry: THREE.BufferGeometry, weight: Float32Array): Set<number> {
  const parent = Int32Array.from(weight, (_, i) => i);
  const find = (vertex: number): number => {
    while (parent[vertex] !== vertex) {
      parent[vertex] = parent[parent[vertex]];
      vertex = parent[vertex];
    }
    return vertex;
  };
  const join = (a: number, b: number) => { parent[find(b)] = find(a); };
  const index = geometry.getIndex()!;
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i);
    join(a, index.getX(i + 1));
    join(a, index.getX(i + 2));
  }
  // UV/color seams can split render vertices at an otherwise continuous edge.
  const vertices = geometry.attributes.position;
  const seams = new Map<string, number>();
  for (let i = 0; i < vertices.count; i++) {
    const key = `${Math.round(vertices.getX(i) * 1e5)},${Math.round(vertices.getY(i) * 1e5)},${Math.round(vertices.getZ(i) * 1e5)}`;
    const other = seams.get(key);
    if (other === undefined) seams.set(key, i);
    else join(i, other);
  }
  const panels = new Set<number>();
  weight.forEach((amount, i) => { if (amount > 0) panels.add(find(i)); });
  const cloth = new Set<number>();
  weight.forEach((_, i) => { if (panels.has(find(i))) cloth.add(i); });
  return cloth;
}

class BodyOval implements Collider {
  private readonly pose = new THREE.Matrix4();
  private readonly inversePose = new THREE.Matrix4();
  private readonly local = new THREE.Vector3();
  readonly bounds = new THREE.Box3();
  private readonly worldCenter = new THREE.Vector3();
  private readonly extent = new THREE.Vector3();

  constructor(
    private readonly bone: THREE.Bone,
    private readonly inverseBind: THREE.Matrix4,
    private readonly center: THREE.Vector3,
    private readonly radius: THREE.Vector3,
  ) {}

  update(): void {
    this.pose.multiplyMatrices(this.bone.matrixWorld, this.inverseBind);
    this.inversePose.copy(this.pose).invert();
    this.worldCenter.copy(this.center).applyMatrix4(this.pose);
    const m = this.pose.elements;
    const x = this.radius.x + MAX_CLEARANCE, y = this.radius.y + MAX_CLEARANCE, z = this.radius.z + MAX_CLEARANCE;
    this.extent.set(
      Math.hypot(m[0] * x, m[4] * y, m[8] * z),
      Math.hypot(m[1] * x, m[5] * y, m[9] * z),
      Math.hypot(m[2] * x, m[6] * y, m[10] * z),
    );
    this.bounds.min.copy(this.worldCenter).sub(this.extent);
    this.bounds.max.copy(this.worldCenter).add(this.extent);
  }

  project(point: THREE.Vector3, clearance: number): boolean {
    if (!this.bounds.containsPoint(point)) return false;
    const local = this.local.copy(point).applyMatrix4(this.inversePose).sub(this.center);
    const x = local.x / (this.radius.x + clearance);
    const y = local.y / (this.radius.y + clearance);
    const z = local.z / (this.radius.z + clearance);
    const distanceSquared = x * x + y * y + z * z;
    if (distanceSquared >= 1) return false;
    if (distanceSquared > 1e-8) local.multiplyScalar(1 / Math.sqrt(distanceSquared));
    else local.set(0, 0, -this.radius.z - clearance);
    point.copy(local.add(this.center).applyMatrix4(this.pose));
    return true;
  }
}

class LimbCapsule implements Collider {
  private readonly start = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private lengthSquared = 0;
  readonly bounds = new THREE.Box3();

  constructor(private readonly joint: THREE.Bone, private readonly end: THREE.Bone, private readonly radius: number) {}

  update(): void {
    this.start.setFromMatrixPosition(this.joint.matrixWorld);
    this.axis.setFromMatrixPosition(this.end.matrixWorld);
    this.bounds.set(this.start, this.start);
    this.bounds.expandByPoint(this.axis).expandByScalar(this.radius + MAX_CLEARANCE);
    this.axis.sub(this.start);
    this.lengthSquared = Math.max(1e-8, this.axis.lengthSq());
  }

  project(point: THREE.Vector3, clearance: number): boolean {
    if (!this.bounds.containsPoint(point)) return false;
    const offset = this.offset.subVectors(point, this.start);
    const fraction = THREE.MathUtils.clamp(offset.dot(this.axis) / this.lengthSquared, 0, 1);
    offset.addScaledVector(this.axis, -fraction);
    const radius = this.radius + clearance;
    const distanceSquared = offset.lengthSq();
    if (distanceSquared >= radius * radius) return false;
    if (distanceSquared < 1e-8) {
      offset.set(1, 0, 0);
      if (Math.abs(this.axis.x) > Math.abs(this.axis.y)) offset.set(0, 1, 0);
      offset.addScaledVector(this.axis, -offset.dot(this.axis) / this.lengthSquared);
      point.add(offset.setLength(radius));
    } else point.addScaledVector(offset, radius / Math.sqrt(distanceSquared) - 1);
    return true;
  }
}

export class CapeCloth {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  private readonly particles: Particle[] = [];
  private readonly edges: { a: Particle; b: Particle; restLength: number }[] = [];
  private readonly vertices: { source: number; particle: Particle; strength: number; influences: { particle: Particle; weight: number }[] }[] = [];
  private readonly colliders: Collider[];
  private readonly origin = new THREE.Vector3();
  private readonly lastOrigin = new THREE.Vector3();
  private readonly inverseMesh = new THREE.Matrix4();
  private readonly vertex = new THREE.Vector3();
  private readonly delta = new THREE.Vector3();
  private readonly positions: THREE.BufferAttribute;
  private initialized = false;
  // CPU skinning, done once per bone per frame rather than per vertex influence:
  // world = Σ w · (meshWorld · bindInverse · boneWorld · boneInverse · bind) · rest.
  private readonly restPos: Float32Array;
  private readonly skinIdx: Uint16Array;
  private readonly skinWt: Float32Array;
  private readonly boneWorld: THREE.Matrix4[];
  private readonly scratch = new THREE.Matrix4();
  private breezeTime = 0;
  private breezeX = 0;
  private breezeZ = 0;
  // The particle → vertex transfer, flattened: vertex i reads influences infStart[i]..infStart[i+1].
  private infStart = new Int32Array(0);
  private infParticle = new Int32Array(0);
  private infWeight = new Float32Array(0);
  private disp = new Float32Array(0);
  private readonly worldPositions: Float32Array;
  private readonly collisionOrder: Uint32Array;
  private readonly batchBounds = new THREE.Box3();
  private readonly nearby: Collider[] = [];

  constructor(private readonly skin: THREE.SkinnedMesh, material: THREE.Material) {
    const original = skin.geometry;
    const index = original.getIndex()!;
    const { color, skinIndex, skinWeight } = original.attributes;
    const { bones, boneInverses } = skin.skeleton;
    const n = original.attributes.position.count;
    this.restPos = new Float32Array(n * 3);
    this.skinIdx = new Uint16Array(n * 4);
    this.skinWt = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      this.restPos[i * 3] = original.attributes.position.getX(i);
      this.restPos[i * 3 + 1] = original.attributes.position.getY(i);
      this.restPos[i * 3 + 2] = original.attributes.position.getZ(i);
      for (let j = 0; j < 4; j++) {
        this.skinIdx[i * 4 + j] = skinIndex.getComponent(i, j);
        this.skinWt[i * 4 + j] = skinWeight.getComponent(i, j);
      }
    }
    this.boneWorld = bones.map(() => new THREE.Matrix4());
    const capeBones = new Set(bones.map((bone, i) => bone.name.startsWith('cape') ? i : -1).filter((i) => i >= 0));
    const weight = new Float32Array(original.attributes.position.count);
    for (let i = 0; i < weight.length; i++) {
      for (let j = 0; j < 4; j++) {
        if (capeBones.has(skinIndex.getComponent(i, j))) weight[i] += skinWeight.getComponent(i, j);
      }
    }
    const panelVertices = capePanels(original, weight);

    const bodyIndices: number[] = [];
    const clothIndices: number[] = [];
    const colors: number[] = [];
    const positions: number[] = [];
    const remap = new Map<number, number>();
    const cells = new Map<string, Particle>();
    const edgeBuckets = new Map<Particle, Set<Particle>>();

    const addVertex = (source: number) => {
      const existing = remap.get(source);
      if (existing !== undefined) return existing;
      const rest = new THREE.Vector3().fromBufferAttribute(original.attributes.position, source);
      const strength = THREE.MathUtils.smoothstep(weight[source], 0.10, 0.87);
      const key = rest.toArray().map((value) => Math.round(value / PANEL_CELL)).join(',');
      let particle = cells.get(key);
      if (!particle) {
        particle = {
          vertex: source, mobility: strength, rest,
          guide: new THREE.Vector3(), position: new THREE.Vector3(),
          previous: new THREE.Vector3(), velocity: new THREE.Vector3(),
        };
        cells.set(key, particle);
        this.particles.push(particle);
      } else if (strength < particle.mobility) {
        // A cell shared with the seam always follows the seam representative.
        particle.vertex = source;
        particle.rest.copy(rest);
        particle.mobility = strength;
      }
      const vertex = this.vertices.length;
      this.vertices.push({ source, particle, strength, influences: [] });
      for (let c = 0; c < color.itemSize; c++) colors.push(color.getComponent(source, c));
      positions.push(rest.x, rest.y, rest.z);
      remap.set(source, vertex);
      return vertex;
    };

    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      const b = index.getX(i + 1);
      const c = index.getX(i + 2);
      if (panelVertices.has(a)) clothIndices.push(addVertex(a), addVertex(b), addVertex(c));
      else bodyIndices.push(a, b, c);
    }

    for (let i = 0; i < clothIndices.length; i += 3) {
      for (let side = 0; side < 3; side++) {
        const a = this.vertices[clothIndices[i + side]].particle;
        const b = this.vertices[clothIndices[i + (side + 1) % 3]].particle;
        if (a === b || (!a.mobility && !b.mobility) || edgeBuckets.get(b)?.has(a) || edgeBuckets.get(a)?.has(b)) continue;
        let neighbors = edgeBuckets.get(a);
        if (!neighbors) edgeBuckets.set(a, neighbors = new Set());
        neighbors.add(b);
        this.edges.push({ a, b, restLength: a.rest.distanceTo(b.rest) });
      }
    }
    // Transfer a smooth field back to the detailed fabric. Adjacent vertices can
    // straddle a proxy cell boundary or sit on opposite faces of the same fold.
    const transferRadius = 2.2 * PANEL_CELL;
    for (const vertex of this.vertices) {
      if (!vertex.strength) continue;
      const rest = this.vertex.fromBufferAttribute(original.attributes.position, vertex.source);
      for (const particle of this.particles) {
        const distance = rest.distanceTo(particle.rest);
        if (distance >= transferRadius) continue;
        const weight = (1 - distance / transferRadius) ** 3;
        vertex.influences.push({ particle, weight });
      }
      // Bound the transfer work per render vertex even around very dense seams.
      vertex.influences.sort((a, b) => b.weight - a.weight);
      vertex.influences.length = Math.min(6, vertex.influences.length);
      const total = vertex.influences.reduce((sum, influence) => sum + influence.weight, 0);
      for (const influence of vertex.influences) influence.weight *= Math.sqrt(vertex.strength) / total;
    }

    const particleIndex = new Map(this.particles.map((q, i) => [q, i]));
    const totalInfluences = this.vertices.reduce((a, v) => a + v.influences.length, 0);
    this.infStart = new Int32Array(this.vertices.length + 1);
    this.infParticle = new Int32Array(totalInfluences);
    this.infWeight = new Float32Array(totalInfluences);
    this.disp = new Float32Array(this.particles.length * 3);
    let fill = 0;
    this.vertices.forEach((v, i) => {
      this.infStart[i] = fill;
      for (const { particle, weight } of v.influences) {
        this.infParticle[fill] = particleIndex.get(particle)!;
        this.infWeight[fill++] = weight;
      }
    });
    this.infStart[this.vertices.length] = fill;
    this.worldPositions = new Float32Array(this.vertices.length * 3);
    // Group render vertices attached to neighboring cloth cells for the broad phase.
    this.collisionOrder = Uint32Array.from(this.vertices, (_, i) => i);
    this.collisionOrder.sort((a, b) => particleIndex.get(this.vertices[a].particle)! - particleIndex.get(this.vertices[b].particle)!);

    original.setIndex(bodyIndices);
    const geometry = new THREE.BufferGeometry();
    this.positions = new THREE.Float32BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.positions);
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, color.itemSize));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(positions.length), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setIndex(clothIndices);
    geometry.computeVertexNormals();
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'Simulated cape';
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    skin.add(this.mesh);

    const bone = (name: string) => bones.find((joint) => joint.name === name)!;
    const oval = (name: string, center: [number, number, number], radii: [number, number, number]) => {
      const joint = bone(name);
      return new BodyOval(joint, boneInverses[bones.indexOf(joint)], new THREE.Vector3(...center), new THREE.Vector3(...radii));
    };
    // Dimensions measured in the model's bind pose, with limb capsules driven by the animated joints.
    this.colliders = [
      oval('chest', [0, 1.276, -0.017], [0.266, 0.24, 0.161]),
      oval('spine', [0, 1.087, -0.009], [0.231, 0.247, 0.159]),
      oval('pelvis', [0, 0.873, -0.012], [0.246, 0.23, 0.164]),
    ];
    for (const side of ['L', 'R']) {
      this.colliders.push(
        new LimbCapsule(bone('upper_arm' + side), bone('forearm' + side), 0.107),
        new LimbCapsule(bone('forearm' + side), bone('hand' + side), 0.088),
        new LimbCapsule(bone('thigh' + side), bone('shin' + side), 0.142),
        new LimbCapsule(bone('shin' + side), bone('foot' + side), 0.141),
      );
    }
  }

  reset(): void {
    this.initialized = false;
    this.breezeTime = 0;
  }

  /** Compose each bone's full skinning matrix for this frame. */
  private updateBones(): void {
    const { bones, boneInverses } = this.skin.skeleton;
    const pre = this.scratch.multiplyMatrices(this.skin.matrixWorld, this.skin.bindMatrixInverse);
    for (let b = 0; b < bones.length; b++) {
      this.boneWorld[b].multiplyMatrices(pre, bones[b].matrixWorld).multiply(boneInverses[b]).multiply(this.skin.bindMatrix);
    }
  }

  /** The source vertex's skinned position in world space (same as getVertexPosition · matrixWorld). */
  private skinned(source: number, out: THREE.Vector3): THREE.Vector3 {
    const x = this.restPos[source * 3];
    const y = this.restPos[source * 3 + 1];
    const z = this.restPos[source * 3 + 2];
    let ox = 0;
    let oy = 0;
    let oz = 0;
    for (let j = 0; j < 4; j++) {
      const w = this.skinWt[source * 4 + j];
      if (w === 0) continue;
      const e = this.boneWorld[this.skinIdx[source * 4 + j]].elements;
      ox += w * (e[0] * x + e[4] * y + e[8] * z + e[12]);
      oy += w * (e[1] * x + e[5] * y + e[9] * z + e[13]);
      oz += w * (e[2] * x + e[6] * y + e[10] * z + e[14]);
    }
    return out.set(ox, oy, oz);
  }

  update(dt: number, floor?: number): void {
    this.updateBones();
    this.origin.setFromMatrixPosition(this.skin.matrixWorld);
    const reset = !this.initialized || this.origin.distanceToSquared(this.lastOrigin) > 6.25 || dt > 0.14;
    this.initialized = true;
    this.lastOrigin.copy(this.origin);
    this.inverseMesh.copy(this.skin.matrixWorld).invert();
    for (const c of this.colliders) c.update();
    for (const p of this.particles) {
      this.skinned(p.vertex, p.guide);
      if (reset || !p.mobility) {
        p.position.copy(p.guide);
        p.velocity.set(0, 0, 0);
      }
    }

    // Resolve at most three substeps after a slow frame. The render mesh keeps its
    // full resolution, but the light proxy carries the cloth's inertia and wind.
    const time = Math.min(dt, STEP * 3);
    this.breezeTime += time;
    this.breezeX = 1.1 * Math.sin(this.breezeTime * 1.9) + 0.33 * Math.sin(this.breezeTime * 4.2);
    this.breezeZ = 0.69 * Math.cos(this.breezeTime * 1.37);
    const substeps = Math.max(1, Math.ceil(time / STEP));
    for (let i = 0; i < substeps; i++) this.step(time / substeps, floor);
    const disp = this.disp;
    this.particles.forEach((p, i) => {
      disp[i * 3] = p.position.x - p.guide.x;
      disp[i * 3 + 1] = p.position.y - p.guide.y;
      disp[i * 3 + 2] = p.position.z - p.guide.z;
    });

    const world = this.worldPositions;
    for (let i = 0; i < this.vertices.length; i++) {
      const point = this.skinned(this.vertices[i].source, this.vertex);
      let x = point.x, y = point.y, z = point.z;
      for (let k = this.infStart[i]; k < this.infStart[i + 1]; k++) {
        const j = this.infParticle[k] * 3;
        const w = this.infWeight[k];
        x += disp[j] * w;
        y += disp[j + 1] * w;
        z += disp[j + 2] * w;
      }
      const vertex = i * 3;
      world[vertex] = x;
      world[vertex + 1] = y;
      world[vertex + 2] = z;
    }

    const out = this.positions.array as Float32Array;
    const m = this.inverseMesh.elements;
    for (let first = 0; first < this.collisionOrder.length; first += COLLISION_BATCH) {
      const last = Math.min(first + COLLISION_BATCH, this.collisionOrder.length);
      this.batchBounds.makeEmpty();
      for (let n = first; n < last; n++) {
        this.batchBounds.expandByPoint(this.vertex.fromArray(world, this.collisionOrder[n] * 3));
      }
      this.nearby.length = 0;
      for (const collider of this.colliders) if (this.batchBounds.intersectsBox(collider.bounds)) this.nearby.push(collider);

      for (let n = first; n < last; n++) {
        const i = this.collisionOrder[n];
        const vertex = i * 3;
        const point = this.vertex.fromArray(world, vertex);
        const clearance = 0.005 * (0.5 + this.vertices[i].strength);
        let moved = false;
        for (const collider of this.nearby) moved = collider.project(point, clearance) || moved;
        // A projection can move the vertex into a neighboring limb.
        if (moved) for (const collider of this.colliders) collider.project(point, clearance);
        if (floor !== undefined) point.y = Math.max(point.y, floor + 0.018);
        const { x, y, z } = point;
        out[vertex] = m[0] * x + m[4] * y + m[8] * z + m[12];
        out[vertex + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        out[vertex + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      }
    }
    this.positions.needsUpdate = true;
    this.updateNormals();
  }

  /** Smooth vertex normals straight from the typed arrays (computeVertexNormals, minus the overhead). */
  private updateNormals(): void {
    const geo = this.mesh.geometry;
    const pos = this.positions.array as Float32Array;
    const normalAttr = geo.getAttribute('normal') as THREE.BufferAttribute;
    const nrm = normalAttr.array as Float32Array;
    const idx = geo.index!.array;
    nrm.fill(0);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3;
      const b = idx[t + 1] * 3;
      const c = idx[t + 2] * 3;
      const e1x = pos[b] - pos[a];
      const e1y = pos[b + 1] - pos[a + 1];
      const e1z = pos[b + 2] - pos[a + 2];
      const e2x = pos[c] - pos[a];
      const e2y = pos[c + 1] - pos[a + 1];
      const e2z = pos[c + 2] - pos[a + 2];
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      nrm[a] += nx;
      nrm[a + 1] += ny;
      nrm[a + 2] += nz;
      nrm[b] += nx;
      nrm[b + 1] += ny;
      nrm[b + 2] += nz;
      nrm[c] += nx;
      nrm[c + 1] += ny;
      nrm[c + 2] += nz;
    }
    for (let i = 0; i < nrm.length; i += 3) {
      const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
      nrm[i] /= l;
      nrm[i + 1] /= l;
      nrm[i + 2] /= l;
    }
    normalAttr.needsUpdate = true;
  }

  private step(dt: number, floor?: number): void {
    const damping = Math.exp(-5.5 * dt);
    for (const p of this.particles) {
      if (!p.mobility) continue;
      p.previous.copy(p.position);
      // Gravity and air drag act on the loose cloth. A soft tether near the seam
      // keeps the tailored drape while the lower panels lag behind the body.
      const spring = THREE.MathUtils.lerp(85, 18, p.mobility);
      p.velocity.multiplyScalar(damping).addScaledVector(this.delta.subVectors(p.guide, p.position), spring * dt);
      const gust = p.mobility * p.mobility * dt;
      p.velocity.x += this.breezeX * gust;
      p.velocity.z += this.breezeZ * gust;
      p.velocity.y -= 9.81 * p.mobility * dt;
      p.position.addScaledVector(p.velocity, dt);
    }

    for (let i = 0; i < SOLVER_PASSES; i++) {
      for (const { a, b, restLength } of this.edges) {
        const delta = this.delta.subVectors(b.position, a.position);
        const length = delta.length();
        if (length < 1e-6) continue;
        const correction = 0.82 * (length - restLength) / (length * (a.mobility + b.mobility));
        a.position.addScaledVector(delta, a.mobility * correction);
        b.position.addScaledVector(delta, -b.mobility * correction);
      }
      for (const p of this.particles) {
        if (!p.mobility) continue;
        const delta = this.delta.subVectors(p.position, p.guide);
        const reach = 0.07 + 0.52 * p.mobility;
        if (delta.lengthSq() > reach * reach) p.position.copy(p.guide).add(delta.setLength(reach));
        for (const c of this.colliders) c.project(p.position, CLOTH_CLEARANCE);
        if (floor !== undefined) p.position.y = Math.max(p.position.y, floor + 0.026);
      }
    }

    if (dt > 0) {
      for (const p of this.particles) {
        if (p.mobility) p.velocity.subVectors(p.position, p.previous).divideScalar(dt).clampLength(0, 13);
      }
    }
  }
}
