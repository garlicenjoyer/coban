import type { EventBus } from '../core/events';
import type { Sim } from '../sim';
import { ITEMS, type ItemId } from '../player/satchel';
import { JOBS } from '../economy/economy';
import { season, weekday } from '../economy/calendar';

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

const clock = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export class TaskCard {
  private card: HTMLDivElement;
  private journal: HTMLDivElement;
  private banner: HTMLDivElement;
  private bannerUntil = 0;
  private journalOpen = false;
  private lastHtml = '';

  constructor(
    private sim: () => Sim,
    events: EventBus,
    private onDone: () => void,
  ) {
    this.card = document.createElement('div');
    this.card.id = 'taskcard';
    document.getElementById('left')!.appendChild(this.card);
    this.journal = document.createElement('div');
    this.journal.id = 'journal';
    this.journal.tabIndex = 0;
    document.body.appendChild(this.journal);
    this.banner = document.createElement('div');
    this.banner.id = 'taskdone';
    this.banner.setAttribute('role', 'status');
    document.body.appendChild(this.banner);

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyJ') this.setJournal(!this.journalOpen);
      else if (e.code === 'Escape' && this.journalOpen) this.setJournal(false);
    });
    events.on('sprintUpdate', e => {
      this.flash(e.text);
      if (!this.sim().sprint?.running) this.onDone();
    });
    events.on('slept', e => this.flash(`Day ${e.day} · morning`));
    // Notebook lines for the journey: what you used, built, found and reached.
    events.on('itemUsed', (e) => this.flash(e.text, e.ok ? 2600 : 2000));
    events.on('packed', (e) => this.flash(`Satchel: ${e.items.map((i) => ITEMS[i as ItemId]?.name.toLowerCase() ?? i).join(', ')}`));
    events.on('built', (e) => this.flash(e.id === 'cairn' ? 'A cairn: it will mark the way' : `${e.name[0].toUpperCase()}${e.name.slice(1)} is ${e.repair ? 'mended' : 'built'}. It will stand.`, 3200));
    const SIGN: Record<string, string> = { bones: 'old bones, picked clean', scat: 'wolf scat', tuft: 'a tuft of wool on a thorn', prints: 'big paw prints in the dust' };
    events.on('wolfSign', (e) => this.flash(`Wolf sign: ${SIGN[e.kind] ?? e.kind}. This is their ground.`, 3400));
    events.on('territoryWarn', () => this.flash('Karabaş stares into the trees, hackles up', 3000));
    events.on('arrival', (e) => this.flash(e.label[0].toUpperCase() + e.label.slice(1), 2600));
    events.on('dogHurt', () => this.flash('Karabaş is bitten! He limps: salve, or a night’s rest', 3600));
    events.on('dogTick', (e) => e.ticks === 1 && this.flash('Karabaş stops to scratch: a tick from the brush. Hold E beside him to pick it off', 3400));
    events.on('tickPicked', (e) => this.flash(e.left ? `A tick off. ${e.left} to go` : 'The last tick off. He shakes himself and leans on your leg', 2400));
    events.on('bowlFilled', (e) => this.flash(`You fill his bowl · ${e.sackLeft} meals left in the sack`, 2400));
    events.on('dogFed', (e) => e.how === 'bowl' && this.flash('Karabaş eats from his bowl', 2000));
    events.on('loaded', (e) =>
      this.flash(e.hour === undefined ? `Welcome back. Day ${e.day}, morning` : `Welcome back. Day ${e.day}, ${clock(e.hour)}: where you left off`, 3200),
    );
    events.on('milked', (e) => this.flash(`${e.litres} L of milk in the churn by the gate. Hold R at the bike beside it to load it, and sell it in the village before evening`, 4200));
    events.on('milkLoaded', (e) => this.flash(`The churn is on the rack: ${e.litres} L for Fatma Hanım’s dairy`, 3000));
    events.on('milkSoured', (e) => this.flash(`${e.litres} L of milk turned. Fresh milk sells the same day`, 3200));
    events.on('jobOffered', (e) => this.flash(`An errand: ${e.title}. The notebook (J) keeps it`, 3200));
    events.on('jobDone', (e) => this.flash(`Errand done. The village thinks well of you (standing ${e.reputation})`, 3400));
    events.on('goatFound', () => this.flash('You tie the goat to a carob tree. Tell Kemal; Mehmet will fetch her', 3400));
    events.on('sheared', (e) => this.flash(e.left ? `A fleece off. ${e.left} to go` : 'The whole flock shorn. They look half the size and twice as happy', 2400));
    events.on('found', (e) => this.flash(`You wipe the mud off ${e.name}. The museum would like it; so would the man behind the kahvehane`, 4200));
    events.on('pressed', (e) => this.flash(`${e.wheels} wheel${e.wheels === 1 ? '' : 's'} of white cheese on the shelf (${e.shelf} ageing). Best after three days`, 3600));
    events.on('herbPicked', e => this.flash(`A bundle of ${e.name}`));
  }

  /** The notebook (J) is open. */
  get isJournalOpen(): boolean {
    return this.journalOpen;
  }

  private setJournal(open: boolean): void {
    this.journalOpen = open;
    this.journal.style.display = open ? 'block' : 'none';
    document.body.classList.toggle('journalopen', open);
    if (open) {
      if (document.pointerLockElement) document.exitPointerLock();
      this.journal.focus({ preventScroll: true });
    } else this.journal.blur();
  }

  private flash(text: string, ms = 2200): void {
    this.banner.textContent = text;
    this.banner.style.opacity = '1';
    this.banner.style.transform = 'translate(-50%, 0) scale(1)';
    this.bannerUntil = performance.now() + ms;
  }

  /** Distance and direction from the shepherd, relative to the map (compass) and the camera (arrow). */
  private where(tx: number, tz: number, camYaw: number): string {
    const p = this.sim().player.pos;
    const dx = tx - p.x;
    const dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 6) return 'right here';
    const north = Math.atan2(dx, -dz); // 0 = north (-z), clockwise
    const compass = COMPASS[((Math.round(north / (Math.PI / 4)) % 8) + 8) % 8];
    // Camera forward is (-sin yaw, -cos yaw); relative angle, clockwise.
    const rel = north - Math.atan2(-Math.sin(camYaw), Math.cos(camYaw));
    const arrow = ARROWS[((Math.round(rel / (Math.PI / 4)) % 8) + 8) % 8];
    return `${Math.round(d)} m ${arrow} (${compass})`;
  }

  update(camYaw: number): void {
    const sim = this.sim();
    const T = sim.tasks;
    if (performance.now() > this.bannerUntil) {
      this.banner.style.opacity = '0';
      this.banner.style.transform = 'translate(-50%, -8px) scale(0.96)';
    }

    const race = sim.sprint;
    const active = [...sim.errands.targets()];
    const current = active[0];
    const job = sim.economy.job;
    const html = race?.running
      ? `<div class="title">Village sprint</div><div class="prog">${race.elapsed.toFixed(1)} s / 90 s</div><div class="dir">${race.marker.label} · ${this.where(race.marker.x, race.marker.z, camYaw)}</div>`
      : current ? `<div class="title">${esc(current.errand.title)}</div><div class="how">${esc(current.stop.action)}</div><div class="dir">${this.where(current.stop.x, current.stop.z, camYaw)}</div>`
      : job ? `<div class="title">${esc(JOBS[job.id].title)}</div><div class="how">${esc(JOBS[job.id].ask)}</div>` : '';
    this.card.hidden = !html;
    if (html !== this.lastHtml) {
      this.card.innerHTML = html;
      this.lastHtml = html;
    }
    if (!this.journalOpen) return;
    const rows = sim.errands.definitions.map(errand => {
      const i = sim.errands.status(errand.resident);
      const resident = sim.residents.list.find(r => r.id === errand.resident)!;
      const stop = i === undefined ? undefined : errand.stops[i];
      const detail = stop ? `${stop.action} · ${this.where(stop.x, stop.z, camYaw)}`
        : i === undefined ? `Talk to ${resident.profile.name} · ${this.where(resident.x, resident.z, camYaw)}` : 'Completed';
      return `<li><div><b>${esc(errand.title)}</b><br>${esc(detail)}</div></li>`;
    }).join('');
    this.journal.innerHTML = `<h2>Valley activities</h2><ol>${rows}</ol>
      ${race ? `<p class="sum"><b>Village sprint</b><br>Honk at the gold gate by the village entrance on your motorcycle or in a road vehicle.${race.best ? ` Best · ${race.best.toFixed(1)} s` : ''}</p>` : ''}
      ${job ? `<p class="sum">${esc(JOBS[job.id].title)} · ${esc(JOBS[job.id].ask)}</p>` : ''}
      <p class="sum">Your motorcycle · ${this.where(sim.bike.x, sim.bike.z, camYaw)}<br>
      ${weekday(T.day)} · ${season(T.day)} · ${clock(sim.hour)} · ${Math.round(sim.economy.lira)} ₺</p>
      <p class="foot">J — close</p>`;
  }
}
