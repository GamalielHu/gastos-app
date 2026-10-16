# Genera los íconos de la app (web y Android) a partir de un dibujo simple.
import os, sys
from PIL import Image, ImageDraw

INK = (22, 32, 42, 255); YEL = (242, 179, 0, 255); WHITE = (244, 246, 245, 255)
root = sys.argv[1]

def art(size, pad_frac=0.0, rounded=True, bg=True):
    S = 1024
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if bg:
        if rounded: d.rounded_rectangle([0, 0, S - 1, S - 1], radius=220, fill=INK)
        else: d.rectangle([0, 0, S, S], fill=INK)
    p = pad_frac * S
    def box(x0, y0, x1, y1): return [p + (x0 / S) * (S - 2 * p), p + (y0 / S) * (S - 2 * p), p + (x1 / S) * (S - 2 * p), p + (y1 / S) * (S - 2 * p)]
    # torta: porción grande blanca, porción amarilla separada
    d.pieslice(box(200, 170, 760, 730), start=-40, end=230, fill=WHITE)
    d.pieslice(box(250, 140, 810, 700), start=230, end=320, fill=YEL)
    # franja de señalización abajo
    band = Image.new('RGBA', (S, S), (0, 0, 0, 0)); bd = ImageDraw.Draw(band)
    y0, y1 = box(0, 800, 0, 900)[1], box(0, 800, 0, 900)[3]
    x0, x1 = box(170, 0, 854, 0)[0], box(170, 0, 854, 0)[2]
    bd.rounded_rectangle([x0, y0, x1, y1], radius=24, fill=YEL)
    w = (x1 - x0) / 9
    for i in range(-1, 11):
        bx = x0 + i * w
        bd.polygon([(bx, y1), (bx + w * .5, y1), (bx + w * .5 + (y1 - y0), y0), (bx + (y1 - y0), y0)], fill=INK)
    mask = Image.new('L', (S, S), 0); ImageDraw.Draw(mask).rounded_rectangle([x0, y0, x1, y1], radius=24, fill=255)
    im.paste(band, (0, 0), Image.composite(band, Image.new('RGBA', (S, S)), mask).split()[3])
    return im.resize((size, size), Image.LANCZOS)

def save(im, path):
    os.makedirs(os.path.dirname(path), exist_ok=True); im.save(path)

web = os.path.join(root, 'www', 'icons')
save(art(192), f'{web}/icon-192.png')
save(art(512), f'{web}/icon-512.png')
save(art(512, pad_frac=0.12, rounded=False), f'{web}/maskable-512.png')
a = art(180, rounded=False); save(a, f'{web}/apple-touch-icon.png')

# Android: íconos clásicos + capa frontal del ícono adaptable
res = os.path.join(root, 'android-res')
for name, px in [('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)]:
    save(art(px), f'{res}/mipmap-{name}/ic_launcher.png')
    r = art(px, rounded=False); m = Image.new('L', (px, px), 0); ImageDraw.Draw(m).ellipse([0, 0, px - 1, px - 1], fill=255)
    out = Image.new('RGBA', (px, px), (0, 0, 0, 0)); out.paste(r, (0, 0), m); save(out, f'{res}/mipmap-{name}/ic_launcher_round.png')
    fg = px * 108 // 48
    save(art(fg, pad_frac=0.22, bg=False), f'{res}/mipmap-{name}/ic_launcher_foreground.png')
os.makedirs(f'{res}/values', exist_ok=True)
open(f'{res}/values/ic_launcher_background.xml', 'w').write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#16202A</color>\n</resources>\n')
print('ok')
