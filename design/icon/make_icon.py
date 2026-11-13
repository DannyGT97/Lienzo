"""Draws the Lienzo app icon (original artwork) and writes the files `tauri icon` needs.
Run: python design/icon/make_icon.py   then   npx tauri icon design/icon/manifest.json
"""
import json, math, os
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.dirname(os.path.abspath(__file__))
N = 1024          # final size
SS = 2            # supersampling
S = N * SS

def lerp(a, b, t): return a + (b - a) * t
def mix(c1, c2, t): return tuple(int(lerp(c1[i], c2[i], t)) for i in range(3))

def gradient_bg(size):
    top, bot = (52, 62, 112), (22, 24, 40)
    img = Image.new('RGB', (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = min(1, max(0, (y * 0.8 + x * 0.35) / (size * 1.0)))
            px[x, y] = mix(top, bot, t)
    return img

def bez(p0, p1, p2, p3, t):
    u = 1 - t
    return (u**3*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t**3*p3[0],
            u**3*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t**3*p3[1])

def content(size):
    """Paper + ink stroke + pencil on a transparent square of `size` px, designed on a 1024 grid."""
    k = size / 1024
    layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))

    # --- paper (manga page proportions), slightly tilted, with a soft shadow
    pw, ph = 430, 640
    paper = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(paper)
    x0, y0 = 512 - pw / 2 - 40, 512 - ph / 2 - 10
    d.rounded_rectangle([x0*k, y0*k, (x0+pw)*k, (y0+ph)*k], radius=34*k, fill=(246, 243, 236, 255))
    # light border line like a page frame
    m = 44
    d.rounded_rectangle([(x0+m)*k, (y0+m)*k, (x0+pw-m)*k, (y0+ph-m)*k], radius=14*k, outline=(214, 210, 200, 255), width=max(1, int(5*k)))
    paper = paper.rotate(7, resample=Image.BICUBIC, center=(512*k, 512*k))
    shadow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    shadow.paste((0, 0, 0, 120), mask=paper.split()[3])
    shadow = shadow.filter(ImageFilter.GaussianBlur(26*k))
    layer.alpha_composite(shadow, (int(10*k), int(22*k)))
    layer.alpha_composite(paper)

    # --- ink stroke: tapered S-curve drawn as overlapping discs
    ink = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(ink)
    pts = [(300, 350), (520, 160), (290, 520), (572, 570)]
    steps = 400
    for i in range(steps + 1):
        t = i / steps
        x, y = bez(*pts, t)
        w = 8 + 30 * math.sin(math.pi * min(1, t * 1.05)) ** 0.6   # thin at both ends, full in the middle
        d.ellipse([(x-w)*k, (y-w)*k, (x+w)*k, (y+w)*k], fill=(66, 110, 245, 255))
    layer.alpha_composite(ink)

    # --- pencil coming from the lower right, its graphite tip on the end of the stroke
    L, W = 430, 96
    tip, body_end = 120, 360
    pen = Image.new('RGBA', (int(L*k)+2, int(W*k)+2), (0, 0, 0, 0))
    d = ImageDraw.Draw(pen)
    d.rectangle([tip*k, 0, body_end*k, W*k], fill=(255, 201, 60, 255))
    d.rectangle([tip*k, 0, body_end*k, W*0.22*k], fill=(255, 224, 120, 255))      # highlight
    d.rectangle([tip*k, W*0.78*k, body_end*k, W*k], fill=(232, 160, 30, 255))     # shade
    d.polygon([(tip*k, 0), (tip*k, W*k), (0, W*0.5*k)], fill=(240, 200, 150, 255))
    d.polygon([(56*k, W*0.33*k), (56*k, W*0.67*k), (0, W*0.5*k)], fill=(46, 48, 62, 255))
    d.rectangle([body_end*k, 0, (body_end+26)*k, W*k], fill=(190, 194, 205, 255))
    d.rounded_rectangle([(body_end+26)*k, 0, L*k, W*k], radius=24*k, fill=(240, 112, 120, 255))
    d.rectangle([(body_end+26)*k, 0, (body_end+50)*k, W*k], fill=(240, 112, 120, 255))
    theta = -45                                   # PIL: positive is counter-clockwise; -45 turns the tip up-left
    pen = pen.rotate(theta, resample=Image.BICUBIC, expand=True)
    cx, cy = (int(L*k)+2) / 2, (int(W*k)+2) / 2
    ox, oy = 0 - cx, W*0.5*k - cy                 # tip relative to the pencil's centre
    r = math.radians(theta)
    tipx = pen.width/2 + ox*math.cos(r) + oy*math.sin(r)
    tipy = pen.height/2 - ox*math.sin(r) + oy*math.cos(r)
    tx, ty = 578, 574
    pos = (int(tx*k - tipx), int(ty*k - tipy))
    sh = Image.new('RGBA', pen.size, (0, 0, 0, 0)); sh.paste((0, 0, 0, 110), mask=pen.split()[3])
    sh = sh.filter(ImageFilter.GaussianBlur(10*k))
    big = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    big.paste(sh, (pos[0] + int(8*k), pos[1] + int(14*k)), sh)
    big.paste(pen, pos, pen)
    layer.alpha_composite(big)
    return layer

def fit(layer, scale):
    """Shrink `layer` around its centre (Android's adaptive icon crops to ~66 % of the canvas)."""
    s = layer.width
    inner = layer.resize((int(s*scale), int(s*scale)), Image.LANCZOS)
    out = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    out.alpha_composite(inner, ((s-inner.width)//2, (s-inner.height)//2))
    return out

bg = gradient_bg(S).convert('RGBA')
art = content(S)

# desktop / store icon: rounded square
master = bg.copy(); master.alpha_composite(art)
mask = Image.new('L', (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S-1, S-1], radius=int(S*0.225), fill=255)
master.putalpha(mask)
master.resize((N, N), Image.LANCZOS).save(os.path.join(OUT, 'app-icon.png'))

# Android adaptive icon: plain background + artwork kept inside the safe zone
bg.convert('RGB').resize((N, N), Image.LANCZOS).save(os.path.join(OUT, 'app-icon-bg.png'))
fit(art, 0.74).resize((N, N), Image.LANCZOS).save(os.path.join(OUT, 'app-icon-fg.png'))

json.dump({'default': 'app-icon.png', 'android_bg': 'app-icon-bg.png', 'android_fg': 'app-icon-fg.png',
           'android_fg_scale': 100}, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=2)
print('ok')
