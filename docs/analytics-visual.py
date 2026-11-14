"""Static layout preview for the web Analytics tab; amounts are sample data."""
from pathlib import Path
from html import escape

out = Path(__file__).parent / "design-overview" / "analytics-proposed.svg"

def rect(x, y, w, h, fill, r=0, stroke=None):
    edge = f' stroke="{stroke}"' if stroke else ""
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"{edge}/>'

def text(x, y, value, size=14, color="#27313d", weight=400):
    return f'<text x="{x}" y="{y}" font-family="Arial,sans-serif" font-size="{size}" font-weight="{weight}" fill="{color}">{escape(value)}</text>'

def line(x1, y1, x2, y2, color="#e6e9ee"):
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}"/>'

def card(x, y, w, h):
    return rect(x, y, w, h, "#ffffff", 16, "#e5e8ed")

a = [rect(0, 0, 1440, 900, "#f5f6f8"), rect(0, 0, 240, 900, "#f8f9fb"), line(240, 0, 240, 900)]
a += [text(30, 48, "mise", 28, "#232830", 800), text(30, 105, "РАБОЧЕЕ ПРОСТРАНСТВО", 10, "#8b95a1", 700)]
a += [text(30, 147, "СЕГОДНЯ  ›", 11, "#84909e", 700), text(30, 193, "АНАЛИЗ  ⌄", 11, "#84909e", 700), rect(16, 211, 208, 39, "#e9effb", 10), text(40, 237, "Analytics", 15, "#2c62ac", 700), text(30, 297, "УПРАВЛЕНИЕ  ›", 11, "#84909e", 700), text(30, 343, "НАСТРОЙКИ  ›", 11, "#84909e", 700)]
a += [text(278, 52, "Аналитика", 29, "#20242d", 750), text(278, 79, "Доходы, расходы и движение денег", 14, "#7f8792"), rect(1147, 26, 232, 30, "#e8f0ff", 15), text(1165, 46, "КОНЦЕПТ · ПРИМЕР ДАННЫХ", 11, "#3f68a5", 700)]
a += [rect(1198, 67, 126, 34, "#e9f6ee", 17), text(1217, 89, "Сен 2026 ⌄", 13, "#348b57", 700), rect(1339, 67, 39, 34, "#e9f6ee", 17), text(1352, 90, "AI", 12, "#348b57", 700)]
a += [line(278, 159, 1380, 159), text(296, 143, "Период", 14, "#328d55", 700), text(419, 143, "Касса", 14, "#75818e", 600), text(527, 143, "Банк", 14, "#75818e", 600), text(633, 143, "Зарплаты", 14, "#75818e", 600), text(785, 143, "Кальян", 14, "#75818e", 600), rect(278, 157, 99, 2, "#32a560")]
a += [rect(278, 183, 302, 39, "#e9edf2", 12), rect(478, 186, 99, 33, "#ffffff", 10), text(309, 208, "День", 13, "#75818e"), text(412, 208, "Неделя", 13, "#75818e"), text(500, 208, "Месяц", 13, "#328d55", 700)]
for x, w, title, val, change, col in [(278, 544, "ДОХОД", "€30 800", "Наличные · ↑ 8,4% к прошлому месяцу", "#34a564"), (836, 544, "РАСХОДЫ", "€17 250", "↓ 2,1% к прошлому месяцу", "#d76962")]:
    a += [card(x, 242, w, 144), text(x+20, 275, title, 11, "#84909e", 700), text(x+20, 332, val, 38, col, 750), text(x+20, 361, change, 12, "#798592")]
for x, w, title, val, col in [(278, 358, "СМЕН", "23", "#27313d"), (650, 358, "ИНКАССАЦИЯ", "€4 700", "#d48f34"), (1022, 358, "КАССА", "€2 180", "#3979c4")]:
    a += [card(x, 402, w, 104), text(x+18, 432, title, 10, "#83909e", 700), text(x+18, 482, val, 29, col, 740)]
a += [card(278, 526, 650, 100), text(298, 554, "Наличные · Карта", 15, "#27313d", 700), text(817, 554, "€48 900 всего", 12, "#8995a1"), rect(298, 575, 383, 10, "#38ad66", 5), rect(684, 575, 221, 10, "#9571d0", 5), text(298, 609, "Наличные  €30 800  ·  63%", 12, "#667483"), text(681, 609, "Карта  €18 100  ·  37%", 12, "#667483")]
a += [text(278, 662, "ДОХОДЫ И РАСХОДЫ", 11, "#83909e", 700), card(278, 677, 650, 184)]
bars = [(74, 36), (88, 50), (98, 47), (112, 62), (81, 38), (122, 66), (137, 71), (125, 55), (144, 77), (160, 80)]
for i, (inc, exp) in enumerate(bars):
    x = 311+i*59
    a += [rect(x, 837-inc, 17, inc, "#42b876", 4), rect(x+20, 837-exp, 17, exp, "#e07972", 4)]
a += [line(298, 837, 906, 837)]
a += [text(948, 548, "СТРУКТУРА РАСХОДОВ", 11, "#83909e", 700), card(948, 563, 432, 185)]
a += [f'<circle cx="1039" cy="655" r="53" fill="none" stroke="#e4e9ee" stroke-width="20"/>', f'<path d="M 1039 602 A 53 53 0 1 1 989 673" fill="none" stroke="#34ad6c" stroke-width="20"/>', f'<path d="M 989 673 A 53 53 0 0 1 1007 614" fill="none" stroke="#dba34f" stroke-width="20"/>', text(1011, 660, "€17k", 15, "#27313d", 750)]
for y, color, key, val in [(602, "#34ad6c", "Закупки", "€8 600"), (634, "#dba34f", "Зарплата", "€4 100"), (666, "#8c70cb", "Аренда", "€2 900"), (698, "#df7973", "Прочее", "€1 650")]:
    a += [rect(1113, y-9, 8, 8, color, 4), text(1130, y, key, 12, "#697685"), text(1284, y, val, 12, "#27313d", 650)]
a += [text(948, 785, "ТОП РАСХОДОВ", 11, "#83909e", 700), card(948, 800, 432, 61), text(971, 838, "Закупки", 13, "#27313d"), text(1291, 838, "€8 600", 13, "#27313d", 700)]
svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900">' + ''.join(a) + '</svg>'
out.write_text(svg, encoding="utf-8")
