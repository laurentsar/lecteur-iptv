#!/usr/bin/env python3
"""Génère les icônes de l'app en PNG, sans dépendance (ni Pillow ni ImageMagick).

Motif : un écran (rectangle aux coins arrondis) avec un bouton lecture au
centre — lisible à 48 px, cohérent avec le thème sombre/turquoise de l'app.

Sorties :
  www/img/icon-512.png / icon-192.png : icône pleine (fond compris)
  www/img/icon-flat.png               : copie 512 pour les icônes Android legacy
  www/img/icon-mark.png               : logo seul sur fond transparent, cadré
                                        dans la zone de sécurité (adaptive icon)
"""
import struct, zlib

BG = (11, 20, 32, 255)        # ardoise sombre
SCREEN = (22, 39, 58, 255)    # écran
ACCENT = (63, 199, 199, 255)  # turquoise


def blend(dst, src):
    a = src[3] / 255.0
    if a >= 1:
        return src
    return tuple(int(src[i] * a + dst[i] * (1 - a)) for i in range(3)) + (255,)


def rounded_rect_mask(x, y, x0, y0, x1, y1, r):
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    if x0 + r <= x <= x1 - r or y0 + r <= y <= y1 - r:
        return x0 <= x <= x1 and y0 <= y <= y1
    return ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 <= r


def in_triangle(px, py, ax, ay, bx, by, cx, cy):
    def sign(x1, y1, x2, y2, x3, y3):
        return (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3)
    d1 = sign(px, py, ax, ay, bx, by)
    d2 = sign(px, py, bx, by, cx, cy)
    d3 = sign(px, py, cx, cy, ax, ay)
    has_neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
    has_pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
    return not (has_neg and has_pos)


def draw(size, with_bg=True, inset=0.0):
    """inset : marge relative (0.17 = logo cadré dans 66 % du carré)."""
    S = size
    img = [[(0, 0, 0, 0)] * S for _ in range(S)]

    def X(u):
        return (inset + u * (1 - 2 * inset)) * S

    def Y(v):
        return (inset + v * (1 - 2 * inset)) * S

    if with_bg:
        r = S * 0.22
        for y in range(S):
            for x in range(S):
                if rounded_rect_mask(x, y, 0, 0, S - 1, S - 1, r):
                    img[y][x] = BG

    # écran
    sx0, sy0, sx1, sy1 = X(0.12), Y(0.16), X(0.88), Y(0.78)
    sr = S * 0.05
    for y in range(int(sy0), int(sy1) + 1):
        for x in range(int(sx0), int(sx1) + 1):
            if rounded_rect_mask(x, y, sx0, sy0, sx1, sy1, sr):
                img[y][x] = blend(img[y][x], SCREEN) if img[y][x][3] else SCREEN

    # pied de l'écran
    for y in range(int(Y(0.78)), int(Y(0.88))):
        for x in range(int(X(0.44)), int(X(0.56))):
            img[y][x] = blend(img[y][x], SCREEN) if img[y][x][3] else SCREEN

    # triangle "lecture"
    ax, ay = X(0.40), Y(0.30)
    bx, by = X(0.40), Y(0.64)
    cx, cy = X(0.66), Y(0.47)
    for y in range(int(ay), int(by) + 1):
        for x in range(int(ax), int(cx) + 1):
            if in_triangle(x + 0.5, y + 0.5, ax, ay, bx, by, cx, cy):
                img[y][x] = blend(img[y][x], ACCENT) if img[y][x][3] else ACCENT
    return img


def write_png(path, img):
    S = len(img)
    raw = b''.join(b'\x00' + b''.join(struct.pack('4B', *px) for px in row) for row in img)
    comp = zlib.compress(raw, 9)

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', S, S, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', comp)
           + chunk(b'IEND', b''))
    open(path, 'wb').write(png)
    print(path, S, 'px')


if __name__ == '__main__':
    full = draw(512, with_bg=True)
    write_png('www/img/icon-512.png', full)
    write_png('www/img/icon-flat.png', full)
    write_png('www/img/icon-192.png', draw(192, with_bg=True))
    write_png('www/img/icon-mark.png', draw(512, with_bg=False, inset=0.17))
