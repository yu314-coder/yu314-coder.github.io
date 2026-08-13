# Third-party notices

Components in this repository that were written by someone else, and the terms
they came under.

---

## Lawn Siege sprites — Zombie Garden Tower Defense

The pixel art in the hidden arcade's **Lawn Siege** game (inlined as data URIs in
`assets/js/main.js`, under `LawnGame.ART`) comes from
[JamesC01/ZombieGardenTD](https://github.com/JamesC01/ZombieGardenTD), whose
README credits *"Code, sound effects, music, art: James Czekaj"*.

Used under the MIT licence. Several sprites are **modifications** of that art,
which the licence permits — the frost plant and its pea are the seed-shooter and
seed recoloured, the armoured attacker is the walker with a helmet drawn on, and
the six fusion hybrids are composites of the plants (a second head for the
Repeater, petals behind the Sunshot, a shooter set on the coconut for the
Bulwark, studs on the Mine-nut, and icy recolours for Sleet and the Glacier).

```
MIT License

Copyright (c) 2024 James Czekaj

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**What this art is not.** It is not from Plants vs. Zombies. ZombieGardenTD is an
independent game whose author drew his own sprites; its README notes that PopCap
placeholders appeared only in early commits, and the current files are his. No
PopCap asset is used here, and none should be added — being free to download is
not a licence to redistribute.

`tools/lawn_sprites.py` still contains the original sprite set this project drew
before adopting these, should a fully self-owned set ever be wanted again.
