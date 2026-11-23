// Builds the Rapier world for the test map: heightfield terrain, static props, map walls.

import type RAPIERType from '@dimforge/rapier3d-compat';
import { SIM_DT } from '../core/config';
import type { Terrain } from './terrain';
import type { MapProps } from './map';

export type Rapier = typeof RAPIERType;

export function createPhysicsWorld(R: Rapier, terrain: Terrain, map: MapProps) {
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = SIM_DT;

  // Terrain: heights are already in Rapier's column-major layout.
  const hf = R.ColliderDesc.heightfield(
    terrain.cells,
    terrain.cells,
    terrain.heights,
    { x: terrain.size, y: 1, z: terrain.size },
  ).setFriction(0.9);
  const terrainCollider = world.createCollider(hf);

  let gateCollider: RAPIERType.Collider | null = null;
  for (const p of map.props) {
    if (p.kind === 'box') {
      // A ramped box is a frustum (convex hull): its sloped edges can be walked up, since
      // the character controller's auto-step doesn't trigger for our capsule.
      const desc =
        p.ramp && p.ramp > 0
          ? R.ColliderDesc.convexHull(
              new Float32Array(
                [-1, 1].flatMap((sy) =>
                  [-1, 1].flatMap((sx) =>
                    [-1, 1].flatMap((sz) => {
                      const inset = sy > 0 ? p.ramp! : 0;
                      return [sx * (p.hx - inset), sy * p.hy, sz * (p.hz - inset)];
                    }),
                  ),
                ),
              ),
            )
          : R.ColliderDesc.cuboid(p.hx, p.hy, p.hz);
      if (!desc) throw new Error('bad collider for prop');
      const c = world.createCollider(desc.setTranslation(p.x, p.y, p.z));
      if (p.role === 'gate') gateCollider = c;
    } else if (p.role !== 'marker') {
      // Marker poles are greybox signposts: visual only.
      const hh = p.height / 2;
      world.createCollider(R.ColliderDesc.cylinder(hh, p.radius).setTranslation(p.x, p.y + hh, p.z));
    }
  }

  // Invisible walls at the map edge.
  const half = terrain.half;
  const wallH = 60;
  for (const [x, z, hx, hz] of [
    [half + 1, 0, 1, half + 2],
    [-half - 1, 0, 1, half + 2],
    [0, half + 1, half + 2, 1],
    [0, -half - 1, half + 2, 1],
  ] as const) {
    world.createCollider(R.ColliderDesc.cuboid(hx, wallH, hz).setTranslation(x, 0, z));
  }

  if (!gateCollider) throw new Error('test map has no pen gate');
  return { world, terrainCollider, gateCollider };
}
