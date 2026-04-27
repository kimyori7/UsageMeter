# scripts/build_icons.py
"""One-off icon generator. Run once: python scripts/build_icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "assets"
OUT.mkdir(parents=True, exist_ok=True)


def make_icon(text: str, bg: tuple, fg: tuple, filename: str) -> None:
    sizes = [(256, 256), (128, 128), (64, 64), (32, 32), (16, 16)]
    images = []
    for size in sizes:
        img = Image.new("RGBA", size, bg)
        draw = ImageDraw.Draw(img)
        try:
            font = ImageFont.truetype("arial.ttf", int(size[0] * 0.5))
        except OSError:
            font = ImageFont.load_default()
        bbox = draw.textbbox((0, 0), text, font=font)
        w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
        draw.text(
            ((size[0] - w) / 2 - bbox[0], (size[1] - h) / 2 - bbox[1]),
            text,
            font=font,
            fill=fg,
        )
        images.append(img)
    images[0].save(OUT / filename, sizes=sizes)


if __name__ == "__main__":
    make_icon("CM", (200, 90, 50, 255), (255, 255, 255, 255), "icon.ico")
    make_icon("CM", (110, 110, 110, 255), (200, 200, 200, 255), "icon_inactive.ico")
    print(f"Wrote icons to {OUT}")
