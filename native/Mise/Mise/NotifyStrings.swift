import Foundation

// Журнал уведомлений (ревью Г2): iOS-порт lib/notifyStrings.ts. Запись notifications хранит
// EN-фолбэк + title_key/body_key + params — здесь перерендериваем на языке ЗРИТЕЛЯ
// (тот же механизм, что веб-колокольчик NotificationsTab). Порядок языков как в tr():
// en, ru, it, fr, az, tr, uk, kk. Источник правды по текстам — lib/notifyStrings.ts,
// правки вносить синхронно.

// Произвольный JSON (title_params/body_params — jsonb): значения бывают строками,
// числами и вложенными структурами (сегменты Г3).
nonisolated enum JSONVal: Codable, Sendable {
    case str(String), num(Double), bool(Bool), null
    case arr([JSONVal]), obj([String: JSONVal])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .num(n) }
        else if let s = try? c.decode(String.self) { self = .str(s) }
        else if let a = try? c.decode([JSONVal].self) { self = .arr(a) }
        else { self = .obj(try c.decode([String: JSONVal].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .num(let n): try c.encode(n)
        case .str(let s): try c.encode(s)
        case .arr(let a): try c.encode(a)
        case .obj(let o): try c.encode(o)
        }
    }

    var text: String {
        switch self {
        case .str(let s): return s
        case .num(let n): return n == n.rounded() ? String(Int(n)) : String(n)
        case .bool(let b): return b ? "true" : "false"
        default: return ""
        }
    }
}

nonisolated struct AppNotification: Codable, Identifiable, Sendable {
    let id: String
    let type: String?
    let title: String?
    let body: String?
    let title_key: String?
    let body_key: String?
    let title_params: [String: JSONVal]?
    let body_params: [String: JSONVal]?
    let data: [String: JSONVal]?   // произвольные данные для точного роутинга (booking_date и т.п.)
    let created_at: String?
    var read_at: String?
}

// Ключ → [en, ru, it, fr, az, tr, uk, kk].
private let NOTIFY: [String: [String]] = [
    // Тело кассовых пушей несёт дату смены (не дубль заголовка), {date} = dd.MM.
    "notify.cashOpenTitle":  ["Cash opened", "Касса открыта", "Cassa aperta", "Caisse ouverte", "Kassa açıldı", "Kasa açıldı", "Касу відкрито", "Касса ашылды"],
    "notify.cashOpenBody":   ["Shift for {date}", "Смена за {date}", "Turno del {date}", "Service du {date}", "{date} növbəsi", "{date} vardiyası", "Зміна за {date}", "{date} ауысымы"],
    "notify.cashCloseTitle": ["Cash closed", "Касса закрыта", "Cassa chiusa", "Caisse fermée", "Kassa bağlandı", "Kasa kapandı", "Касу закрито", "Касса жабылды"],
    "notify.cashCloseBody":  ["Shift for {date}", "Смена за {date}", "Turno del {date}", "Service du {date}", "{date} növbəsi", "{date} vardiyası", "Зміна за {date}", "{date} ауысымы"],

    "notify.newTaskTitle":   ["New task", "Новая задача", "Nuova attività", "Nouvelle tâche", "Yeni tapşırıq", "Yeni görev", "Нове завдання", "Жаңа тапсырма"],

    "notify.swapRequestTitle":  ["Swap request", "Запрос на обмен", "Richiesta di scambio", "Demande d’échange", "Növbə dəyişmə sorğusu", "Vardiya takas talebi", "Запит на обмін", "Ауысым алмасу сұранысы"],
    "notify.swapRequestBody":   ["{name} is offering a shift swap {date}", "{name} предлагает поменяться сменами {date}", "{name} propone uno scambio di turno {date}", "{name} propose un échange de service {date}", "{name} növbə dəyişməyi təklif edir {date}", "{name} vardiya takası öneriyor {date}", "{name} пропонує обмінятися змінами {date}", "{name} ауысым алмасуды ұсынады {date}"],
    "notify.swapPendingTitle":  ["Swap pending approval", "Обмен на согласование", "Scambio in approvazione", "Échange en attente d’approbation", "Dəyişim təsdiq gözləyir", "Takas onay bekliyor", "Обмін на погодження", "Алмасу мақұлдауды күтуде"],
    "notify.swapPendingBody":   ["Colleague accepted the swap — needs manager approval", "Коллега принял(а) обмен — нужно одобрение менеджера", "Il collega ha accettato lo scambio — serve l’approvazione del manager", "Le collègue a accepté l’échange — approbation du manager requise", "Həmkar dəyişimi qəbul etdi — menecer təsdiqi lazımdır", "Meslektaş takası kabul etti — yönetici onayı gerekiyor", "Колега прийняв(ла) обмін — потрібне схвалення менеджера", "Әріптес алмасуды қабылдады — менеджер мақұлдауы қажет"],
    "notify.swapDeclinedTitle": ["Swap declined", "Обмен отклонён", "Scambio rifiutato", "Échange refusé", "Dəyişim rədd edildi", "Takas reddedildi", "Обмін відхилено", "Алмасу қабылданбады"],
    "notify.swapDeclinedByPeerBody":    ["Colleague declined the swap request", "Коллега отклонил(а) запрос на обмен", "Il collega ha rifiutato la richiesta di scambio", "Le collègue a refusé la demande d’échange", "Həmkar dəyişim sorğusunu rədd etdi", "Meslektaş takas talebini reddetti", "Колега відхилив(ла) запит на обмін", "Әріптес алмасу сұранысын қабылдамады"],
    "notify.swapDeclinedByManagerBody": ["Manager declined the swap", "Менеджер отклонил(а) обмен", "Il manager ha rifiutato lo scambio", "Le manager a refusé l’échange", "Menecer dəyişimi rədd etdi", "Yönetici takası reddetti", "Менеджер відхилив(ла) обмін", "Менеджер алмасуды қабылдамады"],
    "notify.swapApprovedTitle": ["Swap approved", "Обмен одобрен", "Scambio approvato", "Échange approuvé", "Dəyişim təsdiqləndi", "Takas onaylandı", "Обмін схвалено", "Алмасу мақұлданды"],
    "notify.swapApprovedBody":  ["Shift reassigned to colleague", "Смена переназначена коллеге", "Turno riassegnato al collega", "Service réattribué au collègue", "Növbə həmkara yenidən təyin edildi", "Vardiya meslektaşa yeniden atandı", "Зміну перепризначено колезі", "Ауысым әріптеске қайта тағайындалды"],

    "notify.attendanceTitle":    ["Staff on shift", "Сотрудник на смене", "Personale in turno", "Personnel en service", "İşçi növbədə", "Personel vardiyada", "Персонал на зміні", "Қызметкер ауысымда"],
    "notify.attendanceBody":     ["{name} checked in", "{name} пришёл(а)", "{name} è arrivato/a", "{name} est arrivé(e)", "{name} gəldi", "{name} geldi", "{name} прийшов(ла)", "{name} келді"],
    "notify.attendanceBodyLate": ["{name} checked in (+{min} min)", "{name} пришёл(а) (+{min} мин)", "{name} è arrivato/a (+{min} min)", "{name} est arrivé(e) (+{min} min)", "{name} gəldi (+{min} dəq)", "{name} geldi (+{min} dk)", "{name} прийшов(ла) (+{min} хв)", "{name} келді (+{min} мин)"],

    "notify.purchaseTitle":         ["{category} · Purchase", "{category} · Закуп", "{category} · Acquisti", "{category} · Achats", "{category} · Satınalma", "{category} · Satın alma", "{category} · Закупівля", "{category} · Сатып алу"],
    "notify.purchaseDigestTitle":   ["Purchase — daily summary", "Закуп за день", "Acquisti — riepilogo del giorno", "Achats — bilan du jour", "Satınalma — günün xülasəsi", "Satın alma — günlük özet", "Закупівля за день", "Күндік сатып алу қорытындысы"],
    "notify.purchaseDigestBody":    ["{n} items to purchase", "{n} позиц. к закупке", "{n} voci da acquistare", "{n} articles à acheter", "alınacaq {n} mövqe", "satın alınacak {n} kalem", "{n} позиц. до закупівлі", "сатып алынатын {n} позиция"],
    "notify.purchasePositionsBody": ["{who}{n} items", "{who}{n} позиц.", "{who}{n} voci", "{who}{n} articles", "{who}{n} mövqe", "{who}{n} kalem", "{who}{n} позиц.", "{who}{n} позиция"],
    "notify.catKitchen":   ["Kitchen", "Кухня", "Cucina", "Cuisine", "Mətbəx", "Mutfak", "Кухня", "Ас үй"],
    "notify.catBar":       ["Bar", "Бар", "Bar", "Bar", "Bar", "Bar", "Бар", "Бар"],
    "notify.catHookah":    ["Hookah", "Кальян", "Narghilè", "Chicha", "Qəlyan", "Nargile", "Кальян", "Кальян"],
    "notify.catHousehold": ["Household", "Хозтовары", "Casalinghi", "Ménage", "Təsərrüfat", "Ev gereçleri", "Господарські", "Шаруашылық"],
    "notify.catGeneral":   ["General", "Общее", "Generale", "Général", "Ümumi", "Genel", "Загальне", "Жалпы"],

    "notify.shiftReminderTitle":    ["Shift reminder", "Напоминание о смене", "Promemoria turno", "Rappel de service", "Növbə xatırlatması", "Vardiya hatırlatması", "Нагадування про зміну", "Ауысым туралы еске салу"],
    "notify.shiftReminderBody":     ["Your shift is tomorrow", "Ваша смена завтра", "Il tuo turno è domani", "Votre service est demain", "Növbəniz sabahdır", "Vardiyanız yarın", "Ваша зміна завтра", "Ауысымыңыз ертең"],
    "notify.shiftReminderBodyTime": ["Your shift is tomorrow at {time}", "Ваша смена завтра в {time}", "Il tuo turno è domani alle {time}", "Votre service est demain à {time}", "Növbəniz sabah saat {time}", "Vardiyanız yarın saat {time}", "Ваша зміна завтра о {time}", "Ауысымыңыз ертең сағат {time}"],
    "notify.trialEndingTitle": ["Trial ending", "Окончание пробного периода", "La prova sta per finire", "Fin de la période d’essai", "Sınaq müddəti bitir", "Deneme süresi bitiyor", "Закінчення пробного періоду", "Сынақ мерзімі аяқталады"],
    "notify.trialEndingBody":  ["{n} days left", "Осталось {n} дн.", "Mancano {n} giorni", "Plus que {n} jours", "{n} gün qaldı", "{n} gün kaldı", "Залишилось {n} дн.", "{n} күн қалды"],

    "notify.bookingTitle": ["New booking", "Новая бронь", "Nuova prenotazione", "Nouvelle réservation", "Yeni rezervasiya", "Yeni rezervasyon", "Нове бронювання", "Жаңа брондау"],
    "notify.bookingTable": ["Table", "Стол", "Tavolo", "Table", "Masa", "Masa", "Стіл", "Үстел"],
    "notify.lowStockTitle": ["Low stock alert", "Товар заканчивается", "Scorte in esaurimento", "Stock bas", "Stok azalması", "Stok uyarısı", "Запаси закінчуються", "Қор азаю ескертуі"],

    "notify.dRevenue":    ["Revenue", "Выручка", "Ricavi", "Recettes", "Gəlir", "Ciro", "Виручка", "Түсім"],
    "notify.dCard":       ["card", "карта", "carta", "carte", "kart", "kart", "карта", "карта"],
    "notify.dExpense":    ["Expense", "Расход", "Spesa", "Dépense", "Xərc", "Gider", "Витрата", "Шығыс"],
    "notify.dCollection": ["Collection", "Инкасс.", "Versamento", "Encaissement", "İnkassasiya", "Tahsilat", "Інкасація", "Инкассация"],
    "notify.dCash":       ["Cash", "Касса", "Cassa", "Caisse", "Kassa", "Kasa", "Каса", "Касса"],
    "notify.dHookah":     ["Hookah", "Кальяны", "Narghilè", "Chicha", "Qəlyan", "Nargile", "Кальяни", "Кальян"],
    "notify.dBalance":    ["Balance", "Остаток", "Saldo", "Solde", "Qalıq", "Bakiye", "Залишок", "Қалдық"],

    "notify.auditAssignedTitle": ["New audit", "Новый аудит", "Nuovo audit", "Nouvel audit", "Yeni audit", "Yeni denetim", "Новий аудит", "Жаңа аудит"],
    "notify.auditAssignedBody":  ["{name} assigned \"{title}\"", "{name} назначил(а) «{title}»", "{name} ha assegnato \"{title}\"", "{name} a assigné « {title} »", "{name} \"{title}\" təyin etdi", "{name} \"{title}\" atadı", "{name} призначив(ла) «{title}»", "{name} «{title}» тағайындады"],
    "notify.violationTitle":     ["Audit violation", "Нарушение по аудиту", "Violazione audit", "Violation d’audit", "Audit pozuntusu", "Denetim ihlali", "Порушення аудиту", "Аудит бұзушылығы"],
    "notify.violationBody":      ["{item} — needs fixing", "{item} — нужно исправить", "{item} — da correggere", "{item} — à corriger", "{item} — düzəldilməlidir", "{item} — düzeltilmeli", "{item} — потрібно виправити", "{item} — түзету қажет"],
    "notify.closeChecklistReminderTitle": ["Closing checklist not done", "Чек-лист закрытия не пройден", "Checklist di chiusura non completata", "Checklist de clôture non terminée", "Bağlanış çek-listi tamamlanmayıb", "Kapanış kontrol listesi tamamlanmadı", "Чек-лист закриття не пройдено", "Жабылу тексеру тізімі толтырылмаған"],
    "notify.closeChecklistReminderBody":  ["Check off the remaining items before closing", "Отметьте оставшиеся пункты до закрытия", "Spunta i punti rimanenti prima della chiusura", "Cochez les éléments restants avant la clôture", "Bağlanmazdan əvvəl qalan bəndləri qeyd edin", "Kapanıştan önce kalan maddeleri işaretleyin", "Відмітьте решту пунктів до закриття", "Жабу алдында қалған тармақтарды белгілеңіз"],

    "notify.salaryPayoutSoonTitle": ["Salary payout soon", "Скоро выплата ЗП", "Pagamento stipendi a breve", "Versement du salaire bientôt", "Maaş ödənişi tezliklə", "Maaş ödemesi yaklaşıyor", "Скоро виплата ЗП", "Жалақы төлемі жақында"],
    "notify.salaryPayoutSoonBody":  ["{days} days left — due {due}, reserve {reserve}", "Через {days} дн. выплата — к оплате {due}, в резерве {reserve}", "Mancano {days} giorni — da pagare {due}, riserva {reserve}", "Dans {days} jours — à verser {due}, réserve {reserve}", "{days} gün qalıb — ödəniləcək {due}, ehtiyatda {reserve}", "{days} gün kaldı — ödenecek {due}, rezervde {reserve}", "Через {days} дн. виплата — до оплати {due}, у резерві {reserve}", "{days} күн қалды — төленеді {due}, резервте {reserve}"],
]

private let NOTIFY_LANG_ORDER = ["en", "ru", "it", "fr", "az", "tr", "uk", "kk"]

@MainActor func renderNotify(_ key: String, _ vars: [String: String]? = nil) -> String {
    let idx = NOTIFY_LANG_ORDER.firstIndex(of: I18n.code) ?? 0
    guard let row = NOTIFY[key] else { return key }
    var s = idx < row.count ? row[idx] : row[0]
    if let vars { for (k, v) in vars { s = s.replacingOccurrences(of: "{\(k)}", with: v) } }
    // Защита от незаполненной переменной (напр. звонок без vars) — не показывать сырые {var}.
    s = s.replacingOccurrences(of: "\\{[a-zA-Z_]+\\}", with: "", options: .regularExpression)
    return s.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
}

private let NOTIFY_CAT_KEYS: [String: String] = [
    "kitchen": "notify.catKitchen", "bar": "notify.catBar", "hookah": "notify.catHookah",
    "household": "notify.catHousehold", "general": "notify.catGeneral",
]

/// Категория закупа: известные цеха переводятся, произвольные (пользовательские) — как есть.
@MainActor func renderNotifyCategory(_ raw: String) -> String {
    guard let key = NOTIFY_CAT_KEYS[raw] else { return raw }
    return renderNotify(key)
}

/// Заголовок записи журнала на языке зрителя (EN-фолбэк, если ключа нет).
@MainActor func notifTitle(_ n: AppNotification) -> String {
    guard let key = n.title_key else { return n.title ?? "" }
    var vars: [String: String] = [:]
    for (k, v) in n.title_params ?? [:] { vars[k] = v.text }
    if key == "notify.purchaseTitle", let cat = vars["category"] { vars["category"] = renderNotifyCategory(cat) }
    return renderNotify(key, vars)
}

/// Тело записи. body_key='_segments' — составное тело (в т.ч. секьюрный дайджест кассы,
/// ревью Г3): лейблы переводятся, значения — уже отформатированные строки.
@MainActor func notifBody(_ n: AppNotification) -> String? {
    if n.body_key == "_segments", case .arr(let segs)? = n.body_params?["segments"] {
        var out = ""
        for (i, seg) in segs.enumerated() {
            guard case .obj(let o) = seg else { continue }
            let value = o["value"]?.text ?? ""
            var text = value
            if case .str(let key)? = o["key"] { text = "\(renderNotify(key)) \(value)" }
            if i == 0 { out = text }
            else {
                let sep: String = { if case .str(let s)? = o["sep"] { return s }; return " · " }()
                out += sep + text
            }
        }
        return out
    }
    guard let key = n.body_key else { return (n.body?.isEmpty == false) ? n.body : nil }
    var vars: [String: String] = [:]
    for (k, v) in n.body_params ?? [:] { vars[k] = v.text }
    return renderNotify(key, vars)
}
