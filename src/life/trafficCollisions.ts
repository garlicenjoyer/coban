import type { Bike } from '../bike/bike';
import { config } from '../core/config';
import type { EventBus } from '../core/events';
import type { Resident, Residents } from './residents';
import { RoadVehicle } from './roadVehicle';
import { boxContact, resolveContact, type Chassis } from './chassisContact';

interface TrafficBody { body: Chassis; y: number; owner?: Resident; bike?: Bike }

/** The bike and AI routes retain their own controllers. All vehicles meet in the same contact solver. */
export function collideTraffic(residents: Residents, driven: RoadVehicle | null, bike: Bike, tick: number, events: EventBus): void {
  const cars: TrafficBody[] = [];
  for (const owner of residents.list) {
    if (!owner.driving && !owner.vehicle) continue;
    const body = owner.trafficChassis();
    cars.push({ body, owner, y: body.y });
  }
  if (driven && !cars.some(c => c.body === driven)) cars.push({ body: driven, y: driven.y });
  if (!cars.length) return;
  cars.push({ body: { x: bike.x, z: bike.z, yaw: bike.heading, width: 0.35, length: 0.99,
    mass: config.bike.mass, vx: bike.vx, vz: bike.vz, spin: bike.impactSpin }, y: bike.y, bike });

  for (const [i, a] of cars.entries()) {
    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j];
      if (Math.abs(a.y - b.y) > 2.4 || Math.abs(a.body.x - b.body.x) > 5 || Math.abs(a.body.z - b.body.z) > 5) continue;
      const contact = boxContact(a.body, b.body);
      if (!contact) continue;
      const speed = resolveContact(a.body, b.body, contact);
      if (speed === 0 && contact.depth <= 0.00101) continue;
      for (const car of [a, b]) {
        if (car.body instanceof RoadVehicle) car.body.constrain();
        if (car.bike) car.bike.trafficImpact(car.body, speed, tick);
        if (!car.owner?.driving) continue;
        car.owner.afterCollision();
        // A hard crash dislodges the driver. The moving chassis and the person's skeleton then separate.
        if (speed >= 7.5) {
          const dir = car === a ? 1 : -1;
          car.owner.releaseVehicle();
          events.emit('driverThrown', { resident: car.owner, dx: dir * contact.nx, dz: dir * contact.nz, speed });
        }
      }
      if (speed > 1.5) events.emit('vehicleCrash', { x: contact.x, y: (a.y + b.y) / 2 + 0.6, z: contact.z, speed });
    }
  }
}
