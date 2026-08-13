"""Lawn Siege: the whole cast, drawn here.

The look aimed at is the one lane-defence games have used since the genre
started: a thick keyline in a dark version of the fill rather than black, two
flat cel bands under it, a soft gloss at the top left, big white eyes with a
glint, and a cast shadow so the thing sits on the lawn instead of floating.
Drawn at 4x and resolved down, so edges come out smooth rather than blocky.

Every sprite is built from shapes in this file -- circles, polygons, arcs. None
of it is traced, sampled, filtered or otherwise derived from anyone's artwork,
and the fusions are the base plants redrawn in another colour rather than an
image operation on someone else's pixels.

    python3 tools/lawn_toon.py > /tmp/art.js      # ART entries for main.js
    python3 tools/lawn_toon.py --sheet /tmp/x.png # contact sheet to look at
"""
import base64, io, math, os, random, sys

from PIL import Image, ImageDraw, ImageFilter

SS = 4                                  # supersample factor


# ------------------------------------------------------------------ utilities
def rgb(h):
    """Hex or an (r, g, b) triple -- shade() hands back triples."""
    if not isinstance(h, str):
        return tuple(h[:3])
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def shade(h, f):
    """Darken (f<1) or lighten (f>1) a colour, keeping it in gamut."""
    r, g, b = rgb(h)
    if f <= 1:
        return (int(r * f), int(g * f), int(b * f))
    return tuple(int(c + (255 - c) * (f - 1)) for c in (r, g, b))


class Art:
    """A supersampled RGBA canvas with the handful of marks this style needs."""

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.im = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)

    def B(self, v):
        return v * SS

    def _box(self, x, y, rx, ry):
        return [self.B(x - rx), self.B(y - ry), self.B(x + rx), self.B(y + ry)]

    def shadow(self, x, y, rx, ry=None):
        ry = ry if ry is not None else rx * 0.34
        lay = Image.new("RGBA", self.im.size, (0, 0, 0, 0))
        ImageDraw.Draw(lay).ellipse(self._box(x, y, rx, ry), fill=(20, 34, 12, 90))
        self.im.alpha_composite(lay.filter(ImageFilter.GaussianBlur(2.4 * SS)))

    def ball(self, x, y, r, col, ry=None, line=0.30):
        """A cel-shaded sphere: keyline, base, darker underside, lighter top."""
        ry = ry if ry is not None else r
        self.d.ellipse(self._box(x, y, r + line, ry + line), fill=shade(col, 0.42))
        self.d.ellipse(self._box(x, y, r, ry), fill=shade(col, 0.80))
        self.d.ellipse([self.B(x - r * 0.94), self.B(y - ry),
                        self.B(x + r * 0.86), self.B(y + ry * 0.72)], fill=rgb(col))
        self.d.ellipse([self.B(x - r * 0.70), self.B(y - ry * 0.94),
                        self.B(x + r * 0.34), self.B(y + ry * 0.10)], fill=shade(col, 1.18))
        self.gloss(x - r * 0.34, y - ry * 0.50, r * 0.30, ry * 0.24)

    def gloss(self, x, y, rx, ry, a=150):
        lay = Image.new("RGBA", self.im.size, (0, 0, 0, 0))
        ImageDraw.Draw(lay).ellipse(self._box(x, y, rx, ry), fill=(255, 255, 255, a))
        self.im.alpha_composite(lay.filter(ImageFilter.GaussianBlur(0.9 * SS)))

    def blob(self, pts, col, line=0.30):
        p = [(self.B(x), self.B(y)) for x, y in pts]
        self.d.polygon(p, fill=rgb(col), outline=shade(col, 0.42),
                       width=max(1, int(line * SS * 2)))

    def stroke(self, pts, col, w):
        self.d.line([(self.B(x), self.B(y)) for x, y in pts], fill=rgb(col),
                    width=int(w * SS), joint="curve")

    def leaf(self, x, y, L, ang, col="#4f9c2e", flip=1):
        a = math.radians(ang)
        ux, uy = math.cos(a), math.sin(a)
        px, py = -uy * flip, ux * flip
        tx, ty = x + ux * L, y + uy * L
        self.blob([(x, y),
                   (x + ux * L * 0.42 + px * L * 0.34, y + uy * L * 0.42 + py * L * 0.34),
                   (tx, ty),
                   (x + ux * L * 0.46 - px * L * 0.16, y + uy * L * 0.46 - py * L * 0.16)],
                  col, 0.34)
        self.d.line([(self.B(x), self.B(y)), (self.B(tx), self.B(ty))],
                    fill=shade(col, 0.66), width=int(0.5 * SS))

    def eye(self, x, y, r, look=(0.25, 0.1), k="#101820"):
        self.d.ellipse(self._box(x, y, r + 0.28, r + 0.28), fill=(24, 30, 22))
        self.d.ellipse(self._box(x, y, r, r), fill=(252, 252, 246))
        px, py = x + look[0] * r, y + look[1] * r
        self.d.ellipse(self._box(px, py, r * 0.52, r * 0.52), fill=rgb(k))
        self.d.ellipse(self._box(px - r * 0.20, py - r * 0.24, r * 0.20, r * 0.20),
                       fill=(255, 255, 255))

    def brow(self, x, y, w, tilt, col="#20301a"):
        self.d.line([(self.B(x - w), self.B(y + tilt)), (self.B(x + w), self.B(y - tilt))],
                    fill=rgb(col), width=int(0.75 * SS))

    def mouth(self, x, y, w, h, col="#3a1420"):
        self.d.ellipse(self._box(x, y, w, h), fill=rgb(col))
        self.d.chord(self._box(x, y + h * 0.42, w * 0.62, h * 0.52), 0, 180,
                     fill=(196, 88, 106))

    def resolve(self):
        return self.im.resize((self.w, self.h), Image.LANCZOS)


# -------------------------------------------------------------------- palette
PEA, PEA_D = "#63bf34", "#3d8a1d"
ICE, FIRE, EMBER = "#7fd4e8", "#f07a1e", "#c4551a"
NUT, CHERRY, PURPLE = "#c98a3f", "#d8352c", "#a24bb0"
SUNY, GOURD, SPUD = "#ffcf2e", "#6aa832", "#b98a44"


def stem(a, x, y0, y1, col=PEA_D, w=1.5):
    a.stroke([(x, y0), (x - 0.6, (y0 + y1) / 2), (x, y1)], col, w)
    a.leaf(x - 0.5, y1 - 2.5, 9.5, 172, shade(col, 1.25), 1)
    a.leaf(x + 0.5, y1 - 2.0, 8.5, 8, shade(col, 1.35), -1)


# ------------------------------------------------------------------ the plants
def pea_head(a, cx, cy, r, col, look=(0.5, 0.0), eye=True):
    """A shooter head: barrel first, then the head over where it joins."""
    bl, br = cx + r * 0.30, cx + r + 12
    a.d.rounded_rectangle([a.B(bl), a.B(cy - r * .46), a.B(br), a.B(cy + r * .46)],
                          radius=a.B(r * .42), fill=shade(col, 0.42))
    a.d.rounded_rectangle([a.B(bl), a.B(cy - r * .40), a.B(br - .6), a.B(cy + r * .40)],
                          radius=a.B(r * .38), fill=rgb(col))
    a.d.rounded_rectangle([a.B(bl), a.B(cy - r * .36), a.B(br - 1.2), a.B(cy + r * .02)],
                          radius=a.B(r * .30), fill=shade(col, 1.14))
    a.d.ellipse([a.B(br - 3.0), a.B(cy - r * .46), a.B(br + 1.6), a.B(cy + r * .46)],
                fill=shade(col, 0.52))
    a.d.ellipse([a.B(br - 2.0), a.B(cy - r * .34), a.B(br + .8), a.B(cy + r * .34)],
                fill=(26, 38, 20))
    a.ball(cx, cy, r, col, r * 1.02)
    if eye:
        a.eye(cx - r * 0.14, cy - r * 0.10, r * 0.40, look=look)
        a.brow(cx - r * 0.14, cy - r * 0.62, r * 0.34, r * 0.11)


def peashooter(col=PEA, ice=False, heads=1, back=False, petals=False, nut=False):
    """One drawing serves the whole shooter family: extra heads stack up the
    stem for a repeater or gatling, `back` adds a barrel facing the other way,
    `petals` puts a sunflower's ruff behind it, `nut` seats it in a shell."""
    a = Art(66 if back else 60, 82 + (heads - 1) * 9)
    base = a.h - 6
    a.shadow(a.w / 2 - 2, base + 1, 16)
    stem(a, 24, base - 36, base)
    if petals:
        for i in range(12):
            t = math.radians(i * 30)
            px, py = 22 + math.cos(t) * 17, 28 + math.sin(t) * 17
            a.ball(px, py, 7.4, "#ffd95e", 6.4, line=0.26)
    if nut:
        a.ball(24, 34, 24, NUT, 26)
    if back:
        a.d.rounded_rectangle([a.B(4), a.B(28 - 7), a.B(22), a.B(28 + 7)],
                              radius=a.B(6), fill=shade(col, 0.42))
        a.d.rounded_rectangle([a.B(5), a.B(28 - 6), a.B(22), a.B(28 + 6)],
                              radius=a.B(5.4), fill=rgb(col))
        a.d.ellipse([a.B(3.4), a.B(28 - 5), a.B(7.4), a.B(28 + 5)], fill=(26, 38, 20))
    for i in range(heads):
        pea_head(a, 22 + i * 2.5, 28 + i * 9, 18 - i * 1.2, col)
    if ice:
        for dx, dy, r in ((8, 12, 3.0), (46, 54, 2.4), (52, 14, 2.0)):
            a.d.regular_polygon((a.B(dx), a.B(dy), a.B(r)), 6, fill=(255, 255, 255, 230))
    return a.resolve()


def sunflower(col="#ffd95e", face="#e0a637"):
    a = Art(60, 82)
    a.shadow(29, 77, 16)
    stem(a, 28, 44, 76)
    for i in range(14):
        t = math.radians(i * 360 / 14)
        px, py = 28 + math.cos(t) * 18.5, 31 + math.sin(t) * 18.5
        a.d.ellipse([a.B(px - 8.6), a.B(py - 7.4), a.B(px + 8.6), a.B(py + 7.4)],
                    fill=shade(col, 0.55))
        a.d.ellipse([a.B(px - 7.6), a.B(py - 6.4), a.B(px + 7.6), a.B(py + 6.4)],
                    fill=rgb(col))
        a.d.ellipse([a.B(px - 6.0), a.B(py - 5.4), a.B(px + 4.0), a.B(py + 1.6)],
                    fill=shade(col, 1.25))
    a.ball(28, 31, 13.5, face, 13.5)
    a.eye(23, 29, 5.2, look=(0.2, 0.1))
    a.eye(33.5, 29, 5.2, look=(0.2, 0.1))
    a.mouth(28, 38.5, 5.6, 3.4, "#6b3a14")
    return a.resolve()


def wallnut(col=NUT, tall=False, studs=False, light=False):
    h = 96 if tall else 62
    a = Art(52, h + 8)
    cy = (h + 8) / 2
    a.shadow(26, h + 3, 16)
    a.ball(26, cy, 23, col, (h - 6) / 2)
    for i in range(3):
        y = cy - h * 0.18 + i * h * 0.16
        a.d.arc([a.B(8), a.B(y - 4), a.B(44), a.B(y + 10)], 200, 340,
                fill=shade(col, 0.62), width=int(0.7 * SS))
    if studs:
        for sx, sy in ((10, cy - 12), (42, cy - 6), (12, cy + 14), (40, cy + 16)):
            a.ball(sx, sy, 3.2, "#8f98a6", 3.2, line=0.22)
    if light:
        a.ball(40, cy - h * 0.34, 4.0, "#ff3b2a", 4.0, line=0.24)
        a.gloss(38.8, cy - h * 0.34 - 1.2, 1.5, 1.2, 220)
    ey = cy - h * 0.10
    a.eye(19, ey, 5.4, look=(0.3, 0.1))
    a.eye(33, ey, 5.4, look=(0.3, 0.1))
    a.brow(19, ey - 7.5, 4.6, 1.4, shade(col, 0.55))
    a.brow(33, ey - 7.5, -4.6, 1.4, shade(col, 0.55))
    a.mouth(26, ey + 11, 6.4, 3.4, shade(col, 0.45))
    return a.resolve()


def cherrybomb(col=CHERRY, col2=None):
    col2 = col2 or shade(col, 1.12)
    a = Art(60, 56)
    a.shadow(30, 51, 18)
    a.stroke([(22, 22), (28, 10), (38, 12)], "#4f9c2e", 1.6)
    a.leaf(31, 10, 10, -20, "#57ab33", -1)
    a.ball(19, 34, 15, col, 15)
    a.ball(43, 32, 14, col2, 14)
    for cx, cy, s in ((19, 33, 1.0), (43, 31, 0.94)):
        a.eye(cx - 4.6 * s, cy - 1, 4.4 * s, look=(0.3, 0.0))
        a.eye(cx + 4.6 * s, cy - 1, 4.4 * s, look=(0.3, 0.0))
        a.brow(cx - 4.6 * s, cy - 7.4, 3.8, 1.8, shade(col, 0.5))
        a.brow(cx + 4.6 * s, cy - 7.4, -3.8, 1.8, shade(col, 0.5))
        a.mouth(cx, cy + 7.5, 4.6, 3.0, shade(col, 0.40))
    return a.resolve()


def threepeater(col=PEA):
    a = Art(64, 92)
    a.shadow(32, 87, 17)
    stem(a, 26, 54, 88, shade(col, 0.66))
    for x, y in ((16, 40), (30, 38), (20, 22)):
        a.stroke([(26, 54), (x, y)], shade(col, 0.66), 1.8)
    for hx, hy in ((30, 46), (16, 32), (22, 15)):
        pea_head(a, hx, hy, 11.5, col)
    return a.resolve()


def torchwood(bark="#8a5a2a", flame=("#e8541c", "#ff9a22", "#ffe27a")):
    a = Art(58, 70)
    a.shadow(29, 65, 18)
    a.d.rounded_rectangle([a.B(8), a.B(28), a.B(50), a.B(62)], radius=a.B(7),
                          fill=shade(bark, 0.42))
    a.d.rounded_rectangle([a.B(9), a.B(29), a.B(49), a.B(61)], radius=a.B(6.4),
                          fill=rgb(bark))
    a.d.rounded_rectangle([a.B(10), a.B(30), a.B(48), a.B(44)], radius=a.B(5.6),
                          fill=shade(bark, 1.14))
    for rx, c in ((13, shade(bark, 0.58)), (9, bark),
                  (5.5, shade(bark, 1.10)), (2.4, shade(bark, 0.5))):
        a.d.ellipse([a.B(44 - rx * .55), a.B(45 - rx), a.B(44 + rx * .55), a.B(45 + rx)],
                    fill=rgb(c))
    for r, c in zip((14, 10, 6), flame):
        x, y = 26, 20 + (14 - r) * 0.4
        a.d.polygon([(a.B(x - r), a.B(y + r * 1.3)), (a.B(x - r * .3), a.B(y - r * .2)),
                     (a.B(x), a.B(y - r * 1.5)), (a.B(x + r * .4), a.B(y - r * .1)),
                     (a.B(x + r), a.B(y + r * 1.3))], fill=rgb(c))
    a.eye(19, 45, 5.0, look=(0.3, 0.1))
    a.eye(31, 45, 5.0, look=(0.3, 0.1))
    return a.resolve()


def chomper(col=PURPLE, barrel=False, shell=False):
    """Head thrown back, maw open: upper jaw carries the eyes, lower jaw below,
    red throat between. `shell` seats it in a nut, `barrel` gives it a muzzle."""
    a = Art(66, 80)
    a.shadow(33, 75, 18)
    if shell:
        a.ball(33, 48, 24, NUT, 26)
    else:
        stem(a, 26, 52, 74, shade(col, 0.72))
    if barrel:
        a.d.rounded_rectangle([a.B(40), a.B(30), a.B(64), a.B(42)], radius=a.B(5),
                              fill=shade(col, 0.42))
        a.d.rounded_rectangle([a.B(40), a.B(31), a.B(63), a.B(41)], radius=a.B(4.4),
                              fill=rgb(col))
        a.d.ellipse([a.B(60), a.B(31), a.B(64), a.B(41)], fill=(26, 38, 20))
    a.d.ellipse([a.B(12), a.B(30), a.B(56), a.B(56)], fill=shade(col, 0.5))
    a.d.ellipse([a.B(15), a.B(33), a.B(53), a.B(53)], fill=rgb("#8f2f4a"))
    a.d.chord([a.B(10), a.B(6), a.B(58), a.B(46)], 180, 360, fill=shade(col, 0.42))
    a.d.chord([a.B(11), a.B(7), a.B(57), a.B(44)], 180, 360, fill=rgb(col))
    a.d.chord([a.B(14), a.B(9), a.B(48), a.B(32)], 180, 360, fill=shade(col, 1.16))
    for i in range(7):
        tx = 14 + i * 6.4
        a.d.polygon([(a.B(tx), a.B(35)), (a.B(tx + 4.4), a.B(35)),
                     (a.B(tx + 2.2), a.B(42))], fill=(252, 250, 240))
    a.d.chord([a.B(13), a.B(40), a.B(55), a.B(64)], 0, 180, fill=shade(col, 0.42))
    a.d.chord([a.B(14), a.B(41), a.B(54), a.B(62)], 0, 180, fill=shade(col, 0.86))
    for i in range(5):
        tx = 19 + i * 6.4
        a.d.polygon([(a.B(tx), a.B(50)), (a.B(tx + 4.4), a.B(50)),
                     (a.B(tx + 2.2), a.B(44))], fill=(252, 250, 240))
    a.eye(24, 22, 5.2, look=(0.35, 0.1))
    a.eye(42, 22, 5.2, look=(-0.35, 0.1))
    a.brow(24, 14.5, 4.4, 1.8, shade(col, 0.5))
    a.brow(42, 14.5, -4.4, 1.8, shade(col, 0.5))
    return a.resolve()


def potatomine(col=SPUD):
    a = Art(56, 44)
    a.shadow(28, 40, 17)
    a.ball(28, 26, 20, col, 13)
    for cx, cy in ((17, 27), (37, 22), (30, 32)):
        a.d.ellipse([a.B(cx - 2), a.B(cy - 1.4), a.B(cx + 2), a.B(cy + 1.4)],
                    fill=shade(col, 0.60))
    a.leaf(30, 14, 9, -70, "#57ab33", -1)
    a.eye(23, 24, 4.4, look=(0.3, 0.1))
    a.eye(33, 24, 4.4, look=(0.3, 0.1))
    a.mouth(28, 32, 4.6, 2.4, shade(col, 0.45))
    a.ball(45, 16, 4.2, "#ff3b2a", 4.2, line=0.24)
    a.gloss(43.6, 14.6, 1.6, 1.3, 220)
    return a.resolve()


def squash(col=GOURD):
    a = Art(60, 58)
    a.shadow(30, 53, 18)
    a.ball(30, 34, 21, col, 20)
    for x in (18, 30, 42):
        a.d.arc([a.B(x - 9), a.B(15), a.B(x + 9), a.B(53)], 258, 282,
                fill=shade(col, 0.62), width=int(0.8 * SS))
    a.stroke([(30, 15), (31, 6)], "#6b4a1c", 2.0)
    a.leaf(31, 8, 11, -12, "#57ab33", -1)
    a.eye(23, 30, 5.0, look=(0.3, 0.05))
    a.eye(37, 30, 5.0, look=(-0.3, 0.05))
    a.brow(23, 22.5, 4.4, 1.8, shade(col, 0.5))
    a.brow(37, 22.5, -4.4, 1.8, shade(col, 0.5))
    a.mouth(30, 41, 7.0, 4.4, shade(col, 0.35))
    return a.resolve()


def jalapeno(col=CHERRY):
    a = Art(48, 66)
    a.shadow(24, 61, 14)
    a.blob([(14, 16), (33, 18), (37, 34), (30, 52), (20, 58), (11, 44), (10, 26)], col)
    a.d.polygon([(a.B(16), a.B(20)), (a.B(30), a.B(22)), (a.B(33), a.B(35)),
                 (a.B(26), a.B(50)), (a.B(19), a.B(52)), (a.B(14), a.B(40)),
                 (a.B(13), a.B(26))], fill=shade(col, 1.10))
    a.gloss(20, 30, 4.0, 9.0, 110)
    a.blob([(14, 17), (32, 19), (31, 9), (16, 8)], "#4f9c2e")
    a.stroke([(23, 9), (25, 1)], "#57ab33", 1.8)
    a.eye(18, 30, 4.6, look=(0.3, 0.0))
    a.eye(29, 31, 4.6, look=(0.3, 0.0))
    a.brow(18, 23, 4.0, 2.0, shade(col, 0.5))
    a.brow(29, 24, -4.0, 2.0, shade(col, 0.5))
    a.mouth(23.5, 41, 4.6, 3.2, shade(col, 0.40))
    return a.resolve()


# ------------------------------------------------------------------ the others
def sun():
    a = Art(64, 64)
    for i in range(12):
        t = math.radians(i * 30)
        a.d.polygon([(a.B(32 + math.cos(t) * 30), a.B(32 + math.sin(t) * 30)),
                     (a.B(32 + math.cos(t + .28) * 17), a.B(32 + math.sin(t + .28) * 17)),
                     (a.B(32 + math.cos(t - .28) * 17), a.B(32 + math.sin(t - .28) * 17))],
                    fill=rgb("#ffb92e"))
    a.ball(32, 32, 19, SUNY, 19, line=0.22)
    a.gloss(26, 25, 6.5, 5.0, 190)
    return a.resolve()


def pea(col="#7ede4a"):
    a = Art(22, 20)
    a.ball(11, 10, 8.5, col, 8.5, line=0.28)
    a.gloss(8, 7, 2.6, 2.0, 210)
    return a.resolve()


def zombie(kind="walker"):
    """Walking left, so the arms reach that way and the eyes follow them."""
    a = Art(66, 96)
    a.shadow(34, 91, 18)
    SKIN, CLOTH = "#9dba74", "#5d6f8f"
    a.blob([(26, 84), (34, 84), (33, 95), (23, 95)], "#2b3442")
    a.blob([(36, 84), (44, 84), (45, 95), (35, 95)], "#39435a")
    a.blob([(24, 46), (46, 46), (48, 76), (42, 86), (28, 86), (22, 76)], CLOTH)
    a.d.polygon([(a.B(24), a.B(62)), (a.B(47), a.B(62)), (a.B(46), a.B(70)),
                 (a.B(30), a.B(74)), (a.B(23), a.B(70))], fill=shade(CLOTH, 0.70))
    a.blob([(27, 49), (9, 45), (5, 52), (26, 58)], SKIN, 0.42)
    a.blob([(27, 58), (11, 57), (8, 65), (27, 66)], SKIN, 0.42)
    a.ball(6, 49, 5.4, SKIN, 5.4)
    a.ball(9, 62, 5.4, SKIN, 5.4)
    a.ball(35, 28, 20, SKIN, 20.5)
    a.d.chord([a.B(15), a.B(7), a.B(55), a.B(35)], 178, 360, fill=rgb("#4a3a2a"))
    a.d.polygon([(a.B(17), a.B(22)), (a.B(24), a.B(12)), (a.B(30), a.B(21))],
                fill=rgb("#4a3a2a"))
    a.eye(28, 26, 5.6, look=(-0.35, 0.1))
    a.eye(42, 26, 5.6, look=(-0.35, 0.1))
    a.brow(28, 18.5, 4.8, -1.6, "#3c3020")
    a.brow(42, 18.5, 4.8, 1.6, "#3c3020")
    a.d.ellipse([a.B(25), a.B(35), a.B(45), a.B(47)], fill=(48, 20, 22))
    a.d.chord([a.B(27), a.B(38), a.B(43), a.B(48)], 0, 180, fill=(124, 48, 52))
    for tx in (27.5, 32.5, 37.5):
        a.d.rounded_rectangle([a.B(tx), a.B(35.5), a.B(tx + 4.2), a.B(40.5)],
                              radius=a.B(0.8), fill=(238, 234, 216))
    if kind == "armoured":                                   # a cone, taken off a road
        a.d.polygon([(a.B(15), a.B(17)), (a.B(35), a.B(-20)), (a.B(55), a.B(17))],
                    fill=rgb("#a8481c"))
        a.d.polygon([(a.B(18), a.B(15)), (a.B(35), a.B(-15)), (a.B(52), a.B(15))],
                    fill=rgb("#e07a38"))
        a.d.polygon([(a.B(23), a.B(5)), (a.B(35), a.B(-15)), (a.B(39), a.B(3))],
                    fill=rgb("#f5a15e"))
        a.d.rectangle([a.B(15), a.B(14), a.B(55), a.B(18)], fill=rgb("#8f3a16"))
    if kind == "sprinter":                                   # helmet, and in a hurry
        a.d.chord([a.B(13), a.B(2), a.B(57), a.B(38)], 180, 360, fill=rgb("#7a2733"))
        a.d.chord([a.B(16), a.B(5), a.B(54), a.B(35)], 180, 360, fill=rgb("#b8434f"))
        a.d.rectangle([a.B(13), a.B(18), a.B(57), a.B(23)], fill=rgb("#5f1d27"))
    return a.resolve()


def turf():
    a = Art(64, 64)
    a.d.rectangle([0, 0, a.B(64), a.B(64)], fill=rgb("#4e8f36"))
    rnd = random.Random(7)
    for _ in range(150):
        x, y = rnd.uniform(0, 64), rnd.uniform(0, 64)
        L = rnd.uniform(2.2, 5.0)
        a.d.line([(a.B(x), a.B(y)), (a.B(x + rnd.uniform(-1, 1)), a.B(y - L))],
                 fill=rgb(rnd.choice(["#5aa03d", "#448030", "#63ad42", "#3d7529"])),
                 width=int(0.8 * SS))
    return a.resolve()


# ------------------------------------------------------------------- the cast
# The fusions are the same drawings in another colour: a Blaze Pea is a
# peashooter drawn in fire, a Frost Tall-nut is a tall-nut drawn in ice.
CAST = {
    # seeds
    "sunflower":    lambda: sunflower(),
    "shooter":      lambda: peashooter(),
    "wall":         lambda: wallnut(),
    "potatomine":   lambda: potatomine(),
    "squash":       lambda: squash(),
    "frost":        lambda: peashooter(ICE, ice=True),
    "bomb":         lambda: cherrybomb(),
    "jalapeno":     lambda: jalapeno(),
    "tallnut":      lambda: wallnut(tall=True),
    "threepeater":  lambda: threepeater(),
    "torchwood":    lambda: torchwood(),
    "chomper":      lambda: chomper(),
    # fusions
    "repeater":     lambda: peashooter(heads=2),
    "gatling":      lambda: peashooter(heads=4),
    "splitpea":     lambda: peashooter(back=True),
    "sunshot":      lambda: peashooter(petals=True),
    "bulwark":      lambda: peashooter(nut=True),
    "sleet":        lambda: peashooter(ICE, ice=True, heads=2),
    "cherryshooter": lambda: peashooter("#e8564a"),
    "blazepea":     lambda: peashooter(FIRE),
    "blazerepeater": lambda: peashooter(FIRE, heads=2),
    "minewall":     lambda: wallnut(studs=True, light=True),
    "cherrynut":    lambda: wallnut("#c8443c", light=True),
    "flametallnut": lambda: wallnut(EMBER, tall=True),
    "frosttallnut": lambda: wallnut("#6fb6cf", tall=True),
    "chompnut":     lambda: chomper(shell=True),
    "chompshooter": lambda: chomper(barrel=True),
    "chompmine":    lambda: potatomine("#8f5fa8"),
    "cherrysquash": lambda: squash("#c8433a"),
    "glacier":      lambda: cherrybomb("#6fc4dd", "#9fdcec"),
    "phoenix":      lambda: threepeater(FIRE),
    "frostthree":   lambda: threepeater(ICE),
    "charredthree": lambda: threepeater(EMBER),
    # bits and ground
    "sun":          lambda: sun(),
    "pea":          lambda: pea(),
    "frostpea":     lambda: pea(ICE),
    "walker":       lambda: zombie("walker"),
    "armoured":     lambda: zombie("armoured"),
    "sprinter":     lambda: zombie("sprinter"),
    "lawn":         lambda: turf(),
}


def uri(im, colors=64):
    """Smooth shading at full depth costs 240 kB across the cast, which is a lot
    to inline for a hidden game. A 64-colour palette is indistinguishable from
    it here and lands at a quarter of the size."""
    b = io.BytesIO()
    im.quantize(colors=colors, method=Image.FASTOCTREE, dither=Image.NONE) \
      .save(b, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(b.getvalue()).decode()


def main():
    art = {k: f() for k, f in CAST.items()}
    if "--sheet" in sys.argv:
        path = sys.argv[sys.argv.index("--sheet") + 1]
        names = [k for k in art if k != "lawn"]
        cols = 10
        rows = (len(names) + cols - 1) // cols
        sheet = Image.new("RGBA", (cols * 92, rows * 118), (78, 143, 54, 255))
        sheet.paste(art["lawn"].resize((sheet.width, sheet.height)), (0, 0))
        d = ImageDraw.Draw(sheet)
        for i, k in enumerate(names):
            im = art[k]
            sc = min(88 / im.height, 84 / im.width)
            big = im.resize((max(1, int(im.width * sc)), max(1, int(im.height * sc))),
                            Image.LANCZOS)
            ox, oy = (i % cols) * 92, (i // cols) * 118
            sheet.alpha_composite(big, (ox + (88 - big.width) // 2, oy + 96 - big.height))
            d.text((ox + 6, oy + 102), k, fill=(255, 255, 255))
        sheet.save(path)
        print("sheet:", path, "-", len(art), "sprites", file=sys.stderr)
        return
    for k, im in art.items():
        print("      %-13s: '%s'," % (k, uri(im)))


if __name__ == "__main__":
    main()
