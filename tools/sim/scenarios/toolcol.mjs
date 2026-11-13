// Measures the tool column for overflow (scrollbar) and reports elements that overflow it.
export default async function run(page) {
  const info = await page.evaluate(() => {
    const cands = [...document.querySelectorAll('#toolcol, #toolcol-tools, #toolcol-colors, #toolcol-sliders')];
    const out = [];
    for (const el of cands) {
      const cs = getComputedStyle(el);
      out.push({ sel: el.id ? '#' + el.id : el.className, w: el.clientWidth, sw: el.scrollWidth, h: el.clientHeight, sh: el.scrollHeight, ox: cs.overflowX, oy: cs.overflowY });
    }
    return out;
  });
  await page.evaluate(() => (document.documentElement.style.zoom = ''));
  await page.screenshot({ path: '.sim/toolcol.png', clip: { x: 0, y: 280, width: 120, height: 300 } });
  return { info };
}
