#!/usr/bin/env python3
"""Generate App Store mockups with gradient backgrounds + Russian text."""

from PIL import Image, ImageDraw, ImageFilter
import os, math

# ── Config ──────────────────────────────────────────────────────────────────
CANVAS_W, CANVAS_H = 1290, 2796
PHONE_FOLDER = "apple-iphone-15-pro-natural-titanium-mockup"
OUT_FOLDER   = "app-store-final"
FONT_REG  = "/System/Library/Fonts/SFNS.ttf"
FONT_BOLD = "/System/Library/Fonts/SFNS.ttf"

MODULES = {
    "manager":   {
        "file":     "Simulator Screenshot - iPhone 17 Pro - 2026-06-17 at 14.39.52-portrait.png",
        "color":    (0, 122, 255),
        "headline": "Контроль кассы",
        "sub":      "Доход · Расходы · Инкассация · Команда",
    },
    "analytics": {
        "file":     "Simulator Screenshot - iPhone 17 Pro - 2026-06-17 at 14.39.56-portrait.png",
        "color":    (52, 199, 89),
        "headline": "Аналитика в реальном времени",
        "sub":      "Выручка · Прибыль · Прогнозы · Зарплата",
    },
    "people":    {
        "file":     "Simulator Screenshot - iPhone 17 Pro - 2026-06-17 at 14.52.21-portrait.png",
        "color":    (88, 86, 214),
        "headline": "Управление командой",
        "sub":      "График · Явка · Задачи · Зарплата",
    },
    "stash":     {
        "file":     "Simulator Screenshot - iPhone 17 Pro - 2026-06-17 at 14.57.31-portrait.png",
        "color":    (255, 149, 0),
        "headline": "Склад под контролем",
        "sub":      "Остатки · Движения · Алерты · Инвентарь",
    },
}

# ── Helpers ──────────────────────────────────────────────────────────────────
def load_font(path, size):
    from PIL import ImageFont
    return ImageFont.truetype(path, size)

def draw_text_centered(draw, text, y, font, color):
    bbox = draw.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    x = (CANVAS_W - w) // 2
    draw.text((x, y), text, font=font, fill=color)
    return bbox[3] - bbox[1]   # height

def fit_font(font_path, size, text, max_width, min_size=40):
    """Return a font at the largest size that fits text within max_width."""
    from PIL import ImageFont
    while size >= min_size:
        f = ImageFont.truetype(font_path, size)
        from PIL import ImageDraw, Image as _Image
        tmp = _Image.new("RGB", (1, 1))
        d = ImageDraw.Draw(tmp)
        bbox = d.textbbox((0, 0), text, font=f)
        if bbox[2] - bbox[0] <= max_width:
            return f
        size -= 4
    return ImageFont.truetype(font_path, min_size)

def radial_glow(size, color, radius_fraction=0.5):
    """Return an RGBA image with a soft radial glow."""
    w, h = size
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    cx, cy = w // 2, h // 2
    radius = int(min(w, h) * radius_fraction)
    for y in range(h):
        for x in range(w):
            dist = math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
            if dist < radius:
                alpha = int(255 * (1 - dist / radius) ** 2 * 0.55)
                glow.putpixel((x, y), (*color, alpha))
    return glow.filter(ImageFilter.GaussianBlur(radius // 4))


def make_mockup(module_id, cfg, script_dir):
    from PIL import ImageFont
    r, g, b = cfg["color"]

    # ── Canvas ────────────────────────────────────────────────────────────
    canvas = Image.new("RGB", (CANVAS_W, CANVAS_H), (8, 8, 10))

    # ── Background glow (upper half) ──────────────────────────────────────
    glow_w, glow_h = CANVAS_W, CANVAS_H // 2
    glow = Image.new("RGBA", (glow_w, glow_h), (0, 0, 0, 0))
    draw_glow = ImageDraw.Draw(glow)
    cx, cy = glow_w // 2, glow_h // 2
    radius = int(min(glow_w, glow_h) * 0.65)
    for dy in range(-radius, radius):
        for dx in range(-radius, radius):
            dist = math.sqrt(dx*dx + dy*dy)
            if dist < radius:
                alpha = int(200 * (1 - dist / radius)**2.2)
                px, py = cx + dx, cy + dy
                if 0 <= px < glow_w and 0 <= py < glow_h:
                    cur = glow.getpixel((px, py))
                    new_a = min(255, cur[3] + alpha)
                    glow.putpixel((px, py), (r, g, b, new_a))
    glow = glow.filter(ImageFilter.GaussianBlur(80))
    canvas.paste(Image.new("RGB", (glow_w, glow_h), (8, 8, 10)), (0, 0))
    canvas.paste(glow, (0, 0), glow)

    # Same glow mirrored to bottom
    glow2 = glow.transpose(Image.FLIP_TOP_BOTTOM)
    canvas.paste(glow2, (0, CANVAS_H - glow_h), glow2)

    draw = ImageDraw.Draw(canvas)

    # ── Fonts ─────────────────────────────────────────────────────────────
    font_wordmark = load_font(FONT_BOLD, 72)
    font_headline = fit_font(FONT_BOLD, 96, cfg["headline"], CANVAS_W - 80)
    font_sub      = fit_font(FONT_REG,  52, cfg["sub"],      CANVAS_W - 80)

    # ── "mise" wordmark ───────────────────────────────────────────────────
    WORDMARK_Y = 90
    # Draw "mis" in white, "e" in accent
    mis_font = load_font(FONT_BOLD, 72)
    e_font   = load_font(FONT_BOLD, 72)

    mis_text = "mis"
    e_text   = "e"
    mis_bbox = draw.textbbox((0, 0), mis_text, font=mis_font)
    e_bbox   = draw.textbbox((0, 0), e_text,   font=e_font)
    full_w   = (mis_bbox[2] - mis_bbox[0]) + (e_bbox[2] - e_bbox[0])
    start_x  = (CANVAS_W - full_w) // 2
    draw.text((start_x, WORDMARK_Y), mis_text, font=mis_font, fill=(255, 255, 255))
    draw.text((start_x + mis_bbox[2] - mis_bbox[0], WORDMARK_Y), e_text,
              font=e_font, fill=(r, g, b))

    # ── Headline ──────────────────────────────────────────────────────────
    HEADLINE_Y = WORDMARK_Y + 90 + 32
    draw_text_centered(draw, cfg["headline"], HEADLINE_Y, font_headline, (255, 255, 255))

    # ── Phone image ───────────────────────────────────────────────────────
    phone_path = os.path.join(script_dir, PHONE_FOLDER, cfg["file"])
    phone = Image.open(phone_path).convert("RGBA")
    ph_w, ph_h = phone.size

    # Scale phone to 77% of canvas width
    scale = (CANVAS_W * 0.77) / ph_w
    new_w = int(ph_w * scale)
    new_h = int(ph_h * scale)
    phone = phone.resize((new_w, new_h), Image.LANCZOS)

    # Center horizontally; vertically: top of phone below headline
    PHONE_TOP = HEADLINE_Y + 130
    PHONE_X   = (CANVAS_W - new_w) // 2

    # Composite phone onto canvas
    bg = canvas.convert("RGBA")
    bg.paste(phone, (PHONE_X, PHONE_TOP), phone)
    canvas = bg.convert("RGB")
    draw   = ImageDraw.Draw(canvas)

    # ── Subtitle below phone ──────────────────────────────────────────────
    phone_bottom = PHONE_TOP + new_h
    SUB_Y = phone_bottom + 40
    if SUB_Y + 70 > CANVAS_H:
        # If phone is too tall, overlap slightly (place text at fixed bottom)
        SUB_Y = CANVAS_H - 90
    draw_text_centered(draw, cfg["sub"], SUB_Y, font_sub, (255, 255, 255, int(255*0.65)))

    # ── Save ──────────────────────────────────────────────────────────────
    out_dir = os.path.join(script_dir, OUT_FOLDER)
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"{module_id}-ru.png")
    canvas.save(out_path, "PNG", optimize=True)
    print(f"  Saved: {out_path}  (phone: {new_w}×{new_h}, top={PHONE_TOP})")
    return out_path


if __name__ == "__main__":
    script_dir = os.path.dirname(os.path.abspath(__file__))
    print(f"Generating {len(MODULES)} mockups in {script_dir}/{OUT_FOLDER}/\n")
    for mid, cfg in MODULES.items():
        print(f"→ {mid}…")
        make_mockup(mid, cfg, script_dir)
    print("\nDone.")
