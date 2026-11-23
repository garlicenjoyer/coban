// Task card (a paper note, top left) and journal (J). Shows the current task, how to
// do it, live progress, and where to go as distance + direction (no world marker).

import { config, DAWN_HOUR, GOLDEN_HOUR, SUNSET_HOUR } from '../core/config';
import type { EventBus } from '../core/events';
import type { Sim } from '../sim';
import { ITEMS, type ItemId } from '../player/satchel';
import { GOODS, JOBS } from '../economy/economy';
import { isThursday, season, weekday } from '../economy/calendar';
import { activeMap, insideFold, layout } from '../world/map';

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

const clock = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export class TaskCard {
  private card: HTMLDivElement;
  private journal: HTMLDivElement;
  private banner: HTMLDivElement;
  private bannerUntil = 0;
  private journalOpen = false;
  private nightWarned = false;
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
    document.body.appendChild(this.journal);
    this.banner = document.createElement('div');
    this.banner.id = 'taskdone';
    this.banner.setAttribute('role', 'status');
    document.body.appendChild(this.banner);

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyJ') this.journalOpen = !this.journalOpen;
    });
    events.on('taskDone', (e) => {
      const t = this.sim().tasks.tasks[e.index];
      this.flash(`✓ ${t.title}`);
      this.onDone();
    });
    events.on('dayDone', () => {
      this.flash(`Day ${this.sim().tasks.day} complete`);
      this.journalOpen = true;
      this.onDone();
    });
    events.on('simReset', () => {
      this.nightWarned = false;
    });
    events.on('goldenHour', () => {
      if (this.sim().tasks.enabled) this.flash('Golden hour · one hour until sunset');
    });
    events.on('restedUntilDark', () => (this.journalOpen = false));
    events.on('bark', ({ kind }) => {
      const sim = this.sim();
      const wolf = sim.nightWolf;
      if (this.nightWarned || !wolf || sim.dog.perceived !== wolf || (kind !== 'alert' && kind !== 'warning')) return;
      this.nightWarned = true;
      this.journalOpen = false;
      this.flash('Karabaş sounds the alarm');
    });
    events.on('slept', (e) => {
      this.journalOpen = false;
      const r = this.sim().nightReport(e.day - 1);
      if (!r || (!r.taken && !r.scattered && !r.wounded)) this.flash(`You sleep soundly${r?.sleptAt === 'hut' ? ' at the hut' : ''}. Day ${e.day}`);
      else
        this.flash(
          `Wolves in the night: ${r.taken ? `${r.taken} taken` : 'none taken'}${r.scattered ? `, ${r.scattered} scattered` : ''}${r.wounded ? `, ${r.wounded} bitten` : ''}`,
          4200,
        );
    });
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
    events.on('loaded', (e) => this.flash(`Welcome back. Day ${e.day}, morning`, 3200));
    events.on('milked', (e) => this.flash(`${e.litres} L of milk in the churn by the gate. Hold R at the bike beside it to load it, and sell it in the village before evening`, 4200));
    events.on('milkLoaded', (e) => this.flash(`The churn is on the rack: ${e.litres} L for Fatma Hanım’s dairy`, 3000));
    events.on('milkSoured', (e) => this.flash(`${e.litres} L of milk turned. Fresh milk sells the same day`, 3200));
    events.on('jobOffered', (e) => this.flash(`An errand: ${e.title}. The notebook (J) keeps it`, 3200));
    events.on('jobDone', (e) => this.flash(`Errand done. The village thinks well of you (standing ${e.reputation})`, 3400));
    events.on('goatFound', () => this.flash('You tie the goat to a carob tree. Tell Kemal; Mehmet will fetch her', 3400));
    events.on('sheared', (e) => this.flash(e.left ? `A fleece off. ${e.left} to go` : 'The whole flock shorn. They look half the size and twice as happy', 2400));
    events.on('found', (e) => this.flash(`You wipe the mud off ${e.name}. The museum would like it; so would the man behind the kahvehane`, 4200));
    events.on('pressed', (e) => this.flash(`${e.wheels} wheel${e.wheels === 1 ? '' : 's'} of white cheese on the shelf (${e.shelf} ageing). Best after three days`, 3600));
    events.on('slept', () => {
      const nr = this.sim().nightReport();
      if (nr?.rain) setTimeout(() => this.flash('It rained hard in the night. Uncle Ahmet said things come up at the ruins after rain', 4200), 3500);
    });
    events.on('herbPicked', (e) => this.flash(`A bundle of ${e.name}. The bakkal buys them`, 2200));
    // The first morning: point at Uncle Ahmet's letter once, if this map has one.
    setTimeout(() => {
      if (activeMap().notes?.some((n) => n.id === 'letter') && !this.sim().notesRead.has('letter')) this.flash('A letter waits on the çay table', 3200);
    }, 6000);
    events.on('howl', () => {
      if (this.sim().tasks.enabled) this.flash('Wolves howl in the forest · north-west', 3000);
    });
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

    let html: string;
    const sun =
      sim.hour < DAWN_HOUR || sim.hour >= SUNSET_HOUR
        ? '<span class="sun late">☾ night</span>'
        : sim.hour >= GOLDEN_HOUR
          ? `<span class="sun low">☀ golden hour</span>`
          : `<span class="sun">☀ ${sim.hour < 12 ? 'morning' : sim.hour < 16 ? 'midday' : 'afternoon'}</span>`;
    // The exact time lives on the pocket watch (hold T); the card only says how the day goes.
    // Standing key hints (watch, journal) live in Esc › Controls, not on the card.
    const header = `<div class="hdr"><b>Day ${T.day}</b> ${sun}</div>`;
    const wolf = T.day === 1 ? sim.nightWolf : null;
    const watch = sim.nightWatchActive;
    const lanternHint = 'Light the lantern · <kbd>F</kbd>';

    // Folded at the hut (and not penned at home): the fold is only safe with the shepherd beside it.
    const total = sim.flock.sheep.length;
    const folded = sim.works.built('hut') && total > 0 && sim.flock.sheep.every((s) => insideFold(s.x, s.z));
    const sleepWhere = folded ? 'the hut door (the flock is in the fold)' : `the cottage door${sim.works.built('hut') ? ' or the hut' : ''}`;

    if (!T.enabled) {
      html = `${header}<div class="paused">Tasks paused while a test runs.<br>Restart a day from the debug panel.</div>`;
    } else if (T.finished) {
      const next = watch
        ? `${this.nightWarned ? 'Karabaş is on guard' : 'Night watch'} · ${lanternHint}`
        : sim.firstNightPending
          ? 'Rest until dark · <kbd>E</kbd> at the cottage door'
          : `${wolf ? 'The wolf has gone. ' : ''}Sleep · <kbd>E</kbd> at ${sleepWhere}`;
      html = `${header}<div class="title">Day complete ✓</div><div class="how">Done in ${mmss(T.dayDoneAt)}. <kbd>J</kbd> for the summary.</div><div class="next">${next}</div>`;
    } else {
      const task = T.task!;
      const cur = T.current;
      const next = T.tasks[T.index + 1];
      html =
        header +
        `<div class="num">Task ${T.index + 1} of ${T.tasks.length}</div>` +
        `<div class="title">${esc(task.title)}</div>` +
        `<div class="how">${esc(task.how)}</div>` +
        (cur.progress ? `<div class="prog">${esc(cur.progress)}</div>` : '') +
        (cur.target ? `<div class="dir">${esc(cur.target.label)}: ${this.where(cur.target.x, cur.target.z, camYaw)}</div>` : '') +
        (cur.nudge ? `<div class="nudge">${esc(cur.nudge)}</div>` : '') +
        (next ? `<div class="next">Next: ${esc(next.title)}</div>` : '') +
        (watch && this.nightWarned ? `<div class="foot">${lanternHint}</div>` : '');
    }
    if (html !== this.lastHtml) {
      this.card.innerHTML = html;
      this.lastHtml = html;
    }

    this.journal.style.display = this.journalOpen ? 'block' : 'none';
    if (this.journalOpen) {
      const rows = T.tasks
        .map((t, i) => {
          const rec = T.done.find((d) => d.id === t.id);
          const cls = rec ? 'done' : i === T.index && T.enabled ? 'cur' : 'todo';
          const mark = rec ? '✓' : i === T.index ? '→' : '·';
          return `<li class="${cls}"><span>${mark}</span> ${esc(t.title)}${rec ? `<em>${mmss(rec.doneAt)}</em>` : ''}</li>`;
        })
        .join('');
      const f = sim.flock;
      const summary = T.finished
        ? T.day !== 2 || !layout.track
          ?`<p class="sum">Day complete in ${mmss(T.dayDoneAt)} · strays ${f.strayEvents} · stuck ${f.stuckEvents} · wolf bites ${sim.wolves.bites} · bond with Karabaş ${Math.round(sim.dog.bond)}</p>`
          : `<p class="sum">Day complete in ${mmss(T.dayDoneAt)} · best lap ${sim.lap.best > 0 ? mmss(sim.lap.best) : '—'} · falls ${sim.bike.falls}</p>`
        : '';
      const currentTally = sim.sunsetTally();
      const tally = currentTally ?? sim.sunsetTally(T.day - 1);
      const sunset = tally
        ? `<p class="sum">Day ${currentTally ? T.day : T.day - 1} at ${clock(SUNSET_HOUR)} · ${tally.safe}/${tally.total} sheep safely penned${
            tally.gateClosed ? ' · gate closed' : ` · ${tally.inPen} inside, gate open`
          }</p>`
        : '';
      const nr = sim.nightReport(T.day - 1);
      const night = nr
        ? `<p class="sum">Last night · ${esc(nr.reason)}${nr.taken || nr.scattered ? ` Wolves took ${nr.taken}${nr.scattered ? `; ${nr.scattered} scattered` : ''}.` : ''}${nr.wounded ? ` ${nr.wounded} came back bitten.` : ''}</p>`
        : '';
      // The flock as cargo: how they are holding up.
      const cond = f.sheep.length ? f.sheep.reduce((a, s) => a + s.condition, 0) / f.sheep.length : 0;
      const limping = f.sheep.filter((s) => s.condition < 50).length;
      const word = cond >= 80 ? 'good' : cond >= 60 ? 'fair' : 'poor';
      const flock = `<p class="sum">Flock condition: ${word}${limping ? ` · ${limping} limping` : ''}${sim.dog.wound > 0 ? ' · Karabaş is limping' : ''}</p>`;
      // Karabaş, in words rather than numbers.
      const care = sim.dog.care;
      const dogBits = [
        care.satiety < config.dogCare.hungry ? 'hungry' : care.satiety < config.dogCare.seekFood ? 'could eat' : 'fed',
        care.hydration < config.dogCare.thirsty ? 'thirsty' : null,
        care.ticks ? `${care.ticks} tick${care.ticks > 1 ? 's' : ''}` : null,
        care.pettedToday ? null : 'not petted today',
      ].filter(Boolean);
      const dogLine = `<p class="sum">Karabaş: ${dogBits.join(' · ')}${care.sack <= 3 ? ` · only ${care.sack} meals left in the sack` : ''}${nr?.dog && nr.dog.bondChange < 0 ? ` · ${esc(nr.dog.note)}` : ''}</p>`;
      const eco = sim.economy;
      const todayLines = eco.ledger.filter((l) => l.day === T.day);
      const owned = [...eco.upgrades].map((u) => GOODS.find((g) => g.id === u)?.name.toLowerCase() ?? u);
      const extras = [
        nr?.rain ? 'it rained hard in the night' : null,
        eco.artifacts.length ? `${eco.artifacts.length} find${eco.artifacts.length > 1 ? 's' : ''} from the ruin in your pocket` : null,
        eco.cheese.length ? `${eco.cheese.length} cheese wheels ageing (${eco.cheese.filter((w) => w.age >= config.economy.cheese.ageDays).length} ready)` : null,
        owned.length ? `yours: ${owned.join(', ')}` : null,
      ].filter(Boolean);
      const purse = `<p class="sum">Purse: ${Math.round(eco.lira)} ₺${todayLines.length ? ` · today ${todayLines.map((l) => `${esc(l.text)} ${l.amount > 0 ? '+' : ''}${l.amount}`).join(', ')}` : ''}${eco.churn ? ` · ${eco.churn} L in the churn` : ''}${eco.rackMilk ? ` · ${eco.rackMilk} L on the bike` : ''}${eco.herbCount ? ` · ${eco.herbCount} bundles of herbs` : ''} · ${eco.patches} tyre patches, ${eco.chainOil} chain oilings, ${sim.bike.care.drum.toFixed(0)} L in the drum${extras.length ? ` · ${esc(extras.join(' · '))}` : ''}</p>`;
      const kit = `<p class="sum">Satchel: ${sim.satchel.slots.map((sl) => `${ITEMS[sl.id].name.toLowerCase()}${Number.isFinite(sl.uses) ? ` (${sl.uses})` : ''}`).join(', ') || 'empty'}${sim.works.cairns.length ? ` · ${sim.works.cairns.length} cairns stacked` : ''}</p>`;
      const allNotes = activeMap().notes ?? [];
      const read = allNotes.filter((n) => sim.notesRead.has(n.id));
      const notes = allNotes.length
        ? `<p class="sum">Uncle Ahmet’s notes · ${read.length} of ${allNotes.length}${read.length ? `: ${read.map((n) => esc(n.title)).join(', ')}` : ' · the first is a letter on the çay table'}</p>`
        : '';
      const vill = [
        eco.job ? `errand: ${JOBS[eco.job.id].title}${eco.job.found ? ' (the goat is tied up: tell Kemal)' : ''}` : null,
        eco.reputation ? `standing in the village ${eco.reputation}${eco.reputation >= 1 ? ` (${Math.round(config.village.reputation.discountPer * Math.min(eco.reputation, config.village.reputation.max) * 100)}% off in the shops)` : ''}` : null,
        eco.fleeces ? `${eco.fleeces} fleeces to sell` : null,
        season(T.day) === 'summer' && eco.shornIds.size < f.sheep.length ? `${f.sheep.length - eco.shornIds.size} sheep to shear this summer` : null,
        isThursday(T.day) ? 'the vet is in the village today' : null,
        eco.tonic ? 'tonic in their water tonight' : null,
      ].filter(Boolean);
      const village = vill.length ? `<p class="sum">${esc(vill.join(' · '))}</p>` : '';
      this.journal.innerHTML = `<h2>Shepherd’s notebook — Day ${T.day} · ${weekday(T.day)} · ${season(T.day)}</h2><ol>${rows}</ol>${summary}${sunset}${night}${flock}${dogLine}${purse}${village}${kit}${notes}<p class="foot">J — close</p>`;
    }
  }
}
