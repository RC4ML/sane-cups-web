#!/usr/bin/env python3
"""Synthetic, unembedded GBK invoice fonts; no customer documents in CI."""
import sys
from pathlib import Path


def make_pdf(path):
    objects = [b'', b'', b'']
    font_refs = []
    for font in ('KaiTi', 'SimSun', 'SimHei'):
        ref = len(objects) + 1
        font_refs.append(ref)
        objects.extend([
            f'<< /Type /Font /Subtype /Type0 /BaseFont /{font} /Encoding /GBK-EUC-H /DescendantFonts [{ref + 1} 0 R] >>'.encode(),
            f'<< /Type /Font /Subtype /CIDFontType2 /BaseFont /{font} /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 5 >> /FontDescriptor {ref + 2} 0 R /DW 1000 >>'.encode(),
            f'<< /Type /FontDescriptor /FontName /{font} /Flags 4 /FontBBox [-100 -250 1100 1000] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>'.encode(),
        ])
    commands = []
    for i in range(3):
        for y, text in [(350 - i * 110, '中文发票杭州无锡'), (310 - i * 110, 'G7792 ABC 0123 ￥143.00')]:
            commands.append(f'BT /F{i} 18 Tf 40 {y} Td <{text.encode("gbk").hex()}> Tj ET')
    content = '\n'.join(commands).encode()
    content_ref = len(objects) + 1
    objects.append(f'<< /Length {len(content)} >>\nstream\n'.encode() + content + b'\nendstream')
    objects[0] = b'<< /Type /Catalog /Pages 2 0 R >>'
    objects[1] = b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>'
    fonts = ' '.join(f'/F{i} {ref} 0 R' for i, ref in enumerate(font_refs))
    objects[2] = f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 400] /Resources << /Font << {fonts} >> >> /Contents {content_ref} 0 R >>'.encode()
    data = bytearray(b'%PDF-1.4\n')
    offsets = [0]
    for i, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(f'{i} 0 obj\n'.encode() + obj + b'\nendobj\n')
    xref = len(data)
    data.extend(f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode())
    for offset in offsets[1:]:
        data.extend(f'{offset:010d} 00000 n \n'.encode())
    data.extend(f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode())
    path.write_bytes(data)


def check_render(path):
    # Check actual ink in every Chinese and Latin row. This catches the Droid
    # fallback regression where Chinese renders but Latin text disappears.
    with path.open('rb') as f:
        assert f.readline().strip() == b'P5'
        line = f.readline()
        while line.startswith(b'#'):
            line = f.readline()
        width, height = map(int, line.split())
        assert (width, height) == (500, 400)
        assert int(f.readline()) == 255
        pixels = f.read()
    assert len(pixels) == width * height
    for i in range(3):
        for label, baseline, x1, x2 in [('Chinese', 350-i*110, 40, 185), ('Latin', 310-i*110, 40, 125)]:
            ink = sum(pixels[y*width+x] < 200
                      for y in range(height-baseline-22, height-baseline+4)
                      for x in range(x1, x2))
            assert ink > 100, f'Font {i} {label} text is missing ({ink} pixels)'
    print('Chinese and Latin rendering passed for all three fonts')


if __name__ == '__main__':
    {'make': make_pdf, 'check': check_render}[sys.argv[1]](Path(sys.argv[2]))
