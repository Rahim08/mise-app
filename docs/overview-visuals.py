from pathlib import Path
from html import escape

OUT = Path(__file__).parent / "design-overview"
OUT.mkdir(exist_ok=True)

def rect(x, y, w, h, fill, rx=0, stroke=None, sw=1):
    edge = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ''
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}"{edge}/>'

def text(x, y, value, size=16, color="#20242d", weight=400, anchor="start"):
    return f'<text x="{x}" y="{y}" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="{size}" font-weight="{weight}" fill="{color}" text-anchor="{anchor}">{escape(value)}</text>'

def line(x1, y1, x2, y2, color="#e7e9ed"):
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}"/>'

def pill(x, y, w, label, fill="#edf4ff", color="#3168bb"):
    return rect(x,y,w,28,fill,14)+text(x+w/2,y+19,label,12,color,600,"middle")

def base(title, subtitle, sidebar_items, active="Обзор", collapsible=False):
    a=[rect(0,0,1440,900,"#f5f6f8"),rect(0,0,240,900,"#f8f9fb"),line(240,0,240,900),
       text(30,45,"mise",27,"#232830",800),text(30,101,"РАБОЧЕЕ ПРОСТРАНСТВО",11,"#89919d",700)]
    y=132
    for label, group in sidebar_items:
        if group:
            y+=15; a.append(text(30,y,label.upper(),10,"#9da4af",700))
            if collapsible: a.append(text(210,y,"⌄" if label=="Сегодня" else "›",16,"#9da4af",600,"end"))
            y+=36
        else:
            if label==active: a.append(rect(16,y-20,208,38,"#e9effb",10))
            a.append(text(40,y+5,label,15,"#27579e" if label==active else "#606975",650 if label==active else 500)); y+=43
    a += [line(16,834,224,834),rect(28,850,32,32,"#e8ecf1",9),text(44,872,"M",15,"#5a6574",700,"middle"),text(71,865,"Ресторан",13,"#313944",650),text(71,880,"Аккаунт",11,"#929ba6")]
    a += [text(278,52,title,28,"#20242d",750),text(278,78,subtitle,14,"#7f8792")]
    return a

def card(a,x,y,w,h): a.append(rect(x,y,w,h,"#fff",16,"#e5e8ed"))

current_items=[("Модули",True),("Обзор",False),("Смены",False),("Analytics",False),("Stash",False),("People",False),("Menu",False),("Брони",False),("Новости",False),("Сервис",True),("Команда",False),("Уведомления",False),("Настройки",False),("Оплата",False)]
a=base("Обзор","Сегодня, 26 сентября · пример данных",current_items)
a += [pill(1127,26,268,"РЕКОНСТРУКЦИЯ ПО КОДУ","#fff1db","#956115")]
stats=[("НАЛИЧНЫЕ","€1 240","#2e78dc"),("БЕЗНАЛ","€2 860","#38a76d"),("КАЛЬЯНЫ","18 · €450","#d18819"),("ЗАКАЗЫ МЕНЮ","12","#d95186")]
for i,(label,value,col) in enumerate(stats):
    x=278+i*277; card(a,x,114,263,148)
    a += [text(x+18,143,label,11,"#7f8792",700),text(x+18,183,value,27,col,700),line(x+18,229,x+45,213,"#c7d4e7"),line(x+45,213,x+74,223,"#c7d4e7"),line(x+74,223,x+102,204,"#c7d4e7"),line(x+102,204,x+132,215,"#c7d4e7"),line(x+132,215,x+162,198,"#c7d4e7"),line(x+162,198,x+190,207,"#c7d4e7"),line(x+190,207,x+234,188,"#c7d4e7")]
card(a,278,280,1102,63); a += [rect(298,306,8,8,"#35a46b",4),text(319,316,"Смена открыта · касса €980",15,"#59636f",500)]
card(a,278,355,1102,76); a += [rect(278,355,4,76,"#5484d9",2),text(300,383,"3 новых заказа",16,"#252b34",650),text(300,406,"Ожидают подтверждения",13,"#89919c"),text(1350,398,"›",28,"#9aa3ad")]
card(a,278,443,1102,174); a += [text(300,475,"Аудиты · последние 30 дней",17,"#252b34",650),text(1355,475,"82%",22,"#38a76d",750,"end"),line(300,495,1357,495),text(300,527,"Чистота зала",14,"#68727e"),text(1350,527,"4",14,"#db6565",700,"end"),text(300,558,"Сервировка столов",14,"#68727e"),text(1350,558,"2",14,"#db6565",700,"end"),text(300,589,"Складская зона",14,"#68727e"),text(1350,589,"1",14,"#db6565",700,"end")]
a += [text(278,665,"Условные числа. Порядок и состав блоков повторяют текущую реализацию.",13,"#9aa2ad")]

def save(name, elements):
    svg='<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900">'+''.join(elements)+'</svg>'
    (OUT/name).write_text(svg,encoding='utf-8')

save('overview-current-reconstruction.svg',a)

proposed_items=[("Сегодня",True),("Обзор",False),("Смены",False),("Брони",False),("Уведомления",False),("Анализ",True),("Управление",True),("Настройки",True)]
b=base("Сегодня в ресторане","Суббота, 26 сентября · все суммы за текущую смену",proposed_items,collapsible=True)
b += [pill(1151,26,229,"КОНЦЕПТ · ДАННЫЕ ПРИМЕР", "#e8f0ff","#3f68a5")]
b += [text(278,123,"Ситуация сейчас",18,"#2a323d",700),pill(1215,101,165,"Обновлено 12:42","#edf4ef","#347251")]
card(b,278,148,710,214); b += [text(302,180,"ВЫРУЧКА СЕГОДНЯ",12,"#75818f",700),text(302,242,"€4 100",52,"#202833",780),text(302,275,"Наличные €1 240  ·  Безнал €2 860",16,"#637080"),line(302,295,964,295),text(302,326,"14 дней: динамика выручки",13,"#8290a0"),line(563,333,620,319,"#81a8d9"),line(620,319,675,327,"#81a8d9"),line(675,327,730,309,"#81a8d9"),line(730,309,785,317,"#81a8d9"),line(785,317,842,296,"#81a8d9"),line(842,296,900,305,"#81a8d9"),line(900,305,955,286,"#81a8d9")]
card(b,1004,148,376,214); b += [text(1028,180,"СМЕНА",12,"#75818f",700),pill(1272,157,82,"Открыта","#e9f6ee","#2f8b57"),text(1028,229,"€980",39,"#263441",740),text(1028,258,"Остаток в кассе",14,"#72808e"),line(1028,284,1356,284),text(1028,320,"Перейти к смене",15,"#316dcc",650),text(1345,321,"›",25,"#316dcc")]
b += [text(278,410,"Операции",18,"#2a323d",700)]
for x,title,value,sub,cta in [(278,"Заказы","3 новых","12 всего сегодня","Открыть заказы"),(650,"Брони","5 сегодня","2 ожидают прихода","Открыть брони"),(1022,"Кальяны","18","Выручка €450","Открыть Stash")]:
    card(b,x,433,358,153); b += [text(x+20,464,title.upper(),12,"#75818f",700),text(x+20,504,value,27,"#26313c",720),text(x+20,530,sub,13,"#7a8794"),text(x+20,562,cta,13,"#316dcc",650),text(x+329,563,"›",23,"#316dcc")]
b += [text(278,631,"Требует внимания",18,"#2a323d",700)]
card(b,278,652,710,156); b += [rect(278,652,4,156,"#e0a23b",2),text(301,686,"3 заказа ждут подтверждения",16,"#28313b",680),text(301,709,"Самый ранний поступил в 12:31",13,"#7e8995"),pill(791,668,172,"Обработать заказы","#e8f0ff","#2d66ba"),line(301,727,963,727),text(301,758,"Низкий остаток: табак для кальянов",15,"#28313b",610),text(301,780,"Проверить склад",13,"#316dcc",650)]
card(b,1004,652,376,156); b += [text(1027,685,"Аудиты · 30 дней",16,"#28313b",650),text(1355,685,"82%",25,"#3aa46a",760,"end"),text(1027,716,"7 нарушений в 3 категориях",13,"#7e8995"),line(1027,738,1356,738),text(1027,775,"Посмотреть проверки",14,"#316dcc",650),text(1345,775,"›",23,"#316dcc")]
b += [text(278,850,"Концепт расположения. Показатели и события зависят от подключённых модулей и реальных данных.",13,"#98a2ad")]
save('overview-proposed.svg',b)
