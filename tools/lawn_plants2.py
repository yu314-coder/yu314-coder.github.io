"""Lawn Siege, second sprite pass: four more plants and the hybrids they open.

Run from the repo root; it prints the ART entries to paste into
assets/js/main.js. The four plants are drawn here from shapes. The hybrids are
existing sprites pushed to a new hue -- the shape is the plant you fused, the
colour is what it fused with, which is how the icy hybrids already in the game
were made.

    python3 tools/lawn_plants2.py > /tmp/art.js
"""
import base64, colorsys, io, os, re

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAIN = os.path.join(HERE, "assets", "js", "main.js")


def shipped(name):
    """Pull a sprite that is already in the game back out of main.js."""
    src = io.open(MAIN, encoding="utf-8").read()
    m = re.search(r"\b" + name + r"\s*:\s*'data:image/png;base64,([A-Za-z0-9+/=]+)'", src)
    if not m:
        raise SystemExit("no sprite called " + name + " in main.js")
    return Image.open(io.BytesIO(base64.b64decode(m.group(1)))).convert("RGBA")


SS = 6                                   # supersample, then box-filter down

NUT_D, NUT_M, NUT_L = "#513f11", "#79611b", "#a4862c"
LEAF_D, LEAF_M, LEAF_L = "#354922", "#529722", "#7bba3e"
INK = "#000000"
EYE_W, EYE_K = "#faf6e8", "#16202c"


def canvas(w, h):
    im = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)


def B(v):
    return int(round(v * SS))


def ell(d, x0, y0, x1, y1, fill, outline=None, w=1):
    d.ellipse([B(x0), B(y0), B(x1), B(y1)], fill=fill,
              outline=outline, width=B(w) if outline else 0)


def poly(d, pts, fill, outline=None, w=1):
    d.polygon([(B(x), B(y)) for x, y in pts], fill=fill,
              outline=outline, width=B(w) if outline else 0)


def eyes(d, cx, cy, sp, r, angry=False, look=0):
    for s in (-1, 1):
        x = cx + s * sp
        ell(d, x - r, cy - r, x + r, cy + r, EYE_W, INK, 1)
        p = r * 0.46
        ell(d, x - p + look, cy - p, x + p + look, cy + p, EYE_K)
    if angry:
        for s in (-1, 1):
            x = cx + s * sp
            d.line([(B(x - s * r * 1.1), B(cy - r * 1.5)), (B(x + s * r * 0.4), B(cy - r * 0.8))],
                   fill=INK, width=B(1.6))


def finish(im, w, h):
    """Down to size, then snap alpha and colours so it reads as pixel art."""
    im = im.resize((w, h), Image.BOX)
    px = im.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 120:
                px[x, y] = (0, 0, 0, 0)
            else:
                q = lambda v: min(255, (v + 8) // 17 * 17)
                px[x, y] = (q(r), q(g), q(b), 255)
    return im


# ---------------------------------------------------------------- potato mine
def potato_mine():
    W, H = 42, 38
    im, d = canvas(W, H)
    ell(d, 3, 6, W - 3, H - 3, "#5c421c", INK, 2)                                    # tuber
    ell(d, 6, 9, W - 7, H - 6, "#a87f3c")
    ell(d, 9, 11, W - 16, H - 17, "#d0a558")
    for cx, cy in ((11, 27), (31, 22), (24, 31)):                                    # eyes of the potato
        ell(d, cx - 2, cy - 1.6, cx + 2, cy + 1.6, "#6a4a20")
    poly(d, [(19, 7), (15, 1), (22, 3), (25, 0), (24, 7)], LEAF_M, INK, 1.2)         # sprout
    eyes(d, W / 2 - 1, 18, 7.5, 5.2, angry=True)
    poly(d, [(W / 2 - 7, 27), (W / 2 + 5, 27), (W / 2 + 3, 32), (W / 2 - 5, 32)],    # grimace
         "#3a2610", INK, 1.2)
    ell(d, W - 12, 9, W - 5, 16, "#8a1c12", INK, 1.4)                                # the light
    ell(d, W - 11, 10, W - 6.5, 14.5, "#ff4d3a")
    ell(d, W - 10.4, 10.6, W - 8.6, 12.4, "#ffe2da")
    return finish(im, W, H)


# ------------------------------------------------------------------- tall-nut
def tall_nut():
    W, H = 40, 62
    im, d = canvas(W, H)
    ell(d, 3, 2, W - 3, H - 2, NUT_D, INK, 1.8)                                      # shell
    ell(d, 6, 5, W - 7, H - 5, NUT_M)
    ell(d, 9, 8, W - 14, H * 0.55, "#a4862c")
    for i in range(5):                                                               # wood grain
        y = 12 + i * 9
        d.arc([B(7), B(y), B(W - 8), B(y + 13)], 200, 340, fill=NUT_D, width=B(1.2))
    eyes(d, W / 2, 26, 8.5, 6.0, angry=True)
    poly(d, [(W / 2 - 9, 40), (W / 2 + 9, 40), (W / 2 + 6, 47), (W / 2 - 6, 47)],    # set jaw
         "#2a1a10", INK, 1.4)
    d.line([(B(W / 2 - 6), B(43.5)), (B(W / 2 + 6), B(43.5))], fill="#b67b6e", width=B(1.2))
    return finish(im, W, H)


# --------------------------------------------------------------------- squash
def squash():
    W, H = 44, 46
    im, d = canvas(W, H)
    ell(d, 4, 12, W - 4, H - 3, "#3d6b1c", INK, 1.8)                                 # body
    ell(d, 7, 15, W - 8, H - 6, "#59952c")
    ell(d, 10, 17, W - 17, H - 20, "#7bba3e")
    for x in (13, 22, 31):                                                           # ribs
        d.arc([B(x - 8), B(14), B(x + 8), B(H - 4)], 250, 290, fill="#2f5416", width=B(2.2))
    poly(d, [(W / 2 - 3, 13), (W / 2 - 2, 3), (W / 2 + 3, 3), (W / 2 + 2, 13)],      # stalk
         "#4a3a16", INK, 1.2)
    poly(d, [(W / 2 + 2, 7), (W / 2 + 12, 2), (W / 2 + 11, 9)], LEAF_M, INK, 1)      # leaf
    eyes(d, W / 2, 24, 8.5, 5.6, angry=True)
    ell(d, W / 2 - 7, 32, W / 2 + 7, 41, "#1d2a10", INK, 1.4)                        # open mouth
    ell(d, W / 2 - 4, 37, W / 2 + 4, 41, "#a8434f")
    return finish(im, W, H)


# ------------------------------------------------------------------- jalapeno
def jalapeno():
    W, H = 36, 52
    im, d = canvas(W, H)
    poly(d, [(12, 10), (26, 12), (29, 24), (24, 40), (16, 47), (9, 38), (8, 22)],    # pod
         "#b32419", INK, 1.8)
    poly(d, [(14, 13), (24, 15), (26, 25), (21, 39), (16, 43), (12, 35), (11, 22)], "#e0392a")
    poly(d, [(15, 16), (21, 18), (21, 28), (16, 34), (14, 24)], "#f57a5f")
    poly(d, [(13, 11), (23, 12), (22, 6), (14, 6)], LEAF_D, INK, 1.2)                # cap
    poly(d, [(17, 7), (19, 1), (21, 7)], LEAF_M, INK, 1)                             # stem
    eyes(d, 18, 22, 5.6, 4.0, angry=True)
    poly(d, [(14, 30), (22, 30), (18, 36)], "#3a0d08", INK, 1)                       # shouting mouth
    return finish(im, W, H)


def uri(im):
    b = io.BytesIO()
    im.save(b, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(b.getvalue()).decode()


def tint(name, hue, sat=1.0, val=1.0, keep_eyes=True):
    im = SPRITES[name].copy()
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a < 8:
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if v < 0.20:                      # keyline stays black
                continue
            if keep_eyes and s < 0.16 and v > 0.72:   # eye whites stay white
                continue
            nr, ng, nb = colorsys.hsv_to_rgb(hue, min(1, s * sat + 0.30), min(1, v * val))
            px[x, y] = (int(nr * 255), int(ng * 255), int(nb * 255), a)
    return im


BLAZE, EMBER, FROST, CHERRY, VENOM = 0.055, 0.028, 0.55, 0.99, 0.78

SPRITES = {"potatomine": potato_mine(), "tallnut": tall_nut(),
           "squash": squash(), "jalapeno": jalapeno()}
for k in ("wall", "shooter", "repeater", "threepeater", "chomper"):
    SPRITES[k] = shipped(k)

SPRITES.update({
    "cherrynut":     tint("wall", CHERRY, 1.15),
    "blazepea":      tint("shooter", BLAZE, 1.2, 1.05),
    "blazerepeater": tint("repeater", BLAZE, 1.2, 1.05),
    "flametallnut":  tint("tallnut", EMBER, 1.2, 1.05),
    "frosttallnut":  tint("tallnut", FROST, 1.0, 1.1),
    "charredthree":  tint("threepeater", EMBER, 1.15),
    "chompshooter":  tint("chomper", 0.30, 1.0),
    "cherrysquash":  tint("squash", CHERRY, 1.1),
    "chompmine":     tint("potatomine", VENOM, 1.0),
})


def uri(im):
    b = io.BytesIO()
    im.save(b, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(b.getvalue()).decode()


for key, im in SPRITES.items():
    if key in ("wall", "shooter", "repeater", "threepeater", "chomper"):
        continue                      # already in the game
    print("      %-13s: '%s'," % (key, uri(im)))
