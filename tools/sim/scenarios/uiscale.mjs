// Interface scale: the bars and docks shrink or grow, the stage takes the space, nothing spills and the canvas stays crisp.
export default async function (page, sim) {
  const res = {};
  const { drawer } = await sim.media();
  for (const percent of [100, 80, 60, 130]) {
    await page.evaluate((p) => {
      document.documentElement.style.setProperty('--ui-scale', String(p / 100));
      window.dispatchEvent(new Event('resize'));
    }, percent);
    await page.waitForTimeout(400);
    res[percent] = await page.evaluate(() => {
      const r = (id) => {
        const b = document.getElementById(id).getBoundingClientRect();
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
      };
      const canvas = document.querySelector('#stage canvas');
      const cb = canvas.getBoundingClientRect();
      return {
        appbar: r('appbar'), leftdock: r('leftdock'), rightdock: r('rightdock'), stage: r('stage'),
        statusbar: r('statusbar'), appbarVar: getComputedStyle(document.documentElement).getPropertyValue('--appbar-h'),
        canvas: { w: Math.round(cb.width), h: Math.round(cb.height), backing: `${canvas.width}x${canvas.height}` },
        pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    res[percent].commandbarOverflow = await sim.overflow('#commandbar');
    res[percent].leftOverflow = await sim.overflow('#leftdock');
    res[percent].rightOverflow = await sim.overflow('#rightdock');
    await sim.shot(`uiscale-${percent}`);
    if (drawer) {
      await page.evaluate(() => document.body.classList.add('show-tools'));
      await page.waitForTimeout(400);
      res[percent].drawer = await page.evaluate(() => {
        const b = document.getElementById('leftdock').getBoundingClientRect();
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), appbarBottom: Math.round(document.getElementById('appbar').getBoundingClientRect().bottom) };
      });
      await sim.shot(`uiscale-${percent}-drawer`);
      await page.evaluate(() => document.body.classList.remove('show-tools'));
    }
  }
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--ui-scale', '1');
    window.dispatchEvent(new Event('resize'));
  });
  return res;
}
