// Planar rigid-body contacts. Half extents are in metres and positive yaw turns +Z toward +X.
export interface Footprint { x: number; z: number; yaw: number; width: number; length: number }
export interface Chassis extends Footprint { vx: number; vz: number; spin: number; mass: number }
export interface Contact { nx: number; nz: number; depth: number; x: number; z: number }

function radius(p: Footprint, nx: number, nz: number): number {
  const s = Math.sin(p.yaw), c = Math.cos(p.yaw);
  return Math.abs(s * nx + c * nz) * p.length + Math.abs(c * nx - s * nz) * p.width;
}

// The edge (or corner) furthest along the normal, projected onto the contact tangent.
function edge(p: Footprint, nx: number, nz: number, tx: number, tz: number) {
  const s = Math.sin(p.yaw), c = Math.cos(p.yaw);
  let middle = p.x * tx + p.z * tz, span = 0;
  for (const [x, z, extent] of [[s, c, p.length], [c, -s, p.width]]) {
    const normal = nx * x + nz * z, tangent = (tx * x + tz * z) * extent;
    if (Math.abs(normal) < 0.015) span += Math.abs(tangent);
    else middle += Math.sign(normal) * tangent;
  }
  return [middle - span, middle + span];
}

export function boxContact(a: Footprint, b: Footprint): Contact | undefined {
  const dx = a.x - b.x, dz = a.z - b.z;
  if (Math.abs(dx) + Math.abs(dz) > 2 * (a.length + a.width + b.length + b.width)) return;
  let nx = 0, nz = 0, depth = Infinity;
  for (const body of [a, b]) {
    const s = Math.sin(body.yaw), c = Math.cos(body.yaw);
    for (const [x, z] of [[s, c], [c, -s]]) {
      const d = dx * x + dz * z;
      const overlap = radius(a, x, z) + radius(b, x, z) - Math.abs(d);
      if (overlap <= 0) return;
      if (overlap < depth) {
        depth = overlap; nx = d >= 0 ? x : -x; nz = d >= 0 ? z : -z;
      }
    }
  }
  const tx = nz, tz = -nx;
  const ae = edge(a, -nx, -nz, tx, tz), be = edge(b, nx, nz, tx, tz);
  const t = (Math.max(ae[0], be[0]) + Math.min(ae[1], be[1])) * 0.5;
  const n = a.x * nx + a.z * nz - radius(a, nx, nz) + depth * 0.5;
  return { nx, nz, depth, x: nx * n + tx * t, z: nz * n + tz * t };
}

export function circleContact(a: Footprint, x: number, z: number, r: number): Contact | undefined {
  const s = Math.sin(a.yaw), c = Math.cos(a.yaw);
  const dx = x - a.x, dz = z - a.z, right = dx * c - dz * s, fore = dx * s + dz * c;
  const ex = Math.max(-a.width, Math.min(a.width, right)) - right;
  const ez = Math.max(-a.length, Math.min(a.length, fore)) - fore;
  const d = Math.hypot(ex, ez);
  if (d >= r) return;
  let lateral = ex / (d || 1), longitudinal = ez / (d || 1), depth = r - d;
  if (d < 0.00001) {
    const rx = a.width - Math.abs(right), rz = a.length - Math.abs(fore);
    if (rx < rz) lateral = -Math.sign(right || 1);
    else longitudinal = -Math.sign(fore || 1);
    depth += Math.min(rx, rz);
  }
  const nx = lateral * c + longitudinal * s, nz = longitudinal * c - lateral * s;
  return { nx, nz, depth, x: x + nx * r, z: z + nz * r };
}

/** Apply equal and opposite impulses at the contact patch, including angular momentum. */
export function resolveContact(a: Chassis, b: Chassis | null, hit: Contact): number {
  const { nx, nz, x, z } = hit;
  const invMassA = 1 / a.mass, invMassB = b ? 1 / b.mass : 0;
  const invInertiaA = 3 * invMassA / (a.length ** 2 + a.width ** 2);
  const invInertiaB = b ? 3 * invMassB / (b.length ** 2 + b.width ** 2) : 0;
  const ax = x - a.x, az = z - a.z, bx = b ? x - b.x : 0, bz = b ? z - b.z : 0;
  const rvx = a.vx + a.spin * az - (b ? b.vx + b.spin * bz : 0);
  const rvz = a.vz - a.spin * ax - (b ? b.vz - b.spin * bx : 0);
  const closing = -(rvx * nx + rvz * nz);
  const shift = Math.max(0, hit.depth - 0.001) / (invMassA + invMassB);
  a.x += nx * shift * invMassA; a.z += nz * shift * invMassA;
  if (b) { b.x -= nx * shift * invMassB; b.z -= nz * shift * invMassB; }
  if (closing <= 0) return 0;
  const leverA = az * nx - ax * nz, leverB = bz * nx - bx * nz;
  const restitution = closing > 2 ? 0.14 : 0;
  const impulse = closing * (1 + restitution) / (invMassA + invMassB + leverA * leverA * invInertiaA + leverB * leverB * invInertiaB);
  const tangentLeverA = az * nz + ax * nx, tangentLeverB = bz * nz + bx * nx;
  const slip = -(rvx * nz - rvz * nx) / (invMassA + invMassB + tangentLeverA * tangentLeverA * invInertiaA + tangentLeverB * tangentLeverB * invInertiaB);
  const friction = Math.max(-0.42 * impulse, Math.min(0.42 * impulse, slip));
  const ix = impulse * nx + friction * nz, iz = impulse * nz - friction * nx;
  a.vx += ix * invMassA; a.vz += iz * invMassA; a.spin += (az * ix - ax * iz) * invInertiaA;
  if (b) { b.vx -= ix * invMassB; b.vz -= iz * invMassB; b.spin -= (bz * ix - bx * iz) * invInertiaB; }
  return closing;
}
