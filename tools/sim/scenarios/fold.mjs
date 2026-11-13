// Folded dock: the strip is the whole dock while it is resized, and the tool column can be folded away and restored.
export default async function (page, sim) {
  const res = {};
  const geom = () =>
    page.evaluate(() => {
      const w = (id) => Math.round(document.getElementById(id).getBoundingClientRect().width);
      const dock = document.getElementById('leftdock');
      return { dock: dock.style.display === 'none' || getComputedStyle(dock).display === 'none' ? 0 : w('leftdock'), toolcol: w('toolcol'), clipped: w('toolcol') > w('leftdock') + 1 };
    });
  if ((await sim.media()).drawer) {
    await page.evaluate(() => document.body.classList.add('show-tools'));
    await page.waitForTimeout(400);
  }
  await page.click('#fold-subdock');
  await page.waitForTimeout(200);
  res.folded = await geom();
  const { coarse } = await sim.media();
  const handle = page.locator('.toolcol-resizer');
  /** Drags the resizer by `dx`, with a finger on touch devices and the mouse otherwise. */
  const drag = async (dx) => {
    const box = await handle.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const at = (d) => ({ x: x + d, y });
    if (coarse) await sim.touch('touchStart', [at(0)]);
    else {
      await page.mouse.move(x, y);
      await page.mouse.down();
    }
    for (let i = 1; i <= 20; i++) {
      const p = at((dx * i) / 20);
      if (coarse) await sim.touch('touchMove', [p]);
      else await page.mouse.move(p.x, p.y);
    }
    if (coarse) await sim.touch('touchEnd', []);
    else await page.mouse.up();
    await page.waitForTimeout(200);
  };
  await drag(120);
  res.widened = await geom();
  await sim.shot('fold-widened');
  await drag(-300);
  res.narrowed = await geom();
  res.foldBarShown = await page.evaluate(() => getComputedStyle(document.querySelector('.toolcol-resizer'), '::after').left);
  if (!(await page.locator('#fold-toolcol').isVisible())) return { ...res, toolColumnFold: 'not offered on this layout' };
  await page.click('#fold-toolcol');
  await page.waitForTimeout(200);
  res.toolsFolded = { ...(await geom()), reopenVisible: await page.locator('#show-toolcol').isVisible() };
  await sim.shot('fold-all');
  await page.click('#show-toolcol');
  await page.waitForTimeout(200);
  res.restored = await geom();
  return res;
}
