// Usage: npm.cmd run sim -- <scenario> [profile]   (profiles: tablet, tablet-portrait, phone, desktop)
import { ensureServer, openApp } from './lib.mjs';

const [scenario = 'layout', profile = 'tablet'] = process.argv.slice(2);
const stop = await ensureServer();
const { browser, page, sim } = await openApp(profile);
try {
  const { default: run } = await import(`./scenarios/${scenario}.mjs`);
  const result = await run(page, sim);
  console.log(JSON.stringify({ profile, media: await sim.media(), ...result, pageErrors: sim.errors }, null, 2));
} finally {
  await browser.close();
  stop();
}
