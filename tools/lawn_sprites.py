"""Lawn Siege sprites, third pass.

The look being aimed at is the cartoon tower-defense one: a thick dark keyline
round every shape, flat cel bands instead of gradients, an oversized head on a
small body, and a cast shadow so the thing sits on the lawn rather than floating.
All drawn here; nothing traced or copied.
"""
from PIL import Image, ImageDraw, ImageFilter
import math, os

SS = 5      # supersample
S = 64


def new():
    return Image.new("RGBA", (S * SS, S * SS), (0, 0, 0, 0))


def B(v):
    return int(v * SS)


def outline(im, w=2, col=(26, 20, 14, 255)):
    """Grow the alpha and paint it dark behind the art — one clean keyline."""
    a = im.getchannel("A").point(lambda v: 255 if v > 90 else 0)
    k = w * SS
    grow = a.filter(ImageFilter.MaxFilter(k if k % 2 else k + 1))
    ring = Image.new("RGBA", im.size, col)
    ring.putalpha(grow)
    return Image.alpha_composite(ring, im)


def shadow(d, cx, cy, rx, ry):
    d.ellipse([B(cx - rx), B(cy - ry), B(cx + rx), B(cy + ry)], fill=(0, 0, 0, 70))


def cel(d, cx, cy, r, mid, lo, hi):
    d.ellipse([B(cx - r), B(cy - r), B(cx + r), B(cy + r)], fill=lo)
    d.ellipse([B(cx - r * 0.97), B(cy - r), B(cx + r * 0.86), B(cy + r * 0.80)], fill=mid)
    d.ellipse([B(cx - r * 0.70), B(cy - r * 0.92), B(cx + r * 0.20), B(cy - r * 0.02)], fill=hi)
    d.ellipse([B(cx - r * 0.50), B(cy - r * 0.80), B(cx - r * 0.08), B(cy - r * 0.42)], fill="#ffffff")


def eyes(d, cx, cy, sp=8.5, r=6.0, look=1.2, angry=False, pupil="#16202c"):
    for sx in (-1, 1):
        x = cx + sx * sp
        d.ellipse([B(x - r), B(cy - r), B(x + r), B(cy + r)], fill="#ffffff")
        p = r * 0.50
        d.ellipse([B(x - p + look), B(cy - p), B(x + p + look), B(cy + p)], fill=pupil)
        d.ellipse([B(x - p * 0.55 + look), B(cy - p * 0.85), B(x - p * 0.05 + look), B(cy - p * 0.30)],
                  fill="#ffffff")
    if angry:
        d.line([(B(cx - sp - r * 0.9), B(cy - r * 1.35)), (B(cx - sp + r * 0.5), B(cy - r * 0.72))],
               fill="#20180f", width=B(1.7))
        d.line([(B(cx + sp + r * 0.9), B(cy - r * 1.35)), (B(cx + sp - r * 0.5), B(cy - r * 0.72))],
               fill="#20180f", width=B(1.7))


def leaf(d, x, y, f=1):
    d.polygon([(B(x), B(y)), (B(x + 11 * f), B(y - 6)), (B(x + 15 * f), B(y + 1)), (B(x + 4 * f), B(y + 6))],
              fill="#3f9142")
    d.line([(B(x + 1 * f), B(y + 1)), (B(x + 12 * f), B(y - 2))], fill="#2c6b2f", width=B(0.8))


def stem(d, x, y0, y1, w=4.0):
    d.line([(B(x), B(y0)), (B(x), B(y1))], fill="#3a8b3d", width=B(w))
    d.line([(B(x - w * 0.30), B(y0)), (B(x - w * 0.30), B(y1))], fill="#4da850", width=B(w * 0.34))


def done(im, size=S):
    return outline(im, 2).resize((size, size), Image.LANCZOS)


def shooter():
    im = new(); d = ImageDraw.Draw(im); shadow(d, 32, 59, 15, 4)
    stem(d, 32, 58, 36); leaf(d, 25, 49, -1)
    cel(d, 29, 27, 18, "#5ecb63", "#3d9a44", "#93e394")
    d.ellipse([B(42), B(19), B(60), B(37)], fill="#4fbb55")
    d.ellipse([B(44), B(21), B(58), B(33)], fill="#63cc68")
    d.ellipse([B(47), B(24), B(57), B(34)], fill="#16491c")
    eyes(d, 29, 25, 8.5, 6.0, 1.3)
    return done(im)


def sunflower():
    im = new(); d = ImageDraw.Draw(im); shadow(d, 32, 59, 15, 4)
    stem(d, 32, 58, 38); leaf(d, 33, 50, 1)
    for i in range(13):
        a = i * 2 * math.pi / 13 + 0.24
        x, y = 32 + 21 * math.cos(a), 29 + 21 * math.sin(a)
        d.ellipse([B(x - 8.5), B(y - 8.5), B(x + 8.5), B(y + 8.5)], fill="#e0a119")
    for i in range(13):
        a = i * 2 * math.pi / 13
        x, y = 32 + 19 * math.cos(a), 29 + 19 * math.sin(a)
        d.ellipse([B(x - 8), B(y - 8), B(x + 8), B(y + 8)], fill="#ffc93c")
        d.ellipse([B(x - 4.5), B(y - 6), B(x + 1), B(y - 1)], fill="#ffe38f")
    cel(d, 32, 29, 13.5, "#9c6626", "#784c18", "#c48c46")
    eyes(d, 32, 28, 7.0, 5.4, 0.7)
    d.arc([B(25), B(31), B(39), B(42)], 200, 340, fill="#ffe9b0", width=B(2.2))
    return done(im)


def wall():
    im = new(); d = ImageDraw.Draw(im); shadow(d, 32, 60, 17, 4)
    cel(d, 32, 33, 25, "#cd964f", "#a06f33", "#e8bd7e")
    for (x0, y0, x1, y1) in [(14, 17, 29, 31), (38, 19, 52, 35), (19, 43, 35, 54)]:
        d.arc([B(x0), B(y0), B(x1), B(y1)], 150, 340, fill="#a9762f", width=B(1.5))
    eyes(d, 32, 31, 7.6, 6.0, 0.5)
    d.arc([B(24), B(36), B(40), B(49)], 200, 340, fill="#6b451a", width=B(2.6))
    return done(im)


def frost():
    im = new(); d = ImageDraw.Draw(im); shadow(d, 32, 59, 15, 4)
    stem(d, 32, 58, 36); leaf(d, 25, 49, -1)
    cel(d, 29, 27, 18, "#8bd6ee", "#54a6c6", "#cdf0fb")
    d.ellipse([B(42), B(19), B(60), B(37)], fill="#7bcae4")
    d.ellipse([B(44), B(21), B(58), B(33)], fill="#8fd8ec")
    d.ellipse([B(47), B(24), B(57), B(34)], fill="#23596f")
    eyes(d, 29, 25, 8.5, 6.0, 1.3)
    for (x, y, r) in [(15, 13, 4.0), (46, 9, 3.2), (18, 42, 2.8)]:
        for a in range(0, 180, 45):
            t = math.radians(a)
            d.line([(B(x - r * math.cos(t)), B(y - r * math.sin(t))),
                    (B(x + r * math.cos(t)), B(y + r * math.sin(t)))], fill="#ffffff", width=B(1.1))
    return done(im)


def bomb():
    im = new(); d = ImageDraw.Draw(im); shadow(d, 32, 59, 15, 4)
    stem(d, 32, 58, 45); leaf(d, 33, 52, 1)
    cel(d, 32, 32, 22, "#de5a51", "#a83029", "#f5978d")
    eyes(d, 32, 31, 7.6, 6.0, 0.5, angry=True)
    d.arc([B(24), B(36), B(40), B(48)], 20, 160, fill="#7d1f1a", width=B(2.6))
    d.line([(B(32), B(11)), (B(40), B(2))], fill="#6b4318", width=B(3.0))
    d.ellipse([B(36), B(-2), B(47), B(9)], fill="#ffb03a")
    d.ellipse([B(38.6), B(0.6), B(43), B(5)], fill="#fff2c0")
    return done(im)


def _zbody(d, body, dark):
    d.rounded_rectangle([B(20), B(30), B(44), B(56)], radius=B(5), fill=body)
    d.polygon([(B(20), B(30)), (B(44), B(30)), (B(44), B(38)), (B(20), B(42))], fill=dark)
    d.rounded_rectangle([B(11), B(33), B(21), B(49)], radius=B(4), fill=body)
    d.rounded_rectangle([B(43), B(34), B(52), B(50)], radius=B(4), fill=dark)
    d.rounded_rectangle([B(22), B(55), B(30), B(62)], radius=B(2), fill=dark)
    d.rounded_rectangle([B(34), B(55), B(42), B(62)], radius=B(2), fill=dark)


def _teeth(d, y):
    d.rounded_rectangle([B(24), B(y), B(40), B(y + 6)], radius=B(1.6), fill="#39251d")
    x = 25.0
    while x < 39:
        d.rectangle([B(x), B(y), B(x + 2), B(y + 5.6)], fill="#efe9d6")
        x += 4


def walker():
    im = new(); d = ImageDraw.Draw(im); shadow(d, 32, 62, 15, 3.5)
    _zbody(d, "#75855f", "#556543")
    cel(d, 32, 19, 14, "#a3b787", "#7d9163", "#c7daaa")
    eyes(d, 32, 18, 7.6, 5.4, -1.3, angry=True, pupil="#7a1010")
    _teeth(d, 25)
    return done(im)


def armoured():
    im = new(); d = ImageDraw.Draw(im); shadow(d, 32, 62, 15, 3.5)
    _zbody(d, "#75855f", "#556543")
    cel(d, 32, 20, 14, "#a3b787", "#7d9163", "#c7daaa")
    eyes(d, 32, 20, 7.6, 5.0, -1.3, angry=True, pupil="#7a1010")
    _teeth(d, 26)
    d.rounded_rectangle([B(15), B(2), B(49), B(16)], radius=B(4), fill="#9aa5b2")
    d.rounded_rectangle([B(15), B(10), B(49), B(16)], radius=B(3), fill="#78838f")
    d.ellipse([B(19), B(5), B(25), B(11)], fill="#c8d1da")
    d.ellipse([B(39), B(5), B(45), B(11)], fill="#c8d1da")
    return done(im)


def sprinter():
    im = new(); d = ImageDraw.Draw(im); shadow(d, 32, 62, 14, 3.5)
    d.rounded_rectangle([B(23), B(31), B(42), B(54)], radius=B(5), fill="#61738e")
    d.polygon([(B(23), B(31)), (B(42), B(31)), (B(42), B(39)), (B(23), B(43))], fill="#4a5b74")
    d.line([(B(23), B(35)), (B(12), B(25))], fill="#4a5b74", width=B(4.2))
    d.line([(B(42), B(35)), (B(53), B(25))], fill="#4a5b74", width=B(4.2))
    d.line([(B(26), B(54)), (B(19), B(63))], fill="#4a5b74", width=B(4.2))
    d.line([(B(39), B(54)), (B(46), B(63))], fill="#4a5b74", width=B(4.2))
    cel(d, 32, 19, 13, "#b3c6de", "#8ba0bc", "#dcebf8")
    eyes(d, 32, 18, 7.2, 5.2, -1.4, angry=True, pupil="#7a1010")
    d.rounded_rectangle([B(26), B(24), B(38), B(29)], radius=B(1.4), fill="#2b3442")
    return done(im)


def sun():
    im = new(); d = ImageDraw.Draw(im)
    for i in range(16):
        a = i * math.pi / 8
        d.polygon([(B(32 + 13 * math.cos(a)), B(32 + 13 * math.sin(a))),
                   (B(32 + 28 * math.cos(a + 0.11)), B(32 + 28 * math.sin(a + 0.11))),
                   (B(32 + 28 * math.cos(a - 0.11)), B(32 + 28 * math.sin(a - 0.11)))], fill="#ffc61f")
    cel(d, 32, 32, 17, "#ffd23f", "#eda80f", "#fff0a8")
    return done(im)


def _pea(mid, lo, hi):
    im = Image.new("RGBA", (24 * SS, 24 * SS), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.ellipse([2 * SS, 2 * SS, 22 * SS, 22 * SS], fill=lo)
    d.ellipse([int(2.4 * SS), int(2.2 * SS), int(21 * SS), int(20 * SS)], fill=mid)
    d.ellipse([6 * SS, 5 * SS, 13 * SS, 11 * SS], fill=hi)
    d.ellipse([7 * SS, 6 * SS, 10 * SS, 9 * SS], fill="#ffffff")
    return outline(im, 2).resize((24, 24), Image.LANCZOS)


# ------------------------------------------------------------------ fusions
def repeater():
    im = new(); d = ImageDraw.Draw(im); shadow(d, 32, 59, 15, 4)
    stem(d, 32, 58, 36); leaf(d, 24, 49, -1)
    cel(d, 26, 28, 17, "#43ad4c", "#2e7f37", "#82d489")
    for x in (38, 49):
        d.ellipse([B(x), B(21), B(x + 16), B(37)], fill="#3aa243")
        d.ellipse([B(x + 2), B(23), B(x + 14), B(33)], fill="#4bb954")
        d.ellipse([B(x + 5), B(26), B(x + 14), B(34)], fill="#144419")
    eyes(d, 26, 26, 8.0, 5.6, 1.2)
    return done(im)


def sunshot():
    im = new(); d = ImageDraw.Draw(im); shadow(d, 32, 59, 15, 4)
    stem(d, 32, 58, 38); leaf(d, 33, 51, 1)
    for i in range(12):
        a = i * math.pi / 6
        x, y = 28 + 21 * math.cos(a), 28 + 21 * math.sin(a)
        d.ellipse([B(x - 7.5), B(y - 7.5), B(x + 7.5), B(y + 7.5)], fill="#ffc93c")
        d.ellipse([B(x - 4), B(y - 5), B(x + 1), B(y - 1)], fill="#ffe38f")
    cel(d, 28, 28, 15, "#5ecb63", "#3d9a44", "#93e394")
    d.ellipse([B(41), B(21), B(58), B(37)], fill="#4fbb55")
    d.ellipse([B(45), B(24), B(56), B(34)], fill="#16491c")
    eyes(d, 27, 27, 7.8, 5.6, 1.2)
    return done(im)


def bulwark():
    im = new(); d = ImageDraw.Draw(im); shadow(d, 32, 60, 17, 4)
    cel(d, 32, 34, 25, "#cd964f", "#a06f33", "#e8bd7e")
    d.arc([B(14), B(19), B(29), B(33)], 150, 340, fill="#a9762f", width=B(1.5))
    cel(d, 28, 31, 14, "#5ecb63", "#3d9a44", "#93e394")
    d.ellipse([B(41), B(25), B(57), B(40)], fill="#4fbb55")
    d.ellipse([B(45), B(29), B(55), B(38)], fill="#16491c")
    eyes(d, 27, 30, 7.4, 5.4, 1.1)
    return done(im)


def sleet():
    im = new(); d = ImageDraw.Draw(im); shadow(d, 32, 59, 15, 4)
    stem(d, 32, 58, 36); leaf(d, 24, 49, -1)
    cel(d, 26, 29, 17, "#7ccbe6", "#4f9fbe", "#c7eefb")
    for x in (38, 49):
        d.ellipse([B(x), B(22), B(x + 16), B(38)], fill="#6fc0dd")
        d.ellipse([B(x + 2), B(24), B(x + 14), B(34)], fill="#84d0e9")
        d.ellipse([B(x + 5), B(27), B(x + 14), B(35)], fill="#1d5468")
    eyes(d, 26, 27, 8.0, 5.6, 1.2)
    for (x, y, r) in [(14, 13, 4.2), (30, 8, 3.4), (46, 11, 3.0)]:
        for a in range(0, 180, 45):
            t = math.radians(a)
            d.line([(B(x - r * math.cos(t)), B(y - r * math.sin(t))),
                    (B(x + r * math.cos(t)), B(y + r * math.sin(t)))], fill="#ffffff", width=B(1.1))
    return done(im)


def minewall():
    im = new(); d = ImageDraw.Draw(im); shadow(d, 32, 60, 17, 4)
    cel(d, 32, 33, 25, "#b5863f", "#8a6229", "#d4a86a")
    for (x, y) in [(15, 21), (49, 23), (19, 46), (46, 45)]:
        d.ellipse([B(x - 5.5), B(y - 5.5), B(x + 5.5), B(y + 5.5)], fill="#de5a51")
        d.ellipse([B(x - 2.4), B(y - 3.4), B(x + 1.2), B(y + 0.2)], fill="#f5978d")
    eyes(d, 32, 31, 7.6, 6.0, 0.4, angry=True)
    d.arc([B(24), B(37), B(40), B(49)], 20, 160, fill="#5e3c14", width=B(2.4))
    return done(im)


def glacier():
    im = new(); d = ImageDraw.Draw(im); shadow(d, 32, 59, 15, 4)
    stem(d, 32, 58, 45); leaf(d, 33, 52, 1)
    cel(d, 32, 32, 22, "#9fdcf0", "#63aecb", "#e2f7ff")
    for i in range(6):
        a = i * math.pi / 3
        d.line([(B(32), B(32)), (B(32 + 18 * math.cos(a)), B(32 + 18 * math.sin(a)))],
               fill="#ffffff", width=B(1.4))
    cel(d, 32, 32, 10, "#d6f3ff", "#9fd4e8", "#ffffff")
    eyes(d, 32, 31, 6.6, 4.6, 0.4)
    d.line([(B(32), B(11)), (B(40), B(2))], fill="#6b4318", width=B(3.0))
    d.ellipse([B(36), B(-2), B(47), B(9)], fill="#9fe6ff")
    return done(im)


ALL = {
    "shooter": shooter(), "sunflower": sunflower(), "wall": wall(), "frost": frost(), "bomb": bomb(),
    "walker": walker(), "armoured": armoured(), "sprinter": sprinter(), "sun": sun(),
    "pea": _pea("#7ede63", "#4da33c", "#c8f7b4"), "frostpea": _pea("#9fe6ff", "#5cb3d0", "#e8fbff"),
    "repeater": repeater(), "sunshot": sunshot(), "bulwark": bulwark(),
    "sleet": sleet(), "minewall": minewall(), "glacier": glacier(),
}

if __name__ == "__main__":
    tot = 0
    for k, im in ALL.items():
        q = im.quantize(colors=64, method=Image.FASTOCTREE)
        q.save(k + ".png", optimize=True)
        tot += os.path.getsize(k + ".png")
    print("  %d sprites, %d bytes" % (len(ALL), tot))

    names = list(ALL)
    sheet = Image.new("RGBA", (len(names) * 74 + 10, 84), (43, 70, 34, 255))
    for i, n in enumerate(names):
        im = Image.open(n + ".png").convert("RGBA")
        if im.size != (64, 64):
            c = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
            c.paste(im, ((64 - im.width) // 2, (64 - im.height) // 2))
            im = c
        sheet.paste(im, (10 + i * 74, 10), im)
    sheet.resize((sheet.width * 2, sheet.height * 2), Image.LANCZOS).save("v3.png")
    print("  contact sheet -> v3.png")
