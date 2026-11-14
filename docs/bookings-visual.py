"""Static layout preview for the web Bookings tab; names and counts are sample data."""
from pathlib import Path
from html import escape

out = Path(__file__).parent / "design-overview" / "bookings-proposed.svg"

def rect(x, y, w, h, fill, r=0, stroke=None):
    edge = f' stroke="{stroke}"' if stroke else ""
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"{edge}/>'

def text(x, y, value, size=14, color="#27313d", weight=400):
    return f'<text x="{x}" y="{y}" font-family="Arial,sans-serif" font-size="{size}" font-weight="{weight}" fill="{color}">{escape(value)}</text>'

def line(x1, y1, x2, y2):
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="#e6e9ee"/>'

def card(x, y, w, h):
    return rect(x, y, w, h, "#ffffff", 16, "#e5e8ed")

a = [rect(0, 0, 1440, 900, "#f5f6f8"), rect(0, 0, 240, 900, "#f8f9fb"), line(240, 0, 240, 900)]
a += [text(30, 48, "mise", 28, "#232830", 800), text(30, 105, "РАБОЧЕЕ ПРОСТРАНСТВО", 10, "#8b95a1", 700)]
a += [text(30, 147, "СЕГОДНЯ  ⌄", 11, "#84909e", 700), text(40, 189, "Обзор", 15, "#66727f"), text(40, 232, "Смены", 15, "#66727f"), rect(16, 251, 208, 39, "#e9effb", 10), text(40, 277, "Брони", 15, "#2c62ac", 700), text(40, 326, "Уведомления", 15, "#66727f")]
a += [text(30, 386, "АНАЛИЗ  ›", 11, "#84909e", 700), text(30, 432, "УПРАВЛЕНИЕ  ›", 11, "#84909e", 700), text(30, 478, "НАСТРОЙКИ  ›", 11, "#84909e", 700)]
a += [text(278, 52, "Брони", 29, "#20242d", 750), text(278, 79, "Бронирование столов", 14, "#7f8792"), rect(1147, 26, 232, 30, "#e8f0ff", 15), text(1165, 46, "КОНЦЕПТ · ПРИМЕР ДАННЫХ", 11, "#3f68a5", 700)]
a += [rect(1100, 69, 280, 28, "#e9edf3", 14), rect(1103, 72, 83, 22, "#ffffff", 11), text(1118, 87, "Брони", 11, "#316dcc", 700), text(1200, 87, "Гости", 11, "#687686"), text(1290, 87, "Отзывы", 11, "#687686")]
a += [text(278, 129, "Суббота, 26 сентября", 20, "#26313c", 700), text(278, 153, "Брони · 8", 13, "#7a8794"), rect(1205, 105, 175, 42, "#316dcc", 21), text(1226, 132, "+ Новая бронь", 14, "#ffffff", 700)]
for x, name, count in [(278, "ВСЕ БРОНИ", "8"), (650, "ОЖИДАЮТ", "5"), (1022, "ПРИШЛИ", "2")]:
    a += [card(x, 179, 358, 126), text(x+20, 211, name, 11, "#7a8694", 700), text(x+20, 269, count, 43, "#27313d", 750)]
a += [card(278, 321, 286, 357), text(301, 353, "‹", 23, "#5c79a6"), text(335, 351, "Сентябрь 2026", 15, "#27313d", 700), text(528, 353, "›", 23, "#5c79a6")]
for i, day in enumerate(["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"]):
    a.append(text(298+i*37, 394, day, 10, "#8d98a5", 700))
for row in range(5):
    for col in range(7):
        n = row*7+col - 1
        if n < 1 or n > 30: continue
        x, y = 296+col*37, 419+row*46
        if n == 26: a.append(rect(x-5, y-17, 31, 31, "#316dcc", 8))
        a.append(text(x+4, y+3, str(n), 13, "#ffffff" if n == 26 else "#27313d", 700 if n == 26 else 400))
        if n in {3, 11, 18, 26, 29}: a.append(rect(x+9, y+8, 4, 4, "#ffffff" if n == 26 else "#316dcc", 2))
a += [rect(298, 628, 245, 34, "#f1f3f6", 17), text(404, 650, "Сегодня", 12, "#415976", 700)]
a += [card(580, 321, 445, 510), text(602, 355, "Брони за день", 17, "#27313d", 700), text(982, 355, "8", 13, "#7a8794")]
for x, w, label_, selected in [(602, 73, "Все  8", True), (683, 108, "Ожидание  5", False), (799, 84, "Пришли  2", False), (891, 113, "Отменены  1", False)]:
    a += [rect(x, 374, w, 28, "#e8f0ff" if selected else "#f7f8fa", 14), text(x+11, 393, label_, 11, "#316dcc" if selected else "#75818d", 650)]
rows = [("18:30", "Анна Петрова", "Гостей: 2 · Стол 4", "Ожидание", "#e8f0ff", "#316dcc"), ("19:00", "Марко Росси", "Гостей: 4 · Стол 8", "Пришли", "#f0ebfa", "#7752aa"), ("19:30", "Ольга Смирнова", "Гостей: 3 · Стол 2", "Ожидание", "#e8f0ff", "#316dcc"), ("20:00", "Давид", "Гостей: 2 · Стол 6", "Ожидание", "#e8f0ff", "#316dcc")]
for i, (time, name, detail, status, fill, color) in enumerate(rows):
    y = 426+i*96
    a += [line(602, y-11, 1003, y-11), text(602, y+18, time, 16, "#27313d", 700), text(668, y+11, name, 14, "#27313d", 650), text(668, y+32, detail, 11, "#7a8794"), rect(914, y-5, 88, 26, fill, 13), text(926, y+13, status, 11, color, 650)]
a += [card(1041, 321, 339, 510), text(1062, 356, "Анна Петрова", 17, "#27313d", 700), text(1062, 380, "Редактирование брони", 12, "#7a8794")]
for y, key, val in [(427, "Имя гостя", "Анна Петрова"), (485, "Телефон", "+39 333 123 45 67"), (543, "Время", "18:30"), (601, "Гостей", "2"), (659, "Стол", "4"), (717, "Статус", "Ожидание")]:
    a += [text(1062, y-18, key.upper(), 10, "#8c97a3", 700), rect(1062, y-6, 297, 37, "#f7f8fa", 8, "#e8eaee"), text(1074, y+18, val, 13, "#364352")]
a += [rect(1062, 774, 126, 39, "#316dcc", 20), text(1084, 799, "Сохранить", 13, "#ffffff", 700), text(1206, 799, "Отмена", 13, "#627080")]
svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900">' + ''.join(a) + '</svg>'
out.write_text(svg, encoding="utf-8")
