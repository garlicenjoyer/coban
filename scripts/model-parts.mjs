import * as T from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const vec = (p) => new T.Vector3(...p);
const paint = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.87 });
const matrix = new T.Matrix4();

export function group(parent, name, position = [0, 0, 0]) {
  const result = new T.Group();
  result.name = name;
  result.position.fromArray(position);
  parent?.add(result);
  return result;
}

export class Parts {
  geometries = [];

  add(geometry, color, position = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0], grain = 0.035) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    matrix.compose(vec(position), new T.Quaternion().setFromEuler(new T.Euler(...rotation)), vec(scale));
    g.applyMatrix4(matrix);
    const rgb = new Float32Array(g.attributes.position.count * 3);
    const p = g.attributes.position;
    const c = new T.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      c.set(typeof color === 'function' ? color(x, y, z) : color);
      const pattern = Math.sin(x * 33 + z * 27) * Math.cos(z * 49 - y * 35);
      c.multiplyScalar(1 + pattern * grain);
      c.toArray(rgb, i * 3);
    }
    g.deleteAttribute('uv');
    g.setAttribute('color', new T.BufferAttribute(rgb, 3));
    this.geometries.push(g);
    return this;
  }

  oval(position, scale, color, rotation, detail = 12, grain) {
    return this.add(new T.SphereGeometry(1, detail, Math.ceil(detail * 0.65)), color, position, scale, rotation, grain);
  }

  box(position, scale, color, rotation) {
    return this.add(new T.BoxGeometry(...scale), color, position, undefined, rotation);
  }

  rod(a, b, radiusA, radiusB, color, sides = 10) {
    const start = vec(a), end = vec(b);
    const delta = end.clone().sub(start);
    const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), delta.clone().normalize());
    return this.add(new T.CylinderGeometry(radiusB, radiusA, delta.length(), sides), color,
      start.lerp(end, 0.5).toArray(), undefined, new T.Euler().setFromQuaternion(q).toArray().slice(0, 3));
  }

  /** Elliptical cross-sections swept through a curve. Each row is center xyz, then half widths. */
  sweep(sections, color, sides = 12, smooth = 3, firstAxis) {
    const centers = new T.CatmullRomCurve3(sections.map((s) => vec(s.slice(0, 3))), false, 'catmullrom', 0.4);
    const steps = (sections.length - 1) * smooth;
    const frames = centers.computeFrenetFrames(steps);
    const preferred = firstAxis && vec(firstAxis);
    const position = [];
    const indices = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const center = centers.getPointAt(t);
      const tangent = frames.tangents[i];
      const normal = preferred
        ? preferred.clone().addScaledVector(tangent, -preferred.dot(tangent)).normalize()
        : frames.normals[i];
      const binormal = preferred ? new T.Vector3().crossVectors(tangent, normal) : frames.binormals[i];
      // Sample sections in the same parameter space as their centers.
      const along = centers.getUtoTmapping(t) * (sections.length - 1);
      const row = Math.min(sections.length - 2, Math.floor(along));
      const rx = T.MathUtils.lerp(sections[row][3], sections[row + 1][3], along - row);
      const ry = T.MathUtils.lerp(sections[row][4], sections[row + 1][4], along - row);
      for (let k = 0; k < sides; k++) {
        const angle = k / sides * Math.PI * 2;
        const p = center.clone().addScaledVector(normal, Math.cos(angle) * rx)
          .addScaledVector(binormal, Math.sin(angle) * ry);
        position.push(...p.toArray());
        if (i < steps) {
          const a = i * sides + k, b = i * sides + (k + 1) % sides;
          indices.push(a, b, a + sides, b, b + sides, a + sides);
        }
      }
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return this.add(geometry, color);
  }

  torus(position, major, minor, color, rotation, scale, arc = Math.PI * 2, segments = 36) {
    return this.add(new T.TorusGeometry(major, minor, 8, segments, arc), color, position, scale, rotation);
  }

  mesh(parent, name, position) {
    const result = new T.Mesh(mergeVertices(mergeGeometries(this.geometries)), paint);
    result.name = name;
    if (position) result.position.fromArray(position);
    parent.add(result);
    return result;
  }
}
