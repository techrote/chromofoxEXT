"""Generate high-contrast, self-contained local PNG icons; no external assets."""
from pathlib import Path
from PIL import Image, ImageDraw

DIR = Path(__file__).resolve().parent.parent / "icons"
DIR.mkdir(exist_ok=True)
PALETTE = {
    "default": (34, 44, 60),
    "working": (40, 117, 212),
    "done": (19, 133, 93),
    "stopped": (114, 123, 139),
    "error": (200, 63, 70)
}


def render(phase, size):
    scale = 8
    n = size * scale
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    def v(nrm): return round(nrm * n / 64)
    bg = PALETTE[phase]
    d.rounded_rectangle((v(2), v(2), v(62), v(62)), radius=v(17), fill=(*bg, 255))
    # Bold white symbols remain identifiable at 16 physical pixels.
    if phase == "working":
        d.rounded_rectangle((v(22), v(22), v(42), v(42)), radius=v(3), fill="white")
    elif phase == "done":
        d.line([(v(15), v(33)), (v(27), v(44)), (v(48), v(20))], fill="white", width=v(8), joint="curve")
        for xy in [(15,33),(27,44),(48,20)]:
            d.ellipse((v(xy[0]-4),v(xy[1]-4),v(xy[0]+4),v(xy[1]+4)), fill="white")
    elif phase == "stopped":
        d.rounded_rectangle((v(17), v(29), v(47), v(36)), radius=v(3), fill="white")
    elif phase == "error":
        d.rounded_rectangle((v(28),v(14),v(36),v(38)), radius=v(3), fill="white")
        d.ellipse((v(28),v(44),v(36),v(52)), fill="white")
    else:
        # Generic speech bubble + activity lines, deliberately not an OpenAI logo.
        d.rounded_rectangle((v(13),v(14),v(51),v(45)), radius=v(10), fill="white")
        d.polygon([(v(22),v(43)),(v(22),v(52)),(v(33),v(44))], fill="white")
        for x in [24,32,40]:
            d.ellipse((v(x-2.5),v(27.5),v(x+2.5),v(32.5)), fill=(*bg,255))
    return img.resize((size,size), Image.Resampling.LANCZOS)

for n in [16,32,48,128]:
    render("default", n).save(DIR / f"default{n}.png", optimize=True)
for state in ["working","done","stopped","error"]:
    render(state,64).save(DIR / f"{state}64.png", optimize=True)
