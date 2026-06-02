#!/usr/bin/env python3
"""Generate flat clock-style PNG icons with only the Python stdlib.
Re-run this if you want to tweak the colors."""
import zlib, struct, math, os

BG      = (0x12, 0x1b, 0x24)   # dark slate
RING    = (0x3d, 0xd6, 0xb0)   # teal accent
HAND    = (0xe8, 0xf0, 0xf4)   # near white
OUTDIR  = os.path.join(os.path.dirname(__file__), "icons")


def write_png(path, size, pixels):
    """pixels: flat list of (r,g,b) length size*size."""
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type 0
        for x in range(size):
            r, g, b = pixels[y * size + x]
            raw += bytes((r, g, b))
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit RGB
    idat = zlib.compress(bytes(raw), 9)
    with open(path, "wb") as f:
        f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))


def render(size):
    cx = cy = (size - 1) / 2
    R = size * 0.50          # corner radius of rounded square (so it's a circle bg)
    ring_r = size * 0.34
    ring_w = size * 0.055
    px = []
    for y in range(size):
        for x in range(size):
            dx, dy = x - cx, y - cy
            d = math.hypot(dx, dy)
            col = BG
            # rounded-square background filling whole canvas -> just fill
            # ring
            if abs(d - ring_r) <= ring_w:
                col = RING
            px.append(col)
    # clock hands: hour hand up-right, minute hand up
    def draw_line(px, size, x0, y0, ang_deg, length, width, color):
        ang = math.radians(ang_deg)
        ex = x0 + math.cos(ang) * length
        ey = y0 + math.sin(ang) * length
        steps = int(length * 3) + 1
        for i in range(steps + 1):
            t = i / steps
            lx = x0 + (ex - x0) * t
            ly = y0 + (ey - y0) * t
            ri = int(width)
            for yy in range(int(ly) - ri, int(ly) + ri + 1):
                for xx in range(int(lx) - ri, int(lx) + ri + 1):
                    if 0 <= xx < size and 0 <= yy < size:
                        if math.hypot(xx - lx, yy - ly) <= width:
                            px[yy * size + xx] = color
    draw_line(px, size, cx, cy, -90, size * 0.20, size * 0.022, HAND)   # minute up
    draw_line(px, size, cx, cy, -20, size * 0.13, size * 0.026, HAND)   # hour
    # center dot
    for yy in range(size):
        for xx in range(size):
            if math.hypot(xx - cx, yy - cy) <= size * 0.03:
                px[yy * size + xx] = HAND
    return px


for s in (180, 192, 512):
    write_png(os.path.join(OUTDIR, f"icon-{s}.png"), s, render(s))
    print("wrote", f"icon-{s}.png")
