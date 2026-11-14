"""Static layout preview for the web Notifications tab; counts are sample data."""
from pathlib import Path
from html import escape

out = Path(__file__).parent / "design-overview" / "notifications-proposed.svg"

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
a += [text(30, 147, "СЕГОДНЯ  ⌄", 11, "#84909e", 700), text(40, 189, "Обзор", 15, "#66727f"), text(40, 232, "Смены", 15, "#66727f"), text(40, 275, "Брони", 15, "#66727f"), rect(16, 294, 208, 39, "#e9effb", 10), text(40, 320, "Уведомления", 15, "#2c62ac", 700)]
a += [text(30, 386, "АНАЛИЗ  ›", 11, "#84909e", 700), text(30, 432, "УПРАВЛЕНИЕ  ›", 11, "#84909e", 700), text(30, 478, "НАСТРОЙКИ  ›", 11, "#84909e", 700)]
a += [text(278, 52, "Уведомления", 29, "#20242d", 750), text(278, 79, "Что требует внимания и последние события заведения", 14, "#7f8792"), rect(1147, 26, 232, 30, "#e8f0ff", 15), text(1165, 46, "КОНЦЕПТ · ПРИМЕР ДАННЫХ", 11, "#3f68a5", 700)]
a += [text(278, 133, "Требует внимания", 20, "#26313c", 700), rect(475, 109, 28, 28, "#fff1dc", 14), text(484, 129, "6", 13, "#a46a19", 700)]
for x, w, title, value, sub, action, color in [
    (278, 358, "НОВЫЕ ЗАКАЗЫ И ВЫЗОВЫ", "3", "Ожидают обработки", "Открыть заказы →", "#e4a94b"),
    (650, 358, "ТАБАК ЗАКАНЧИВАЕТСЯ", "2", "Мята · осталось 70 г", "Проверить склад →", "#e4a94b"),
    (1022, 358, "ПЛАТЁЖ ПО ПОДПИСКЕ", "!", "Проверьте способ оплаты", "Открыть подписку →", "#d96767"),
]:
    a += [card(x, 157, w, 180), rect(x, 157, 4, 180, color, 2), text(x+21, 190, title, 11, "#788592", 700), text(x+21, 253, value, 45, "#27313d", 750), text(x+21, 280, sub, 13, "#788592"), text(x+21, 314, action, 13, "#316dcc", 700)]
a += [text(278, 390, "Последние события", 20, "#26313c", 700), text(278, 430, "ЗАКАЗЫ И ВЫЗОВЫ", 11, "#83909e", 700)]
for y, title, sub, status, fill, color in [
    (447, "Заказ · 4 поз. · стол 7", "12 минут назад", "Новый", "#fff3e0", "#a66a17"),
    (533, "Вызов официанта · стол 4", "26 минут назад", "Новый", "#fff3e0", "#a66a17"),
    (619, "Заказ · 2 поз. · стол 2", "Сегодня, 12:10", "Готов", "#e9f6ee", "#348b57"),
]:
    a += [card(278, y, 1102, 74), rect(295, y+17, 39, 39, "#edf3fb", 11), text(351, y+30, title, 15, "#27313d", 650), text(351, y+51, sub, 12, "#8792a0"), rect(1252, y+23, 99, 28, fill, 14), text(1273, y+42, status, 12, color, 700)]
a += [text(278, 743, "ЖУРНАЛ СОБЫТИЙ", 11, "#83909e", 700), card(278, 761, 1102, 77), rect(295, 779, 39, 39, "#f1f3f6", 11), text(351, 790, "Смена закрыта", 15, "#27313d", 650), text(351, 814, "Касса сохранена · менеджер Марко", 12, "#8792a0"), text(1244, 797, "Вчера", 12, "#8792a0")]
svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900">' + ''.join(a) + '</svg>'
out.write_text(svg, encoding="utf-8")
