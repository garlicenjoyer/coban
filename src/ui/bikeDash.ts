// Riding read-out (greybox stand-in for the bike's own dash): speed, range, rev bar,
// surface, slide warning, foot-down, the kick-start timing ring and the lap timer.

import { config } from '../core/config';
import type { EventBus } from '../core/events';
import type { Sim } from '../sim';
import { SURFACE_NAMES } from '../world/terrain';
import { CAN_LITERS } from '../world/water';

const DEG = Math.PI / 180;
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

const REPAIRED: Record<string, string> = {
  tyre: 'Patched and pumped up. Firm again.',
  pump: 'Pumped up.',
  fuel: 'A full tank, shaken well.',
  plug: 'A clean plug, gapped right. She’ll start on the first kick.',
  carb: 'The jet is clear. She pulls again.',
  chain: 'Oiled and tensioned. Quiet.',
};

export class BikeDash {
  private el: HTMLDivElement;
  private ring: SVGSVGElement;
  private needle: SVGLineElement;
  private flashText = '';
  private flashUntil = 0;
  private lastHtml = '';

  constructor(
    private sim: () => Sim,
    events: EventBus,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'dash';
    document.body.appendChild(this.el);

    const NS = 'http://www.w3.org/2000/svg';
    this.ring = document.createElementNS(NS, 'svg');
    this.ring.id = 'kickring';
    this.ring.setAttribute('viewBox', '-60 -60 120 120');
    const k = config.bike.kick;
    const arc = (a0: number, a1: number) => {
      const p = (a: number) => [Math.sin(a * Math.PI * 2) * 46, -Math.cos(a * Math.PI * 2) * 46];
      const [x0, y0] = p(a0);
      const [x1, y1] = p(a1);
      return `M ${x0} ${y0} A 46 46 0 ${a1 - a0 > 0.5 ? 1 : 0} 1 ${x1} ${y1}`;
    };
    this.ring.innerHTML =
      `<circle r="46" fill="rgba(24,20,16,0.6)" stroke="#9a8f80" stroke-width="6"/>` +
      `<path d="${arc(k.windowStart, k.windowEnd)}" stroke="#6fcf97" stroke-width="8" fill="none"/>` +
      `<text y="62" text-anchor="middle" fill="#f4efe6" font-size="11" font-family="system-ui">Space / A — kick</text>`;
    this.needle = document.createElementNS(NS, 'line');
    this.needle.setAttribute('x1', '0');
    this.needle.setAttribute('y1', '0');
    this.needle.setAttribute('stroke', '#ffd98a');
    this.needle.setAttribute('stroke-width', '4');
    this.needle.setAttribute('stroke-linecap', 'round');
    this.ring.appendChild(this.needle);
    document.body.appendChild(this.ring);

    events.on('bikeKick', (e) => {
      if (e.success) return;
      const c = this.sim().bike.care;
      this.flash(c.empty ? 'Kick! …nothing. The tank is dry.' : this.sim().bike.kickInWindow ? 'Kick! …a cough. The plug is tired: kick again, or clean it.' : 'Kick! …nothing. Wait for the green.');
    });
    events.on('bikeFault', (e) =>
      this.flash(e.kind === 'misfire' ? 'Pop — a misfire. The spark plug wants cleaning.' : e.kind === 'skip' ? 'Clank — the chain skipped. It wants oil.' : 'She sputters: nearly out of fuel.'),
    );
    events.on('bikePuncture', () => this.flash('Psss… a thorn in the tyre. It’s going soft.'));
    events.on('bikeRepaired', (e) => this.flash(REPAIRED[e.job] ?? 'Done.'));
    events.on('bikeEngine', (e) => {
      if (e.on) this.flash('Ring-ding-ding — she starts.');
      else if (e.reason === 'stall') this.flash(this.sim().bike.care.carb < config.bikeCare.symptom ? 'Stalled at idle. The carb is choked with dust.' : 'Stalled. Kick it again.');
      else if (e.reason === 'empty') this.flash('She coughs and dies. Out of fuel.');
    });
    events.on('bikeFall', (e) => this.flash(`You came off: ${e.reason}. Hold E by the bike to lift it.`));
    events.on('lap', (e) => this.flash(`Lap ${fmt(e.seconds)}${e.clean ? '' : ' (with a fall)'} · best ${e.best > 0 ? fmt(e.best) : '—'}`));
  }

  private flash(text: string): void {
    this.flashText = text;
    this.flashUntil = performance.now() + 3200;
  }

  update(): void {
    const sim = this.sim();
    const b = sim.bike;
    const riding = b.rider;
    this.el.style.display = riding || performance.now() < this.flashUntil ? 'block' : 'none';
    const showRing = riding && !b.engineOn && b.state === 'riding';
    this.ring.style.display = showRing ? 'block' : 'none';
    if (showRing) {
      const a = b.kickPhase * Math.PI * 2;
      this.needle.setAttribute('x2', String(Math.sin(a) * 40));
      this.needle.setAttribute('y2', String(-Math.cos(a) * 40));
      this.needle.setAttribute('stroke', b.kickInWindow ? '#6fcf97' : '#ffd98a');
    }
    const e = config.bike.engine;
    const rpmPct = Math.min(100, (b.rpm / e.redline) * 100);
    const lap = sim.lap;
    const lapLine = lap.running ? `Lap ${fmt(lap.t)}${lap.best > 0 ? ` · best ${fmt(lap.best)}` : ''}` : lap.best > 0 ? `Best lap ${fmt(lap.best)}` : '';
    const sliding = Math.abs(b.beta) > 10 * DEG;
    const html = riding
      ? `<div class="spd"><b>${Math.round(b.kmh)}</b> km/h <span>${b.engineOn ? `${b.gear}${['st', 'nd', 'rd'][b.gear - 1]}` : 'engine off'}</span></div>` +
        `<div class="rpm"><i style="width:${rpmPct}%" class="${b.rpm > e.upshiftRpm ? 'hi' : ''}"></i></div>` +
        `<div class="row">${SURFACE_NAMES[b.surfaceRear]}${sliding ? ' · <em>SLIDE — steer into it</em>' : ''}${b.wheelspin > 0.15 ? ' · <em>wheelspin</em>' : ''}${b.footDown >= 1 && b.speed < 0.5 ? ' · foot down' : ''}${b.lamp ? ' · lamp' : ''}</div>` +
        `<div class="row fuel">E <i><b style="width:${Math.round((b.care.fuel / config.bikeCare.tank) * 100)}%" class="${b.care.fuel < 1 ? 'lo' : ''}"></b></i> F${b.care.pressure < config.bikeCare.wobbleBelow ? ' · <em>soft tyre</em>' : ''}</div>` +
        (b.waterCans ? `<div class="row">Rack · ${b.waterCans * CAN_LITERS} L water</div>` : '') +
        (lapLine ? `<div class="row">${lapLine}</div>` : '') +
        (performance.now() < this.flashUntil ? `<div class="flash">${this.flashText}</div>` : '')
      : `<div class="flash">${this.flashText}</div>`;
    if (html !== this.lastHtml) {
      this.el.innerHTML = html;
      this.lastHtml = html;
    }
  }
}
