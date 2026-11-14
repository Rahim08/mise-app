"""Static layout preview for the web Shifts tab; amounts are sample data."""
from pathlib import Path
from html import escape

out = Path(__file__).parent / "design-overview" / "shifts-proposed.svg"

def rect(x, y, w, h, fill, r=0, stroke=None):
    border = f' stroke="{stroke}"' if stroke else ""
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"{border}/>'

def label(x, y, value, size=14, color="#27313d", weight=400):
    return f'<text x="{x}" y="{y}" font-family="Arial,sans-serif" font-size="{size}" font-weight="{weight}" fill="{color}">{escape(value)}</text>'

def line(x1, y1, x2, y2):
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="#e6e9ee"/>'

def card(x, y, w, h):
    return rect(x, y, w, h, "#ffffff", 16, "#e5e8ed")

a = [rect(0, 0, 1440, 900, "#f5f6f8"), rect(0, 0, 240, 900, "#f8f9fb"), line(240, 0, 240, 900)]
a += [label(30, 48, "mise", 28, "#232830", 800), label(30, 105, "РАБОЧЕЕ ПРОСТРАНСТВО", 10, "#8b95a1", 700)]
a += [label(30, 147, "СЕГОДНЯ  ⌄", 11, "#84909e", 700), label(40, 189, "Обзор", 15, "#66727f"), rect(16, 210, 208, 39, "#e9effb", 10), label(40, 235, "Смены", 15, "#2c62ac", 700), label(40, 284, "Брони", 15, "#66727f"), label(40, 327, "Уведомления", 15, "#66727f")]
a += [label(30, 386, "АНАЛИЗ  ›", 11, "#84909e", 700), label(30, 432, "УПРАВЛЕНИЕ  ›", 11, "#84909e", 700), label(30, 478, "НАСТРОЙКИ  ›", 11, "#84909e", 700)]
a += [label(278, 52, "Смены", 29, "#20242d", 750), label(278, 79, "Касса сегодня и история смен", 14, "#7f8792"), rect(1158, 27, 221, 29, "#e8f0ff", 15), label(1176, 47, "КОНЦЕПТ · ПРИМЕР ДАННЫХ", 11, "#3f68a5", 700)]
a += [card(278, 111, 1102, 66), label(301, 151, "‹", 28, "#5476a6"), label(335, 143, "26 сентября 2026", 17, "#27313d", 700), label(335, 163, "Суббота · 26 из 30", 12, "#788592"), label(495, 151, "›", 28, "#5476a6"), rect(1270, 129, 84, 28, "#e9f6ee", 14), label(1284, 148, "Открыта", 12, "#348b57", 700)]
for x, w, title, value, note in [(278, 430, "ВЫРУЧКА СМЕНЫ", "€4 100", "Наличные €1 240 · Карта €2 860"), (722, 322, "КАССА НА КОНЕЦ СМЕНЫ", "€980", "Ожидаемый остаток"), (1058, 322, "ОБЩИЕ СПИСАНИЯ", "€260", "Расходы €200 · Инкассация €60")]:
    a += [card(x, 193, w, 154), label(x+22, 224, title, 11, "#7a8694", 700), label(x+22, 285, value, 40, "#27313d", 750), label(x+22, 318, note, 13, "#788592")]
a += [card(278, 363, 620, 205), label(302, 397, "Сотрудники", 17, "#27313d", 700)]
for y, person, money in [(437, "Анна", "€0"), (480, "Марко", "€35"), (523, "Ольга", "€0")]:
    a += [line(302, y+10, 874, y+10), label(302, y, person, 14), label(791, y, money, 14, "#4d5e72", 650), rect(849, y-18, 24, 24, "#f1f3f6", 12)]
a += [card(278, 582, 620, 249), label(302, 617, "Расходы дня", 17, "#27313d", 700)]
for y, name, money in [(658, "Продукты", "€110"), (707, "Доставка", "€55"), (756, "Прочее", "€35")]:
    a += [line(302, y+14, 874, y+14), label(302, y, name, 14), label(791, y, money, 14, "#4d5e72", 650)]
a += [card(912, 363, 468, 165), label(936, 397, "Инкассация", 17, "#27313d", 700), label(936, 439, "Сумма", 14, "#627080"), label(1276, 439, "€60", 15, "#27313d", 650), line(936, 455, 1356, 455), label(936, 485, "Назначение", 14, "#627080"), label(1202, 485, "В банк", 14, "#27313d")]
a += [card(912, 542, 468, 289), label(936, 577, "Касса", 17, "#27313d", 700)]
for y, name, money in [(618, "Наличные", "€1 240"), (663, "Карта", "€2 860"), (708, "Расходы", "−€200"), (753, "Инкассация", "−€60")]:
    a += [line(936, y+13, 1356, y+13), label(936, y, name, 14, "#627080"), label(1265, y, money, 15, "#27313d", 650)]
a += [label(936, 802, "Остаток €980", 19, "#316dcc", 700)]
a += [label(278, 870, "История смен ↓", 18, "#27313d", 700)]
svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900">' + ''.join(a) + '</svg>'
out.write_text(svg, encoding="utf-8")
