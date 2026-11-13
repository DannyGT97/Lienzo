// Docks at their narrowest and widest: nothing may spill out, and every resizer looks alike.
export default async function (page, sim) {
  const res = {};
  const { drawer } = await sim.media();
  if (drawer) await page.evaluate(() => document.body.classList.add('show-tools'));
  await page.waitForTimeout(500);
  const handle = page.locator('.toolcol-resizer');
  for (const key of ['Home', 'End']) {
    await handle.focus();
    await page.keyboard.press(key);
    await page.waitForTimeout(300);
    res[`toolcol-${key}`] = await page.evaluate(() => {
      const t = document.getElementById('toolcol');
      return { width: t.getBoundingClientRect().width, columns: t.dataset.columns, subdock: document.getElementById('subdock').getBoundingClientRect().width };
    });
    res[`toolcol-${key}`].subdockOverflow = await sim.overflow('#subdock');
    res[`toolcol-${key}`].toolcolOverflow = await sim.overflow('#toolcol');
    await sim.shot(`layout-toolcol-${key}`);
  }
  if (drawer) {
    await page.evaluate(() => {
      document.body.classList.remove('show-tools');
      document.body.classList.add('show-layers');
    });
    await page.waitForTimeout(500);
  }
  res.rightdock = { overflow: await sim.overflow('#rightdock') };
  await sim.shot('layout-right');
  res.resizers = await page.evaluate(() =>
    [...document.querySelectorAll('.layout-resizer')].map((h) => {
      const a = getComputedStyle(h, '::after');
      return { cls: h.className.replace('layout-resizer ', ''), bar: `${a.width} x ${a.height}`, color: a.backgroundColor, shown: getComputedStyle(h).display !== 'none' };
    }),
  );
  return res;
}
