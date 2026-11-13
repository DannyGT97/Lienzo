// Two-finger rotation must follow the fingers: no jumps back, and it settles where the fingers stop.
export default async function (page, sim) {
  const box = await page.locator('#canvas').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const samples = [];
  const angle = (v) => Math.round((((v.rot * 90 + (v.tilt * 180) / Math.PI) % 360) + 360) % 360 * 10) / 10;
  await sim.twist(cx, cy, 50, { onStep: async () => samples.push(angle(await sim.view())) });
  let worstBackstep = 0;
  for (let i = 1; i < samples.length; i++) worstBackstep = Math.min(worstBackstep, samples[i] - samples[i - 1]);
  await sim.shot('rotate-after');
  return { degrees: samples, worstBackstep, final: await sim.view() };
}
