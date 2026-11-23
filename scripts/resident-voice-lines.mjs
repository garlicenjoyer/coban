// Export the exact lines used by the game for offline voice recording.
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false } });
try {
  const { VALLEY_MAP } = await vite.ssrLoadModule('/src/world/valley.ts');
  const { Resident } = await vite.ssrLoadModule('/src/life/residents.ts');
  const { errandDirection } = await vite.ssrLoadModule('/src/life/dialogue.ts');
  const lines = {};
  for (const route of VALLEY_MAP.residents) {
    const resident = new Resident(route, { heightAt: () => 0 }, { blocked: () => false });
    const dialogue = new Set();
    const context = { hour: 8, gateOpen: false, flockExposed: false };
    for (const stop of route.stops) {
      resident.setTime(stop.hour);
      for (const settled of [true, false]) {
        resident.settled = settled;
        dialogue.add(resident.routine());
        dialogue.add(resident.greeting(context));
        dialogue.add(resident.greeting({ ...context, hour: 13 }));
      }
    }
    dialogue.add(resident.greeting({ ...context, hour: 20 }));
    dialogue.add(resident.greeting({ ...context, flockExposed: true }));
    if (resident.tractor) {
      resident.yielding = true;
      dialogue.add(resident.greeting(context));
    }
    dialogue.add(resident.advice(context));
    dialogue.add(resident.advice({ ...context, hour: 18, gateOpen: true }));
    const errand = VALLEY_MAP.errands.find((entry) => entry.resident === resident.id);
    if (errand) {
      dialogue.add(errand.offer);
      dialogue.add(errand.completedReply ?? errand.thanks);
      dialogue.add(errandDirection(errand.stops[0].place, true));
      for (const stop of errand.stops) dialogue.add(errandDirection(stop.place));
    }
    lines[resident.id] = [...dialogue];
  }
  process.stdout.write(JSON.stringify(lines));
} finally {
  await vite.close();
}
