// The paper map (GDD: Diegetic UI). M / View opens it, held in both hands; the world keeps
// running. A hand-drawn sheet of the valley (contours from the real heightfield, pastures,
// springs, roads, the ağıl, the grove, forest and ruin) with live pencil notes: pastures
// hatched as they are grazed ("let it rest", fading as the grass returns), "wolves" by the
// den once you have heard them, a circle round the current task's destination, and your
// own pencil crosses. No "you are here" dot unless the assist is on: you find yourself by
// landmarks and the compass.

import { config } from '../core/config';
import type { EventBus } from '../core/events';
import type { Sim } from '../sim';
import { GrassMap } from '../world/grassMap';
import { activeMap, layout, type BoxProp, type CylProp } from '../world/map';

const SIZE = 900;
/** Px per metre: 2.1 on the 400 m test map, the whole map always fits the sheet. */
let SCALE = 2.1;
const fitScale = () => (SCALE = (2.1 * 400) / activeMap().size);
const px = (x: number) => SIZE / 2 + x * SCALE;
const py = (z: number) => SIZE / 2 + z * SCALE;
const INK = 'rgba(70, 52, 36, 0.85)';
const PENCIL = 'rgba(80, 64, 48, 0.55)';

export const mapSettings = { showMyPosition: true };

/** Pencil marks belong to one map: the test map keeps its old keys. */
const storeKey = (k: string) => (activeMap().id === 'test' ? `coban.${k}` : `coban.${activeMap().id}.${k}`);

export class PaperMap {
  private el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  private open = false;
  private marks: { x: number; z: number }[] = [];
  /** Routes pencilled before setting out (drag on the map). */
  private routes: { x: number; z: number }[][] = [];
  private stroke: { x: number; z: number }[] | null = null;
  private heardWolves = false;
  /** Each pasture's ungrazed grass, from a fresh grass map of the same valley. */
  private baseline: number[] | null = null;
  private lastDraw = 0;
  private padPrev = false;
  onToggle: (open: boolean) => void = () => {};

  constructor(
    private sim: () => Sim,
    events: EventBus,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'papermap';
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SIZE;
    this.ctx = this.canvas.getContext('2d')!;
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Drag: pencil a route · click: a mark · right-click: rub out · M: fold the map away';
    this.el.append(this.canvas, hint);
    document.body.appendChild(this.el);
    try {
      this.marks = JSON.parse(localStorage.getItem(storeKey('mapMarks')) ?? '[]');
      this.routes = JSON.parse(localStorage.getItem(storeKey('mapRoutes')) ?? '[]');
    } catch {
      this.marks = [];
      this.routes = [];
    }

    events.on('howl', () => (this.heardWolves = true));
    events.on('nightReport', () => (this.heardWolves = true));
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyM') this.toggle();
      else if (e.code === 'Escape' && this.open) this.toggle(false);
    });
    const toWorld = (e: MouseEvent) => {
      const r = this.canvas.getBoundingClientRect();
      const mx = ((e.clientX - r.left) / r.width) * SIZE;
      const mz = ((e.clientY - r.top) / r.height) * SIZE;
      return { x: (mx - SIZE / 2) / SCALE, z: (mz - SIZE / 2) / SCALE };
    };
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.open) return;
      e.stopPropagation();
      const { x, z } = toWorld(e);
      if (e.button === 2) {
        // Rub out the nearest mark or route.
        let best = -1;
        let bestRoute = -1;
        let bd = 12 / SCALE;
        this.marks.forEach((m, i) => {
          const d = Math.hypot(m.x - x, m.z - z);
          if (d < bd) {
            bd = d;
            best = i;
          }
        });
        this.routes.forEach((rt, i) => {
          for (const q of rt) {
            const d = Math.hypot(q.x - x, q.z - z);
            if (d < bd) {
              bd = d;
              bestRoute = i;
              best = -1;
            }
          }
        });
        if (bestRoute >= 0) this.routes.splice(bestRoute, 1);
        else if (best >= 0) this.marks.splice(best, 1);
        this.save();
        this.draw();
        return;
      }
      this.stroke = [{ x, z }];
    });
    this.canvas.addEventListener('mousemove', (e) => {
      if (!this.stroke) return;
      const q = toWorld(e);
      const last = this.stroke[this.stroke.length - 1];
      if (Math.hypot(q.x - last.x, q.z - last.z) * SCALE > 5) {
        this.stroke.push(q);
        this.draw();
      }
    });
    window.addEventListener('mouseup', () => {
      const st = this.stroke;
      if (!st) return;
      this.stroke = null;
      if (st.length >= 3) this.routes.push(st);
      else this.marks.push(st[0]);
      this.save();
      this.draw();
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private save(): void {
    try {
      localStorage.setItem(storeKey('mapMarks'), JSON.stringify(this.marks));
      localStorage.setItem(storeKey('mapRoutes'), JSON.stringify(this.routes));
    } catch {
      /* marks just won't persist */
    }
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.el.classList.toggle('up', this.open);
    if (this.open) {
      if (document.pointerLockElement) document.exitPointerLock();
      this.draw();
    }
    this.onToggle(this.open);
  }

  update(): void {
    // Gamepad View / Back button toggles.
    let pad: Gamepad | null = null;
    for (const g of navigator.getGamepads ? navigator.getGamepads() : []) if (g && g.connected) pad = pad ?? g;
    const pressed = !!pad?.buttons[8]?.pressed;
    if (pressed && !this.padPrev) this.toggle();
    this.padPrev = pressed;
    if (this.open && performance.now() - this.lastDraw > 500) this.draw();
  }

  // ---------------------------------------------------------------- drawing

  private paperBase(): HTMLCanvasElement {
    if (this.base) return this.base;
    fitScale();
    const sim = this.sim();
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const g = c.getContext('2d')!;

    // Paper: warm cream, grain, darker edges, two fold lines.
    g.fillStyle = '#efe3c3';
    g.fillRect(0, 0, SIZE, SIZE);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(110, 85, 50, ${rnd() * 0.06})`;
      g.fillRect(rnd() * SIZE, rnd() * SIZE, 1.5, 1.5);
    }
    const edge = g.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.3, SIZE / 2, SIZE / 2, SIZE * 0.75);
    edge.addColorStop(0, 'rgba(0,0,0,0)');
    edge.addColorStop(1, 'rgba(120, 85, 40, 0.28)');
    g.fillStyle = edge;
    g.fillRect(0, 0, SIZE, SIZE);
    g.strokeStyle = 'rgba(120, 90, 50, 0.12)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(SIZE / 2, 0);
    g.lineTo(SIZE / 2, SIZE);
    g.moveTo(0, SIZE / 2);
    g.lineTo(SIZE, SIZE / 2);
    g.stroke();

    // Contours from the heightfield (marching squares; 4 m grid and 2.5 m interval on the
    // test map, coarser on bigger maps so the sheet stays readable).
    const t = sim.terrain;
    const half = activeMap().size / 2;
    const step = half > 200 ? 8 : 4;
    const interval = half > 200 ? 5 : 2.5;
    const n = Math.floor((half * 2) / step);
    const H: number[] = [];
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) H.push(t.heightAt(-half + i * step, -half + j * step));
    const hAt = (i: number, j: number) => H[j * (n + 1) + i];
    const lo = Math.min(...H);
    const hi = Math.max(...H);
    for (let lvl = Math.ceil(lo / interval) * interval, k = 0; lvl < hi; lvl += interval, k++) {
      g.strokeStyle = Math.round(lvl / interval) % 4 === 0 ? 'rgba(130, 90, 50, 0.45)' : 'rgba(130, 90, 50, 0.2)';
      g.lineWidth = Math.round(lvl / interval) % 4 === 0 ? 1.3 : 0.8;
      g.beginPath();
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          const a = hAt(i, j);
          const b = hAt(i + 1, j);
          const cc = hAt(i + 1, j + 1);
          const d = hAt(i, j + 1);
          const pts: [number, number][] = [];
          const edgePt = (v0: number, v1: number, x0: number, z0: number, x1: number, z1: number) => {
            if ((v0 < lvl) === (v1 < lvl)) return;
            const f = (lvl - v0) / (v1 - v0);
            pts.push([x0 + (x1 - x0) * f, z0 + (z1 - z0) * f]);
          };
          const X = -half + i * step;
          const Z = -half + j * step;
          edgePt(a, b, X, Z, X + step, Z);
          edgePt(b, cc, X + step, Z, X + step, Z + step);
          edgePt(cc, d, X + step, Z + step, X, Z + step);
          edgePt(d, a, X, Z + step, X, Z);
          for (let p = 0; p + 1 < pts.length; p += 2) {
            g.moveTo(px(pts[p][0]), py(pts[p][1]));
            g.lineTo(px(pts[p + 1][0]), py(pts[p + 1][1]));
          }
        }
      g.stroke();
    }

    const label = (text: string, x: number, z: number, size = 15, color = INK) => {
      g.font = `italic ${size}px Georgia, 'Times New Roman', serif`;
      g.fillStyle = color;
      g.textAlign = 'center';
      g.fillText(text, px(x), py(z));
    };

    // Pastures: watercolour washes.
    for (const pa of layout.pastures) {
      const wash = g.createRadialGradient(px(pa.x), py(pa.z), 2, px(pa.x), py(pa.z), pa.r * SCALE);
      wash.addColorStop(0, 'rgba(120, 170, 80, 0.38)');
      wash.addColorStop(1, 'rgba(120, 170, 80, 0.08)');
      g.fillStyle = wash;
      g.beginPath();
      g.arc(px(pa.x), py(pa.z), pa.r * SCALE, 0, Math.PI * 2);
      g.fill();
      label(`Pasture ${pa.id}`, pa.x, pa.z + 4, 16);
    }

    // The map's own features: roads, riverbeds, mud, cliffs, area names.
    activeMap().sketch({ g, px, py, scale: SCALE, label, ink: INK, pencil: PENCIL, rnd });

    // Props: walls, olives, trees, rocks, thorns, ruin columns.
    for (const p of sim.map.props) {
      if (p.kind === 'box' && p.role === 'wall') {
        const w = p as BoxProp;
        g.strokeStyle = 'rgba(90, 70, 50, 0.7)';
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(px(w.x - w.hx), py(w.z - w.hz));
        g.lineTo(px(w.x + w.hx), py(w.z + w.hz));
        g.stroke();
      }
      if (p.kind !== 'cyl') continue;
      const c2 = p as CylProp;
      const X = px(c2.x);
      const Z = py(c2.z);
      if (c2.role === 'olive') {
        g.fillStyle = 'rgba(110, 130, 80, 0.75)';
        g.beginPath();
        g.arc(X, Z, 3.2, 0, Math.PI * 2);
        g.fill();
      } else if (c2.role === 'trunk' || c2.role === 'pine' || c2.role === 'cypress') {
        g.fillStyle = 'rgba(70, 100, 60, 0.75)';
        g.beginPath();
        g.moveTo(X, Z - 6);
        g.lineTo(X + 4, Z + 3);
        g.lineTo(X - 4, Z + 3);
        g.closePath();
        g.fill();
      } else if (c2.role === 'rock') {
        g.fillStyle = 'rgba(100, 90, 80, 0.6)';
        g.fillRect(X - 1.5, Z - 1.5, 3, 3);
      } else if (c2.role === 'thorn') {
        g.strokeStyle = 'rgba(100, 80, 50, 0.6)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(X - 2.5, Z - 2.5);
        g.lineTo(X + 2.5, Z + 2.5);
        g.moveTo(X + 2.5, Z - 2.5);
        g.lineTo(X - 2.5, Z + 2.5);
        g.stroke();
      } else if (c2.role === 'cairn') {
        // Uncle Ahmet's cairns: little pencilled stacks along his routes.
        g.fillStyle = 'rgba(90, 75, 60, 0.75)';
        g.beginPath();
        g.moveTo(X, Z - 4);
        g.lineTo(X + 3, Z + 2);
        g.lineTo(X - 3, Z + 2);
        g.closePath();
        g.fill();
      } else if (c2.role === 'column') {
        g.fillStyle = 'rgba(90, 80, 70, 0.8)';
        g.beginPath();
        g.arc(X, Z, 2.2, 0, Math.PI * 2);
        g.fill();
      }
    }

    // Homestead: the ağıl and the cottage.
    const pen = layout.pen;
    g.strokeStyle = INK;
    g.lineWidth = 1.8;
    g.strokeRect(px(pen.x - pen.hx), py(pen.z - pen.hz), pen.hx * 2 * SCALE, pen.hz * 2 * SCALE);
    label('ağıl', pen.x, pen.z + 2, 13);
    const hs = layout.house;
    const hx = px(hs.x);
    const hz = py(hs.z);
    g.fillStyle = 'rgba(190, 100, 60, 0.85)';
    g.beginPath();
    g.moveTo(hx - 9, hz - 2);
    g.lineTo(hx, hz - 10);
    g.lineTo(hx + 9, hz - 2);
    g.closePath();
    g.fill();
    g.strokeStyle = INK;
    g.strokeRect(hx - 7, hz - 2, 14, 9);
    label('home', hs.x, hs.z + 9, 13);

    // Water: springs and the çeşme, in blue.
    for (const w of sim.water.points) {
      if (w.kind === 'basin') continue;
      g.fillStyle = 'rgba(60, 120, 170, 0.75)';
      g.beginPath();
      g.arc(px(w.x), py(w.z), w.kind === 'trough' ? 3 : 4.5, 0, Math.PI * 2);
      g.fill();
      if (w.kind !== 'trough') label(w.name, w.x, w.z - 5, 12, 'rgba(50, 100, 150, 0.9)');
    }

    // Cartouche, compass rose and scale bar.
    g.font = `italic 22px Georgia, 'Times New Roman', serif`;
    g.fillStyle = INK;
    g.textAlign = 'left';
    g.fillText(activeMap().title, 34, 46);
    const rx = SIZE - 70;
    const ry = 78;
    g.strokeStyle = INK;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(rx, ry - 34);
    g.lineTo(rx + 7, ry);
    g.lineTo(rx, ry + 34);
    g.lineTo(rx - 7, ry);
    g.closePath();
    g.stroke();
    g.fillStyle = 'rgba(160, 60, 40, 0.8)';
    g.beginPath();
    g.moveTo(rx, ry - 34);
    g.lineTo(rx + 7, ry);
    g.lineTo(rx - 7, ry);
    g.closePath();
    g.fill();
    g.font = `italic 15px Georgia, serif`;
    g.fillStyle = INK;
    g.textAlign = 'center';
    g.fillText('N', rx, ry - 40);
    g.beginPath();
    const bar = activeMap().size > 400 ? 100 : 50;
    g.moveTo(40, SIZE - 40);
    g.lineTo(40 + bar * SCALE, SIZE - 40);
    g.moveTo(40, SIZE - 46);
    g.lineTo(40, SIZE - 34);
    g.moveTo(40 + bar * SCALE, SIZE - 46);
    g.lineTo(40 + bar * SCALE, SIZE - 34);
    g.stroke();
    g.font = `italic 13px Georgia, serif`;
    g.fillText(`${bar} m`, 40 + (bar / 2) * SCALE, SIZE - 48);

    this.base = c;
    return c;
  }

  private draw(): void {
    this.lastDraw = performance.now();
    const sim = this.sim();
    const g = this.ctx;
    g.drawImage(this.paperBase(), 0, 0);

    // Grazing notes: hatch a pasture as it is eaten down; the note fades as it regrows.
    if (!this.baseline) {
      const fresh = new GrassMap(sim.terrain);
      this.baseline = layout.pastures.map((pa) => fresh.meanIn(pa.x, pa.z, pa.r));
    }
    const init = this.baseline;
    layout.pastures.forEach((pa, i) => {
      const grazed = Math.max(0, (init[i] - sim.grass.meanIn(pa.x, pa.z, pa.r)) / Math.max(0.01, init[i]));
      if (grazed < 0.06) return;
      const a = Math.min(0.8, grazed * 3);
      g.save();
      g.beginPath();
      g.arc(px(pa.x), py(pa.z), pa.r * SCALE, 0, Math.PI * 2);
      g.clip();
      g.strokeStyle = `rgba(80, 64, 48, ${a * 0.5})`;
      g.lineWidth = 1;
      for (let d = -pa.r * 2; d < pa.r * 2; d += 3) {
        g.beginPath();
        g.moveTo(px(pa.x + d - pa.r), py(pa.z - pa.r));
        g.lineTo(px(pa.x + d + pa.r), py(pa.z + pa.r));
        g.stroke();
      }
      g.restore();
      g.font = `italic 13px Georgia, serif`;
      g.fillStyle = `rgba(80, 64, 48, ${Math.min(1, a + 0.2)})`;
      g.textAlign = 'center';
      g.fillText(`grazed · let it rest${grazed > 0.3 ? ' a few days' : ''}`, px(pa.x), py(pa.z + pa.r + 6));
    });

    // Wolves, once heard.
    if (this.heardWolves) {
      const d = layout.wolfDen;
      g.font = `italic 15px Georgia, serif`;
      g.fillStyle = 'rgba(120, 40, 30, 0.75)';
      g.textAlign = 'center';
      g.fillText('wolves', px(d.x), py(d.z));
      g.strokeStyle = 'rgba(120, 40, 30, 0.5)';
      g.setLineDash([3, 4]);
      g.beginPath();
      g.arc(px(d.x), py(d.z) - 5, 22, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }

    // Wolf ground, once you've read its signs: a dashed boundary to plan routes around.
    if (sim.signsSeen.size) {
      const d = layout.wolfDen;
      const R = config.territory.radius;
      g.strokeStyle = 'rgba(130, 40, 30, 0.55)';
      g.lineWidth = 1.5;
      g.setLineDash([8, 6]);
      g.beginPath();
      g.arc(px(d.x), py(d.z), R * SCALE, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      g.font = `italic 13px Georgia, serif`;
      g.fillStyle = 'rgba(130, 40, 30, 0.8)';
      g.textAlign = 'center';
      g.fillText('wolf ground · keep the flock out', px(d.x + 18), py(d.z + R + 9));
      for (const i of sim.signsSeen) {
        const sg = layout.wolfSigns[i];
        g.fillText('×', px(sg.x), py(sg.z) + 4);
      }
    }

    // What you've built: the hut and fold, the cistern (or their stakes), and cairns.
    const hut = sim.works.site('hut');
    const fo = layout.works.fold;
    const hb = layout.works.hut;
    g.strokeStyle = hut.built ? INK : 'rgba(80, 64, 48, 0.45)';
    g.setLineDash(hut.built ? [] : [3, 3]);
    g.lineWidth = 1.5;
    g.strokeRect(px(hb.x - hb.hx), py(hb.z - hb.hz), hb.hx * 2 * SCALE, hb.hz * 2 * SCALE);
    g.beginPath();
    g.moveTo(px(fo.xMax), py(fo.zMin));
    g.lineTo(px(fo.xMin), py(fo.zMin));
    g.lineTo(px(fo.xMin), py(fo.zMax));
    g.lineTo(px(fo.xMax), py(fo.zMax));
    g.stroke();
    g.setLineDash([]);
    g.font = `italic 12px Georgia, serif`;
    g.fillStyle = hut.built ? INK : PENCIL;
    g.textAlign = 'center';
    g.fillText(hut.built ? (hut.repair ? 'hut · fold, mended' : 'hut · fold') : hut.repair ? 'fallen hut' : 'hut? (stakes)', px(hb.x), py(hb.z - hb.hz - 3));
    const cs = layout.works.cistern;
    const cBuilt = sim.works.built('cistern');
    g.strokeStyle = cBuilt ? 'rgba(60, 120, 170, 0.85)' : 'rgba(80, 64, 48, 0.45)';
    g.setLineDash(cBuilt ? [] : [3, 3]);
    g.beginPath();
    g.arc(px(cs.x), py(cs.z), 4, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = cBuilt ? 'rgba(50, 100, 150, 0.9)' : PENCIL;
    g.fillText(cBuilt ? 'cistern' : 'cistern? (stakes)', px(cs.x), py(cs.z - 6));
    g.fillStyle = 'rgba(70, 60, 50, 0.9)';
    for (const c of sim.works.cairns) {
      const X = px(c.x);
      const Z = py(c.z);
      g.beginPath();
      g.moveTo(X, Z - 6);
      g.lineTo(X + 4, Z + 3);
      g.lineTo(X - 4, Z + 3);
      g.closePath();
      g.fill();
    }

    const marker = (x: number, z: number, label: string, color: string, offset: number) => {
      g.fillStyle = color;
      g.fillRect(px(x) - 3, py(z) - 3, 6, 6);
      g.textAlign = 'right';
      g.font = 'bold 13px Georgia, serif';
      g.fillText(label, px(x) - 7, py(z) + offset);
    };
    if (sim.notesRead.has('museum1')) marker(-170, 40, 'Old Roman road', INK, 0);
    if (sim.notesRead.has('museum2')) marker(layout.ruins.x - 30, layout.ruins.z - 40, 'Sacred spring', INK, 0);
    if (sim.notesRead.has('museum3')) marker(layout.hill.x + 30, layout.hill.z - 10, 'Ancient fold', INK, 0);
    marker(sim.bike.x, sim.bike.z, 'Your motorcycle', '#3f6172', -10);
    if (sim.sprint) {
      const gate = sim.sprint.marker;
      marker(gate.x, gate.z, gate.label, '#885322', 16);
    }

    // Active errands are small green diamonds beside the main task's pencil circle.
    for (const { errand, stop } of sim.errands.targets()) {
      const x = px(stop.x), z = py(stop.z);
      const left = errand.resident === 'emre' || errand.resident === 'hasan';
      const sign = left ? -1 : 1;
      g.strokeStyle = '#4a684d';
      g.fillStyle = '#f3e7c9';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x, z - 5);
      g.lineTo(x + 5, z);
      g.lineTo(x, z + 5);
      g.lineTo(x - 5, z);
      g.closePath();
      g.fill();
      g.stroke();
      g.font = 'italic 13px Georgia, serif';
      g.textAlign = left ? 'right' : 'left';
      g.fillStyle = '#365540';
      g.fillText(errand.title, x + sign * 9, z + 15);
    }

    // Your pencilled routes.
    g.strokeStyle = 'rgba(60, 45, 35, 0.7)';
    g.lineWidth = 2;
    g.lineJoin = 'round';
    for (const rt of this.stroke ? [...this.routes, this.stroke] : this.routes) {
      g.beginPath();
      rt.forEach((q, i) => (i ? g.lineTo(px(q.x), py(q.z)) : g.moveTo(px(q.x), py(q.z))));
      g.stroke();
    }

    // Your pencil marks.
    g.strokeStyle = 'rgba(60, 45, 35, 0.85)';
    g.lineWidth = 2;
    for (const m of this.marks) {
      g.beginPath();
      g.moveTo(px(m.x) - 6, py(m.z) - 6);
      g.lineTo(px(m.x) + 6, py(m.z) + 6);
      g.moveTo(px(m.x) + 6, py(m.z) - 6);
      g.lineTo(px(m.x) - 6, py(m.z) + 6);
      g.stroke();
    }

    // Assist only: where you are.
    if (mapSettings.showMyPosition) {
      const p = sim.player.pos;
      g.fillStyle = 'rgba(180, 60, 40, 0.9)';
      g.beginPath();
      g.arc(px(p.x), py(p.z), 5, 0, Math.PI * 2);
      g.fill();
    }
  }
}
