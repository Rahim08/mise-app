import SwiftUI

// Локализация нативного приложения. Подход — как в вебе (lib/i18n.tsx): один словарь
// STRINGS (ключ → переводы по локалям), фолбэк на английский. Язык по умолчанию берётся
// из системы iPhone, но переопределяется выбором в Настройках (живое переключение без
// перезапуска — @Observable, view перерисовываются при смене языка).

enum Lang: String, CaseIterable, Sendable {
    case en, ru, it, fr, az, tr, uk, kk
    /// Порядок выбора: English первым (дефолт), далее по алфавиту родного названия.
    static let ordered: [Lang] = [.en, .az, .fr, .it, .tr, .ru, .uk, .kk]
    var native: String {
        switch self {
        case .en: return "English"
        case .ru: return "Русский"
        case .it: return "Italiano"
        case .fr: return "Français"
        case .az: return "Azərbaycan"
        case .tr: return "Türkçe"
        case .uk: return "Українська"
        case .kk: return "Қазақша"
        }
    }
}

enum AppTheme: String, CaseIterable {
    case system, dark, light
}

@MainActor
@Observable
final class L10n {
    static let shared = L10n()
    private let key = "mise_lang"
    private let themeKey = "mise_theme"

    var lang: Lang {
        didSet { UserDefaults.standard.set(lang.rawValue, forKey: key); I18n.code = lang.rawValue }
    }

    var theme: AppTheme {
        didSet { UserDefaults.standard.set(theme.rawValue, forKey: themeKey) }
    }

    /// SwiftUI colorScheme override (nil = system).
    var colorScheme: ColorScheme? {
        switch theme {
        case .dark:   return .dark
        case .light:  return .light
        case .system: return nil
        }
    }

    private init() {
        // lang
        let savedLang = UserDefaults.standard.string(forKey: "mise_lang").flatMap { Lang(rawValue: $0) }
        let sysLang = Lang(rawValue: String(Locale.preferredLanguages.first?.prefix(2).lowercased() ?? "en")) ?? .en
        var resolvedLang = savedLang ?? sysLang

        // theme
        let savedTheme = UserDefaults.standard.string(forKey: "mise_theme").flatMap { AppTheme(rawValue: $0) }
        var resolvedTheme = savedTheme ?? .dark

        // DEBUG env overrides для скриншотов в симуляторе
        #if DEBUG
        if let envLang = ProcessInfo.processInfo.environment["MISE_DEMO_LANG"],
           let l = Lang(rawValue: envLang) { resolvedLang = l }
        if let envTheme = ProcessInfo.processInfo.environment["MISE_DEMO_THEME"],
           let th = AppTheme(rawValue: envTheme) { resolvedTheme = th }
        #endif

        lang = resolvedLang
        theme = resolvedTheme
        I18n.code = resolvedLang.rawValue
    }

    func setLang(_ l: Lang) { lang = l }

    func t(_ k: String, _ vars: [String: String] = [:]) -> String {
        let row = STRINGS[k]
        var s = row?[lang] ?? row?[.en] ?? k
        for (key, val) in vars { s = s.replacingOccurrences(of: "{\(key)}", with: val) }
        return s
    }
}

/// Перевод по ключу. Вызов внутри body отслеживается Observation → перерисовка при смене языка.
@MainActor func t(_ k: String, _ vars: [String: String] = [:]) -> String { L10n.shared.t(k, vars) }

/// Зеркало кода языка для nonisolated-доступа (форматтеры дат вне MainActor).
enum I18n { nonisolated(unsafe) static var code = "en" }
/// Локаль для форматтеров дат — следует выбранному языку.
func appLocale() -> Locale { Locale(identifier: I18n.code) }

// MARK: - Словарь

private func tr(_ en: String, _ ru: String, _ it: String, _ fr: String,
                _ az: String, _ tr: String, _ uk: String, _ kk: String) -> [Lang: String] {
    [.en: en, .ru: ru, .it: it, .fr: fr, .az: az, .tr: tr, .uk: uk, .kk: kk]
}

let STRINGS: [String: [Lang: String]] = [
    // Общее
    "save":   tr("Save", "Сохранить", "Salva", "Enregistrer", "Saxla", "Kaydet", "Зберегти", "Сақтау"),
    "cancel": tr("Cancel", "Отмена", "Annulla", "Annuler", "Ləğv et", "İptal", "Скасувати", "Бас тарту"),
    "done":   tr("Done", "Готово", "Fatto", "Terminé", "Hazır", "Bitti", "Готово", "Дайын"),
    "edit":   tr("Edit", "Редактировать", "Modifica", "Modifier", "Düzəliş et", "Düzenle", "Редагувати", "Өңдеу"),
    "delete": tr("Delete", "Удалить", "Elimina", "Supprimer", "Sil", "Sil", "Видалити", "Жою"),
    "pe.reopen": tr("Reopen", "Вернуть", "Riapri", "Rouvrir", "Qaytar", "Geri al", "Повернути", "Қайтару"),
    "pe.deleteTask": tr("Delete task?", "Удалить задачу?", "Eliminare l’attività?", "Supprimer la tâche ?", "Tapşırıq silinsin?", "Görev silinsin mi?", "Видалити завдання?", "Тапсырманы жою?"),
    "pe.deletePurchase": tr("Delete item?", "Удалить позицию?", "Eliminare l’articolo?", "Supprimer l’article ?", "Element silinsin?", "Öğe silinsin mi?", "Видалити позицію?", "Элементті жою?"),
    "add":    tr("Add", "Добавить", "Aggiungi", "Ajouter", "Əlavə et", "Ekle", "Додати", "Қосу"),
    "send":   tr("Send", "Отправить", "Invia", "Envoyer", "Göndər", "Gönder", "Надіслати", "Жіберу"),
    "create": tr("Create", "Создать", "Crea", "Créer", "Yarat", "Oluştur", "Створити", "Жасау"),
    "history": tr("History", "История", "Cronologia", "Historique", "Tarixçə", "Geçmiş", "Історія", "Тарих"),

    // Настройки
    "settings":        tr("Settings", "Настройки", "Impostazioni", "Réglages", "Tənzimləmələr", "Ayarlar", "Налаштування", "Параметрлер"),
    "settings.lang":   tr("Language", "Язык", "Lingua", "Langue", "Dil", "Dil", "Мова", "Тіл"),
    "settings.theme":  tr("Theme", "Тема", "Tema", "Thème", "Tema", "Tema", "Тема", "Тема"),
    "theme.system":    tr("System", "Системная", "Sistema", "Système", "Sistem", "Sistem", "Системна", "Жүйелік"),
    "theme.dark":      tr("Dark", "Тёмная", "Scuro", "Sombre", "Tünd", "Koyu", "Темна", "Қараңғы"),
    "theme.light":     tr("Light", "Светлая", "Chiaro", "Clair", "İşıqlı", "Açık", "Світла", "Жарық"),
    "logout":          tr("Log out", "Выйти", "Esci", "Déconnexion", "Çıxış", "Çıkış yap", "Вийти", "Шығу"),
    "logout.confirm":  tr("Log out of venue?", "Выйти из заведения?", "Uscire dal locale?", "Quitter l’établissement ?", "Məkandan çıxılsın?", "Mekandan çıkılsın mı?", "Вийти із закладу?", "Орыннан шығу керек пе?"),
    "logout.msg":      tr("You’ll need to scan the QR and enter the PIN again.", "Понадобится снова отсканировать QR и ввести PIN.", "Dovrai scansionare di nuovo il QR e inserire il PIN.", "Vous devrez scanner le QR et saisir le PIN à nouveau.", "QR-u yenidən skan edib PIN daxil etməli olacaqsınız.", "QR'ı tekrar tarayıp PIN girmeniz gerekecek.", "Потрібно буде знову відсканувати QR і ввести PIN.", "QR-ды қайта сканерлеп, PIN енгізу қажет болады."),

    // Роли
    "role.owner": tr("Owner", "Владелец", "Proprietario", "Propriétaire", "Sahib", "Sahip", "Власник", "Иесі"),

    // Подзаголовки модулей
    "mod.manager.sub":   tr("Shifts & cash", "Смены и касса", "Turni e cassa", "Services et caisse", "Növbələr və kassa", "Vardiyalar ve kasa", "Зміни та каса", "Ауысым және касса"),
    "mod.analytics.sub": tr("Revenue & analytics", "Выручка и аналитика", "Ricavi e analisi", "Revenus et analyses", "Gəlir və analitika", "Gelir ve analiz", "Виручка та аналітика", "Кіріс және аналитика"),
    "mod.stash.sub":     tr("Stock & sessions", "Склад и сессии", "Magazzino e sessioni", "Stock et sessions", "Anbar və seanslar", "Stok ve seanslar", "Склад і сесії", "Қойма және сеанстар"),
    "mod.people.sub":    tr("Team & schedule", "Команда и расписание", "Team e turni", "Équipe et planning", "Komanda və qrafik", "Ekip ve program", "Команда та розклад", "Команда және кесте"),

    // Вкладки Analytics
    "tab.period":   tr("Period", "Период", "Periodo", "Période", "Dövr", "Dönem", "Період", "Кезең"),
    "tab.kassa":    tr("Cash", "Касса", "Cassa", "Caisse", "Kassa", "Kasa", "Каса", "Касса"),
    "tab.forecast": tr("Forecast", "Прогноз", "Previsione", "Prévision", "Proqnoz", "Tahmin", "Прогноз", "Болжам"),
    "tab.salary":   tr("Salary", "Зарплата", "Stipendio", "Salaire", "Maaş", "Maaş", "Зарплата", "Жалақы"),
    "tab.hookah":   tr("Sessions", "Сессии", "Sessioni", "Sessions", "Seanslar", "Seanslar", "Сесії", "Сеанстар"),

    // Вкладки People
    "tab.shifts": tr("Shifts", "Смены", "Turni", "Services", "Növbələr", "Vardiyalar", "Зміни", "Ауысымдар"),
    "tab.tasks":  tr("Tasks", "Задачи", "Compiti", "Tâches", "Tapşırıqlar", "Görevler", "Завдання", "Тапсырмалар"),
    "tab.hall":   tr("Hall", "Зал", "Sala", "Salle", "Zal", "Salon", "Зал", "Зал"),
    "tab.purchase": tr("Purchase", "Закуп", "Acquisti", "Achats", "Satınalma", "Satın alma", "Закупівля", "Сатып алу"),

    // Закуп (pe.p*) + настройки уведомлений (pe.ns*)
    "pe.pTab":         tr("Purchase", "Закуп", "Acquisti", "Achats", "Satınalma", "Satın alma", "Закупівля", "Сатып алу"),
    "pe.pAddItems":    tr("Add items", "Добавить", "Aggiungi", "Ajouter", "Əlavə et", "Ekle", "Додати", "Қосу"),
    "pe.pNew":         tr("What to buy", "Что купить", "Cosa comprare", "Quoi acheter", "Nə almalı", "Ne alınmalı", "Що купити", "Не сатып алу"),
    "pe.pEmpty":       tr("List is empty", "Список пуст", "Lista vuota", "Liste vide", "Siyahı boşdur", "Liste boş", "Список порожній", "Тізім бос"),
    "pe.pEmptyHint":   tr("Add what needs to be bought", "Добавьте, что нужно купить", "Aggiungi cosa comprare", "Ajoutez quoi acheter", "Nə alınacağını əlavə edin", "Ne alınacağını ekleyin", "Додайте, що купити", "Не сатып алу керегін қосыңыз"),
    "pe.pNamePh":      tr("Item, e.g. Milk", "Позиция, напр. Молоко", "Articolo, es. Latte", "Article, ex. Lait", "Məhsul, məs. Süd", "Ürün, örn. Süt", "Позиція, напр. Молоко", "Тауар, мыс. Сүт"),
    "pe.pQty":         tr("Qty", "Кол-во", "Qtà", "Qté", "Say", "Adet", "К-сть", "Саны"),
    "pe.pQtyEx":       tr("5", "5", "5", "5", "5", "5", "5", "5"),
    "pe.pUnit":        tr("Unit", "Ед.", "Unità", "Unité", "Vahid", "Birim", "Од.", "Бірлік"),
    "pe.pUnitEx":      tr("kg", "кг", "kg", "kg", "kq", "kg", "кг", "кг"),
    "pe.pAddRow":      tr("one more", "ещё позиция", "un altro", "un autre", "daha biri", "bir daha", "ще одна", "тағы бір"),
    "pe.pSubmit":      tr("Add to list", "Добавить в список", "Aggiungi alla lista", "Ajouter à la liste", "Siyahıya əlavə et", "Listeye ekle", "Додати до списку", "Тізімге қосу"),
    "pe.pToBuy":       tr("To buy", "Купить", "Da comprare", "À acheter", "Alınacaq", "Alınacak", "Купити", "Сатып алу"),
    "pe.pDone":        tr("Bought", "Куплено", "Comprati", "Achetés", "Alınanlar", "Alınanlar", "Куплено", "Сатып алынды"),
    "pe.pBought":      tr("Bought", "Куплено", "Comprato", "Acheté", "Alındı", "Alındı", "Куплено", "Сатып алынды"),
    "pe.pUnavail":     tr("Out of stock", "Нет в наличии", "Esaurito", "En rupture", "Stokda yoxdur", "Stokta yok", "Немає в наявності", "Қоймада жоқ"),
    "pe.pCopy":        tr("Copy", "Копировать", "Copia", "Copier", "Kopyala", "Kopyala", "Копіювати", "Көшіру"),
    "pe.pCopied":      tr("Copied", "Скопировано", "Copiato", "Copié", "Kopyalandı", "Kopyalandı", "Скопійовано", "Көшірілді"),
    "pe.pClearDone":   tr("Clear bought", "Очистить купленное", "Pulisci comprati", "Effacer achetés", "Alınanları təmizlə", "Alınanları temizle", "Очистити куплене", "Сатып алынғанды тазалау"),
    "pe.catKitchen":   tr("Kitchen", "Кухня", "Cucina", "Cuisine", "Mətbəx", "Mutfak", "Кухня", "Ас үй"),
    "pe.catBar":       tr("Bar", "Бар", "Bar", "Bar", "Bar", "Bar", "Бар", "Бар"),
    "pe.catHookah":    tr("Hookah", "Кальян", "Narghilè", "Chicha", "Kalyan", "Nargile", "Кальян", "Кальян"),
    "pe.catHousehold": tr("Household", "Хозтовары", "Casalinghi", "Ménage", "Təsərrüfat", "Ev", "Господарські", "Шаруашылық"),
    "pe.catGeneral":   tr("General", "Общее", "Generale", "Général", "Ümumi", "Genel", "Загальне", "Жалпы"),
    "pe.nsTitle":      tr("Notification settings", "Настройки уведомлений", "Impostazioni notifiche", "Réglages des notifications", "Bildiriş tənzimləmələri", "Bildirim ayarları", "Налаштування сповіщень", "Хабарландыру баптаулары"),
    "pe.nsShiftReminder": tr("Shift reminders", "Напоминания о смене", "Promemoria turni", "Rappels de service", "Növbə xatırlatmaları", "Vardiya hatırlatıcıları", "Нагадування про зміну", "Ауысым еске салулары"),
    "pe.nsTask":       tr("Tasks", "Задачи", "Attività", "Tâches", "Tapşırıqlar", "Görevler", "Задачі", "Тапсырмалар"),
    "pe.nsSwap":       tr("Shift swaps", "Обмены смен", "Scambi turni", "Échanges de service", "Növbə dəyişiklikləri", "Vardiya değişimleri", "Обміни змін", "Ауысым алмасулары"),
    "pe.nsNews":       tr("News & announcements", "Новости и объявления", "Notizie e annunci", "Actualités et annonces", "Xəbərlər və elanlar", "Haberler ve duyurular", "Новини та оголошення", "Жаңалықтар мен хабарландырулар"),
    "pe.nsBooking":    tr("New bookings", "Новые брони", "Nuove prenotazioni", "Nouvelles réservations", "Yeni rezervlər", "Yeni rezervasyonlar", "Нові броні", "Жаңа брондар"),
    "pe.nsAttendance": tr("Staff arrivals", "Приход на смену", "Arrivi del personale", "Arrivées du personnel", "İşçi gəlişləri", "Personel gelişleri", "Прихід на зміну", "Қызметкердің келуі"),
    "pe.nsCashOpen":   tr("Cash opened", "Открытие кассы", "Cassa aperta", "Caisse ouverte", "Kassa açılışı", "Kasa açılışı", "Відкриття каси", "Касса ашылуы"),
    "pe.nsCashClose":  tr("Cash closed", "Закрытие кассы", "Cassa chiusa", "Caisse fermée", "Kassa bağlanışı", "Kasa kapanışı", "Закриття каси", "Касса жабылуы"),
    "pe.nsPurchase":   tr("Purchases", "Закуп", "Acquisti", "Achats", "Satınalma", "Satın alma", "Закупівля", "Сатып алу"),
    "pe.nsShowAmount": tr("Show cash amount", "Показывать сумму кассы", "Mostra importo cassa", "Afficher le montant", "Kassa məbləğini göstər", "Kasa tutarını göster", "Показувати суму каси", "Касса сомасын көрсету"),
    "pe.nsPurchaseMode": tr("Purchase alerts", "Уведомления о закупе", "Avvisi acquisti", "Alertes achats", "Satınalma bildirişləri", "Satın alma uyarıları", "Сповіщення про закупівлю", "Сатып алу хабарландырулары"),
    "pe.nsEach":       tr("Each item", "Каждая позиция", "Ogni articolo", "Chaque article", "Hər məhsul", "Her ürün", "Кожна позиція", "Әр тауар"),
    "pe.nsDaily":      tr("Once a day", "Раз в день", "Una volta al giorno", "Une fois par jour", "Gündə bir dəfə", "Günde bir kez", "Раз на день", "Күніне бір рет"),
    "pe.nsForManagers": tr("For managers and owner", "Для менеджеров и владельца", "Per manager e titolare", "Pour managers et propriétaire", "Menecerlər və sahib üçün", "Yöneticiler ve sahip için", "Для менеджерів і власника", "Менеджерлер мен иеге"),

    // Дисциплина (pe.dis*)
    "pe.discipline":   tr("Discipline", "Дисциплина", "Disciplina", "Discipline", "İntizam", "Disiplin", "Дисципліна", "Тәртіп"),
    "pe.disMore":      tr("Details", "Подробнее", "Dettagli", "Détails", "Ətraflı", "Ayrıntılar", "Детальніше", "Толығырақ"),
    "pe.perThisMonth": tr("This month", "Этот месяц", "Questo mese", "Ce mois", "Bu ay", "Bu ay", "Цей місяць", "Осы ай"),
    "pe.perLastMonth": tr("Last month", "Прошлый", "Mese scorso", "Mois dernier", "Keçən ay", "Geçen ay", "Минулий", "Өткен ай"),
    "pe.per30":        tr("30 days", "30 дней", "30 giorni", "30 jours", "30 gün", "30 gün", "30 днів", "30 күн"),
    "pe.per90":        tr("90 days", "90 дней", "90 giorni", "90 jours", "90 gün", "90 gün", "90 днів", "90 күн"),
    "pe.punctuality":  tr("Punctuality", "Пунктуальность", "Puntualità", "Ponctualité", "Dəqiqlik", "Dakiklik", "Пунктуальність", "Дәлдік"),
    "pe.disOnTime":    tr("On time", "Вовремя", "In orario", "À l’heure", "Vaxtında", "Zamanında", "Вчасно", "Уақытында"),
    "pe.disTotal":     tr("Total", "Суммарно", "Totale", "Total", "Cəmi", "Toplam", "Сумарно", "Жалпы"),
    "pe.disAvg":       tr("Average", "Среднее", "Media", "Moyenne", "Orta", "Ortalama", "Середнє", "Орташа"),
    "pe.disMax":       tr("Max", "Макс.", "Max", "Max", "Maks.", "Maks.", "Макс.", "Макс."),
    "pe.disLates":     tr("Late", "Опозданий", "Ritardi", "Retards", "Gecikmə", "Gecikme", "Запізнень", "Кешігу"),
    "pe.disShifts":    tr("shifts", "смен", "turni", "services", "növbə", "vardiya", "змін", "ауысым"),
    "pe.disMin":       tr("min", "мин", "min", "min", "dəq", "dk", "хв", "мин"),
    "pe.disNoData":    tr("No data", "Нет данных", "Nessun dato", "Aucune donnée", "Məlumat yoxdur", "Veri yok", "Немає даних", "Дерек жоқ"),
    "pe.disEmpty":     tr("No attendance in this period", "Нет явок за период", "Nessuna presenza nel periodo", "Aucune présence sur la période", "Bu dövrdə davamiyyət yoxdur", "Bu dönemde devam yok", "Немає явок за період", "Бұл кезеңде келу жоқ"),
    "pe.disCopy":      tr("Copy summary", "Скопировать сводку", "Copia riepilogo", "Copier le résumé", "Xülasəni kopyala", "Özeti kopyala", "Скопіювати зведення", "Қорытындыны көшіру"),
    "pe.disGrace":     tr("Late threshold, min", "Порог опоздания, мин", "Soglia ritardo, min", "Seuil de retard, min", "Gecikmə həddi, dəq", "Gecikme eşiği, dk", "Поріг запізнення, хв", "Кешігу шегі, мин"),
    "pe.disExtra":     tr("Off-schedule", "Без графика", "Fuori turno", "Hors planning", "Cədvəlsiz", "Program dışı", "Поза графіком", "Кестесіз"),

    // Вкладки Stash
    "tab.stashShift": tr("Shift", "Смена", "Turno", "Service", "Növbə", "Vardiya", "Зміна", "Ауысым"),
    "tab.stock":      tr("Stock", "Склад", "Magazzino", "Stock", "Anbar", "Stok", "Склад", "Қойма"),
    "tab.movements":  tr("Movements", "Движения", "Movimenti", "Mouvements", "Hərəkətlər", "Hareketler", "Рухи", "Қозғалыстар"),
    "tab.inventory":  tr("Inventory", "Инвентаризация", "Inventario", "Inventaire", "İnventarizasiya", "Envanter", "Інвентаризація", "Түгендеу"),

    // Онбординг
    "onb.tagline": tr("Everything for your venue — in one app", "Всё для заведения — в одном приложении", "Tutto per il tuo locale, in un’app", "Tout pour votre établissement, dans une app", "Məkanınız üçün hər şey — bir tətbiqdə", "Mekanınız için her şey — tek uygulamada", "Усе для закладу — в одному застосунку", "Орныңызға керектің бәрі — бір қолданбада"),
    "onb.login":   tr("Log in", "Войти", "Accedi", "Se connecter", "Daxil ol", "Giriş yap", "Увійти", "Кіру"),
    "pin.enter":   tr("Enter PIN", "Введите PIN", "Inserisci il PIN", "Saisir le PIN", "PIN daxil edin", "PIN girin", "Введіть PIN", "PIN енгізіңіз"),
    "pin.change":  tr("Change venue", "Сменить заведение", "Cambia locale", "Changer d’établissement", "Məkanı dəyiş", "Mekanı değiştir", "Змінити заклад", "Орынды ауыстыру"),
    "pin.deviceMismatch":    tr("Device not recognised", "Устройство не распознано", "Dispositivo non riconosciuto", "Appareil non reconnu", "Cihaz tanınmadı", "Cihaz tanınmadı", "Пристрій не розпізнано", "Құрылғы танылмады"),
    "pin.deviceMismatchMsg": tr("This PIN is linked to another device. Ask your manager to reset the device binding.", "Этот PIN привязан к другому устройству. Попросите менеджера сбросить привязку.", "Questo PIN è collegato a un altro dispositivo. Chiedi al manager di reimpostare il collegamento.", "Ce PIN est lié à un autre appareil. Demandez à votre manager de réinitialiser le lien.", "Bu PIN başqa cihaza bağlıdır. Menecerdən cihaz bağlantısını sıfırlamasını xahiş edin.", "Bu PIN başka bir cihaza bağlı. Yöneticinizden cihaz bağlantısını sıfırlamasını isteyin.", "Цей PIN прив’язаний до іншого пристрою. Попросіть менеджера скинути прив’язку.", "Бұл PIN басқа құрылғыға байланған. Менеджерден байланысты сіфрлауды сұраңыз."),
    "pin.deviceLimit":       tr("Device limit reached", "Достигнут лимит устройств", "Limite dispositivi raggiunto", "Limite d’appareils atteint", "Cihaz limiti doldu", "Cihaz limiti doldu", "Ліміт пристроїв вичерпано", "Құрылғы лимиті толды"),
    "pin.deviceLimitMsg":    tr("Your plan’s device limit is reached. Ask your manager to upgrade the subscription.", "Лимит устройств вашего тарифа исчерпан. Попросите менеджера обновить подписку.", "Il limite dispositivi del tuo piano è stato raggiunto. Chiedi al manager di aggiornare l’abbonamento.", "La limite d’appareils de votre abonnement est atteinte. Demandez à votre manager de mettre à niveau.", "Tarifinizin cihaz limiti doldu. Menecerdən abunəliyi yeniləməsini xahiş edin.", "Planınızın cihaz limiti doldu. Yöneticinizden aboneliği güncellemesini isteyin.", "Ліміт пристроїв вашого тарифу вичерпано. Попросіть менеджера оновити підписку.", "Тарифыңыздың құрылғы лимиті толды. Менеджерден жазылымды жаңартуды сұраңыз."),

    // Общее (доп.)
    "saving":     tr("Saving…", "Сохранение…", "Salvataggio…", "Enregistrement…", "Saxlanılır…", "Kaydediliyor…", "Збереження…", "Сақталуда…"),
    "saveFailed": tr("Not saved: {err}", "Не сохранилось: {err}", "Non salvato: {err}", "Non enregistré : {err}", "Saxlanılmadı: {err}", "Kaydedilmedi: {err}", "Не збережено: {err}", "Сақталмады: {err}"),
    "refreshFailed": tr("Couldn’t refresh", "Не удалось обновить", "Aggiornamento non riuscito", "Échec de l’actualisation", "Yenilənmədi", "Yenilenemedi", "Не вдалося оновити", "Жаңарту сәтсіз"),
    "empty":      tr("Empty", "Пусто", "Vuoto", "Vide", "Boş", "Boş", "Порожньо", "Бос"),
    "noData":     tr("No data", "Нет данных", "Nessun dato", "Aucune donnée", "Məlumat yoxdur", "Veri yok", "Немає даних", "Дерек жоқ"),

    // Manager
    "mg.noShift":        tr("Shift not open", "Смена не открыта", "Turno non aperto", "Service non ouvert", "Növbə açıq deyil", "Vardiya açık değil", "Зміна не відкрита", "Ауысым ашылмаған"),
    "mg.noShiftHint":    tr("Open a shift to track the till for this day", "Откройте смену, чтобы вести кассу за этот день", "Apri un turno per gestire la cassa di questa giornata", "Ouvrez un service pour gérer la caisse du jour", "Bu gün üçün kassanı aparmaq üçün növbə açın", "Bu günün kasasını tutmak için vardiya açın", "Відкрийте зміну, щоб вести касу за цей день", "Осы күнге касса жүргізу үшін ауысым ашыңыз"),
    "mg.openShift":      tr("Open shift", "Открыть смену", "Apri turno", "Ouvrir le service", "Növbəni aç", "Vardiya aç", "Відкрити зміну", "Ауысым ашу"),
    "mg.cash":           tr("Till", "Касса", "Cassa", "Caisse", "Kassa", "Kasa", "Каса", "Касса"),
    "mg.cashIncome":     tr("Cash", "Наличные", "Contanti", "Espèces", "Nağd", "Nakit", "Готівка", "Қолма-қол"),
    "mg.cardIncome":     tr("Card (cashless)", "Безнал (карта)", "Carta (elettronico)", "Carte (sans espèces)", "Kart (nağdsız)", "Kart (nakitsiz)", "Безгот. (картка)", "Картамен"),
    "mg.expenses":       tr("Expenses", "Расходы", "Spese", "Dépenses", "Xərclər", "Giderler", "Витрати", "Шығындар"),
    "mg.inkass":         tr("Cash collection", "Инкассация", "Prelievo cassa", "Encaisse", "İnkassasiya", "Tahsilat", "Інкасація", "Инкассация"),
    "mg.inkSum":         tr("Collection amount", "Сумма инкассации", "Importo prelievo", "Montant encaissé", "İnkassasiya məbləği", "Tahsilat tutarı", "Сума інкасації", "Инкассация сомасы"),
    "mg.inkExpense":     tr("Expense from collection", "Расход из инкассации", "Spesa dal prelievo", "Dépense du prélèvement", "İnkassasiyadan xərc", "Tahsilattan gider", "Витрата з інкасації", "Инкассациядан шығыс"),
    "mg.inkReason":      tr("Reason", "Причина", "Motivo", "Motif", "Səbəb", "Neden", "Причина", "Себеп"),
    "mg.salary":         tr("Salary", "Зарплата", "Stipendio", "Salaire", "Maaş", "Maaş", "Зарплата", "Жалақы"),
    "mg.shiftClosed":    tr("Shift closed", "Смена закрыта", "Turno chiuso", "Service fermé", "Növbə bağlandı", "Vardiya kapandı", "Зміна закрита", "Ауысым жабылды"),
    "mg.shiftSavedSub":  tr("Day’s till saved", "Касса за день сохранена", "Cassa del giorno salvata", "Caisse du jour enregistrée", "Günün kassası saxlanıldı", "Günün kasası kaydedildi", "Касу за день збережено", "Күнгі касса сақталды"),
    "mg.openForEdit":    tr("Open for editing", "Открыть для редактирования", "Apri per modificare", "Ouvrir pour modifier", "Redaktə üçün aç", "Düzenlemek için aç", "Відкрити для редагування", "Өңдеу үшін ашу"),
    "mg.cascadeNote":    tr("Changes will recalculate the following days’ till", "Изменения пересчитают кассу следующих дней", "Le modifiche ricalcoleranno la cassa dei giorni successivi", "Les modifications recalculeront la caisse des jours suivants", "Dəyişikliklər sonrakı günlərin kassasını yenidən hesablayacaq", "Değişiklikler sonraki günlerin kasasını yeniden hesaplar", "Зміни перерахують касу наступних днів", "Өзгерістер келесі күндердің кассасын қайта есептейді"),
    "mg.staff":          tr("Staff", "Сотрудники", "Personale", "Personnel", "İşçilər", "Personel", "Працівники", "Қызметкерлер"),
    "mg.auto":           tr("AUTO", "АВТО", "AUTO", "AUTO", "AVTO", "OTO", "АВТО", "АВТО"),
    "mg.openingBalance": tr("Opening balance", "Остаток на начало", "Saldo iniziale", "Solde d’ouverture", "Başlanğıc qalıq", "Açılış bakiyesi", "Залишок на початок", "Бастапқы қалдық"),
    "mg.cashRevenue":    tr("Cash revenue", "Наличная выручка", "Ricavo in contanti", "Recette en espèces", "Nağd gəlir", "Nakit gelir", "Готівкова виручка", "Қолма-қол түсім"),
    "mg.closingBalance": tr("Closing balance", "Касса на конец", "Cassa finale", "Caisse finale", "Yekun kassa", "Kapanış kasası", "Каса на кінець", "Соңғы касса"),
    "mg.inkNet":         tr("Cash collection (net)", "Инкассация (итог)", "Prelievo (totale)", "Encaisse (total)", "İnkassasiya (yekun)", "Tahsilat (toplam)", "Інкасація (підсумок)", "Инкассация (қорытынды)"),
    "mg.saveShift":      tr("Save shift", "Сохранить смену", "Salva turno", "Enregistrer le service", "Növbəni saxla", "Vardiyayı kaydet", "Зберегти зміну", "Ауысымды сақтау"),
    "mg.shiftOpened":    tr("Shift opened", "Смена открыта", "Turno aperto", "Service ouvert", "Növbə açıldı", "Vardiya açıldı", "Зміна відкрита", "Ауысым ашылды"),
    "mg.shiftSaved":     tr("Shift saved", "Смена сохранена", "Turno salvato", "Service enregistré", "Növbə saxlanıldı", "Vardiya kaydedildi", "Зміну збережено", "Ауысым сақталды"),

    // Stash
    "st.shiftSaved":    tr("Shift saved · {p} sold", "Смена сохранена · {p} продано", "Turno salvato · {p} venduti", "Service enregistré · {p} vendus", "Növbə saxlanıldı · {p} satıldı", "Vardiya kaydedildi · {p} satıldı", "Зміну збережено · {p} продано", "Ауысым сақталды · {p} сатылды"),
    "st.shiftSavedFree": tr(" · {f} free", " · {f} беспл.", " · {f} gratis", " · {f} gratuits", " · {f} pulsuz", " · {f} ücretsiz", " · {f} безкошт.", " · {f} тегін"),
    "st.fillRow":       tr("Fill at least one row", "Заполните хотя бы одну строку", "Compila almeno una riga", "Remplissez au moins une ligne", "Ən azı bir sətir doldurun", "En az bir satır doldurun", "Заповніть хоча б один рядок", "Кемінде бір жол толтырыңыз"),
    "st.notInStock":    tr("{b} · {fl} — not in stock", "{b} · {fl} — нет на складе", "{b} · {fl} — non in magazzino", "{b} · {fl} — pas en stock", "{b} · {fl} — anbarda yoxdur", "{b} · {fl} — stokta yok", "{b} · {fl} — немає на складі", "{b} · {fl} — қоймада жоқ"),
    "st.onlyLeft":      tr("{b} · {fl}: only {g}", "{b} · {fl}: только {g}", "{b} · {fl}: solo {g}", "{b} · {fl} : seulement {g}", "{b} · {fl}: yalnız {g}", "{b} · {fl}: sadece {g}", "{b} · {fl}: лише {g}", "{b} · {fl}: тек {g}"),
    "st.writeoffReason": tr("Specify the write-off reason", "Укажите причину списания", "Indica il motivo dello scarico", "Indiquez le motif de la radiation", "Silinmə səbəbini göstərin", "Düşüm nedenini belirtin", "Вкажіть причину списання", "Есептен шығару себебін көрсетіңіз"),
    "st.saved":         tr("Saved: {n}", "Сохранено: {n}", "Salvato: {n}", "Enregistré : {n}", "Saxlanıldı: {n}", "Kaydedildi: {n}", "Збережено: {n}", "Сақталды: {n}"),
    "st.noTypes":       tr("No session types set", "Виды сессий не заданы", "Nessun tipo di sessione impostato", "Aucun type de session défini", "Seans növləri təyin edilməyib", "Seans türü tanımlı değil", "Типи сесій не задані", "Сеанс түрлері белгіленбеген"),
    "st.noTypesHint":   tr("Add them in the dashboard: Settings → Sessions", "Добавьте их в дашборде: Настройки → Сессии", "Aggiungili nella dashboard: Impostazioni → Sessioni", "Ajoutez-les dans le tableau de bord : Réglages → Sessions", "Onları idarə panelində əlavə edin: Tənzimləmələr → Seanslar", "Bunları panoda ekleyin: Ayarlar → Seanslar", "Додайте їх у дашборді: Налаштування → Сесії", "Оларды дашбордта қосыңыз: Параметрлер → Сеанстар"),
    "st.toToday":       tr("To today", "К сегодня", "A oggi", "À aujourd’hui", "Bu günə", "Bugüne", "До сьогодні", "Бүгінге"),
    "st.sold":          tr("Sold", "Продано", "Venduti", "Vendus", "Satıldı", "Satıldı", "Продано", "Сатылды"),
    "st.free":          tr("Free", "Бесплатно", "Gratis", "Gratuits", "Pulsuz", "Ücretsiz", "Безкоштовно", "Тегін"),
    "st.revenue":       tr("Revenue", "Выручка", "Ricavo", "Recette", "Gəlir", "Gelir", "Виручка", "Түсім"),
    "st.tobacco":       tr("Product", "Продукт", "Prodotto", "Produit", "Məhsul", "Ürün", "Продукт", "Өнім"),
    "st.sale":          tr("Sale", "Продажа", "Vendita", "Vente", "Satış", "Satış", "Продаж", "Сату"),
    "st.search":        tr("Search", "Поиск", "Cerca", "Rechercher", "Axtarış", "Ara", "Пошук", "Іздеу"),
    "st.low":           tr("{n} low", "{n} мало", "{n} in esaurimento", "{n} faibles", "{n} az", "{n} az", "{n} мало", "{n} аз"),
    "st.in":            tr("Inbound", "Приход", "Entrata", "Entrée", "Mədaxil", "Giriş", "Прихід", "Кіріс"),
    "st.out":           tr("Issue", "Выдача", "Uscita", "Sortie", "Verilmə", "Çıkış", "Видача", "Беру"),
    "st.writeoff":      tr("Write-off", "Списание", "Scarico", "Radiation", "Silinmə", "Düşüm", "Списання", "Есептен шығару"),
    "st.addMovement":   tr("Add movement", "Добавить движение", "Aggiungi movimento", "Ajouter un mouvement", "Hərəkət əlavə et", "Hareket ekle", "Додати рух", "Қозғалыс қосу"),
    "st.noMovements":   tr("No movements", "Нет движений", "Nessun movimento", "Aucun mouvement", "Hərəkət yoxdur", "Hareket yok", "Немає рухів", "Қозғалыс жоқ"),
    "st.positions":     tr("{n} items", "{n} позиц.", "{n} voci", "{n} articles", "{n} mövqe", "{n} kalem", "{n} позиц.", "{n} позиция"),
    "st.brand":         tr("Brand", "Бренд", "Marca", "Marque", "Marka", "Marka", "Бренд", "Бренд"),
    "st.flavor":        tr("Flavor", "Вкус", "Gusto", "Saveur", "Dad", "Aroma", "Смак", "Дәм"),
    "st.grams":         tr("Grams", "Граммы", "Grammi", "Grammes", "Qram", "Gram", "Грами", "Грамм"),
    "st.available":     tr("Available", "Доступно", "Disponibile", "Disponible", "Mövcud", "Mevcut", "Доступно", "Қолжетімді"),
    "st.moreRow":       tr("One more row", "Ещё строка", "Altra riga", "Une ligne de plus", "Daha bir sətir", "Bir satır daha", "Ще рядок", "Тағы жол"),
    "st.writeoffReasonField": tr("Write-off reason", "Причина списания", "Motivo dello scarico", "Motif de la radiation", "Silinmə səbəbi", "Düşüm nedeni", "Причина списання", "Есептен шығару себебі"),
    "st.movement":      tr("Movement", "Движение", "Movimento", "Mouvement", "Hərəkət", "Hareket", "Рух", "Қозғалыс"),
    "st.manual":        tr("Manual", "Вручную", "Manuale", "Manuel", "Əl ilə", "Elle", "Вручну", "Қолмен"),
    "st.fromStock":     tr("From stock", "Из склада", "Da magazzino", "Du stock", "Anbardan", "Depodan", "Зі складу", "Қоймадан"),
    "st.takeTotal":     tr("Taking total", "Итого забираешь", "Totale preso", "Total prélevé", "Cəmi götürülür", "Toplam alınan", "Разом береш", "Барлығы аласың"),
    "st.totalIn":       tr("Total inbound", "Итого приход", "Totale entrata", "Total entrée", "Cəmi mədaxil", "Toplam giriş", "Разом прихід", "Барлық кіріс"),
    "st.totalOut":      tr("Total to issue", "Итого к выдаче", "Totale da emettere", "Total à sortir", "Cəmi verilməyə", "Toplam çıkış", "Разом до видачі", "Барлық беру"),
    "st.totalWriteoff": tr("Total to write off", "Итого к списанию", "Totale da scaricare", "Total à radier", "Cəmi silinməyə", "Toplam düşüm", "Разом до списання", "Барлық есептен шығару"),
    "st.fromWarehouse": tr("From stock", "Со склада", "Da magazzino", "Du stock", "Anbardan", "Depodan", "Зі складу", "Қоймадан"),
    "st.fromVenue":     tr("From venue", "С заведения", "Dal locale", "Du local", "Məkandan", "Mekândan", "Із закладу", "Орыннан"),
    "st.venueWriteoffLabel": tr("Venue write-off", "Списание с заведения", "Scarico locale", "Radiation local", "Məkandan silinmə", "Mekândan düşüm", "Списання із закладу", "Орыннан есептен шығару"),
    "st.venueWriteoffHint":  tr("Total venue weight, without brand/flavor", "Общий вес в заведении, без бренда и вкуса", "Peso totale nel locale, senza marca/gusto", "Poids total au local, sans marque/saveur", "Məkanda ümumi çəki, marka/dadsız", "Mekânda toplam ağırlık, marka/aroma olmadan", "Загальна вага в закладі, без бренду/смаку", "Орындағы жалпы салмақ, бренд/дәмсіз"),
    "st.venueAvailable":     tr("In venue", "В заведении", "Nel locale", "Au local", "Məkanda", "Mekânda", "У закладі", "Орында"),
    "st.onlyLeftVenue": tr("Only {g} in venue", "В заведении только {g}", "Solo {g} nel locale", "Seulement {g} au local", "Məkanda yalnız {g}", "Mekânda yalnızca {g}", "У закладі лише {g}", "Орында тек {g}"),
    "st.movDeleted":    tr("Movement deleted", "Перемещение удалено", "Movimento eliminato", "Mouvement supprimé", "Hərəkət silindi", "Hareket silindi", "Переміщення видалено", "Қозғалыс жойылды"),
    "st.movDeleteConfirm": tr("Delete this movement? Stock will be restored.", "Удалить перемещение? Остаток вернётся.", "Eliminare il movimento? La giacenza tornerà.", "Supprimer le mouvement ? Le stock sera restauré.", "Hərəkəti sil? Qalıq bərpa olunacaq.", "Hareketi sil? Stok geri gelecek.", "Видалити переміщення? Залишок повернеться.", "Қозғалысты жою? Қалдық қайтарылады."),
    "st.editMovement":  tr("Edit movement", "Изменить перемещение", "Modifica movimento", "Modifier le mouvement", "Hərəkəti dəyiş", "Hareketi düzenle", "Змінити переміщення", "Қозғалысты өзгерту"),
    "st.movEditHint":   tr("Long-press a movement to edit or delete", "Долгий тап по перемещению — изменить или удалить", "Tieni premuto un movimento per modificarlo o eliminarlo", "Appui long sur un mouvement pour modifier ou supprimer", "Hərəkəti dəyişmək/silmək üçün uzun basın", "Düzenlemek/silmek için harekete uzun basın", "Довгий тап по переміщенню — змінити або видалити", "Өзгерту/жою үшін қозғалысты ұзақ басыңыз"),
    "st.addManual":     tr("Add new manually", "Добавить новый вручную", "Aggiungi nuovo manualmente", "Ajouter manuellement", "Əl ilə yeni əlavə et", "Elle yeni ekle", "Додати новий вручну", "Қолмен жаңасын қосу"),
    "st.noStockPick":   tr("Nothing in stock yet", "На складе пока пусто", "Magazzino vuoto", "Stock vide", "Anbar boşdur", "Depo boş", "На складі порожньо", "Қойма бос"),
    "st.noInventories": tr("No inventory counts yet", "Инвентаризаций пока нет", "Nessun inventario", "Aucun inventaire", "Hələ inventarizasiya yoxdur", "Henüz envanter yok", "Інвентаризацій поки немає", "Әзірге түгендеу жоқ"),
    "st.outOfStock":    tr("{n} empty", "{n} закончилось", "{n} esauriti", "{n} épuisés", "{n} bitmişdir", "{n} tükendi", "{n} закінчилось", "{n} бітті"),
    "st.doInventory":   tr("Count inventory", "Инвентаризация", "Inventario", "Inventaire", "İnventarizasiya", "Envanter", "Інвентаризація", "Түгендеу"),
    "st.invExpected":   tr("Expected", "Ожидаемо", "Atteso", "Prévu", "Gözlənilən", "Beklenen", "Очікувано", "Күтілуде"),
    "st.invEmpty":      tr("No discrepancies", "Расхождений нет", "Nessuna discrepanza", "Aucun écart", "Uyğunsuzluq yoxdur", "Farklılık yok", "Розбіжностей немає", "Алшақтық жоқ"),
    "st.discrepancies": tr("{n} discrepancies", "{n} расхождений", "{n} discrepanze", "{n} écarts", "{n} uyğunsuzluq", "{n} farklılık", "{n} розбіжностей", "{n} алшақтық"),

    // Общие денежные подписи (исп. в Analytics и People)
    "byCash":     tr("In cash", "Наличными", "In contanti", "En espèces", "Nağdla", "Nakit", "Готівкою", "Қолмен"),
    "toCard":     tr("To card", "На карту", "Su carta", "Sur carte", "Karta", "Karta", "На картку", "Картаға"),
    "baseSalary": tr("Base pay", "Оклад", "Stipendio base", "Salaire de base", "Maaş", "Maaş", "Оклад", "Жалақы"),
    "absencesN":  tr("Absences ({n})", "Пропуски ({n})", "Assenze ({n})", "Absences ({n})", "Qayıb ({n})", "Devamsızlık ({n})", "Пропуски ({n})", "Жоқ болу ({n})"),

    // Analytics
    "an.income":         tr("Income", "Доход", "Entrate", "Revenu", "Gəlir", "Gelir", "Дохід", "Кіріс"),
    "an.expense":        tr("Expense", "Расход", "Spesa", "Dépense", "Xərc", "Gider", "Витрата", "Шығыс"),
    "an.day":            tr("Day", "День", "Giorno", "Jour", "Gün", "Gün", "День", "Күн"),
    "an.week":           tr("Week", "Неделя", "Settimana", "Semaine", "Həftə", "Hafta", "Тиждень", "Апта"),
    "an.month":          tr("Month", "Месяц", "Mese", "Mois", "Ay", "Ay", "Місяць", "Ай"),
    "an.pickDay":        tr("Pick a day", "Выбор дня", "Scegli un giorno", "Choisir un jour", "Gün seçin", "Gün seçin", "Вибір дня", "Күн таңдау"),
    "an.date":           tr("Date", "Дата", "Data", "Date", "Tarix", "Tarih", "Дата", "Күні"),
    "an.incomeByDay":    tr("INCOME BY DAY", "ДОХОД ПО ДНЯМ", "ENTRATE PER GIORNO", "REVENU PAR JOUR", "GÜNLƏR ÜZRƏ GƏLİR", "GÜNE GÖRE GELİR", "ДОХІД ПО ДНЯХ", "КҮНДЕР БОЙЫНША КІРІС"),
    "an.topExpenses":    tr("TOP EXPENSES", "ТОП РАСХОДОВ", "TOP SPESE", "TOP DÉPENSES", "ƏSAS XƏRCLƏR", "EN ÇOK GİDER", "ТОП ВИТРАТ", "НЕГІЗГІ ШЫҒЫНДАР"),
    "an.expenses":       tr("EXPENSES", "РАСХОДЫ", "SPESE", "DÉPENSES", "XƏRCLƏR", "GİDERLER", "ВИТРАТИ", "ШЫҒЫНДАР"),
    "an.payrollFund":    tr("PAYROLL · TO PAY", "ФОНД ЗАРПЛАТЫ · К ВЫПЛАТЕ", "FONDO STIPENDI · DA PAGARE", "MASSE SALARIALE · À PAYER", "ƏMƏK HAQQI · ÖDƏNİLƏCƏK", "MAAŞ FONU · ÖDENECEK", "ФОНД ЗАРПЛАТИ · ДО ВИПЛАТИ", "ЖАЛАҚЫ ҚОРЫ · ТӨЛЕНЕДІ"),
    "an.cardThisMonth":  tr("To card this month", "На карту в этом месяце", "Su carta questo mese", "Sur carte ce mois", "Bu ay karta", "Bu ay karta", "На картку цього місяця", "Осы айда картаға"),
    "an.inStock":        tr("In stock", "На складе", "In magazzino", "En stock", "Anbarda", "Stokta", "На складі", "Қоймада"),
    "an.atVenue":        tr("At venue", "В заведении", "Nel locale", "Sur place", "Məkanda", "Mekanda", "У закладі", "Орында"),
    "an.noHookahShifts": tr("No lounge sessions this month", "Сессий лаунжа в этом месяце нет", "Nessuna sessione lounge questo mese", "Aucune session lounge ce mois", "Bu ay launc sessiyası yoxdur", "Bu ay lounge seansı yok", "Цього місяця сесій лаунжу немає", "Бұл айда лаунж сеанстары жоқ"),
    "an.shiftsByDay":    tr("SHIFTS BY DAY", "СМЕНЫ ПО ДНЯМ", "TURNI PER GIORNO", "SERVICES PAR JOUR", "GÜNLƏR ÜZRƏ NÖVBƏLƏR", "GÜNE GÖRE VARDİYALAR", "ЗМІНИ ПО ДНЯХ", "КҮНДЕР БОЙЫНША АУЫСЫМДАР"),
    "an.balance":        tr("Balance", "Остаток", "Saldo", "Solde", "Qalıq", "Bakiye", "Залишок", "Қалдық"),
    "an.lastIncome":     tr("Last income", "Последний доход", "Ultimo incasso", "Dernier revenu", "Son gəlir", "Son gelir", "Останній дохід", "Соңғы кіріс"),
    "an.tillBalance":    tr("TILL BALANCE", "ОСТАТОК КАССЫ", "SALDO CASSA", "SOLDE CAISSE", "KASSA QALIĞI", "KASA BAKİYESİ", "ЗАЛИШОК КАСИ", "КАССА ҚАЛДЫҒЫ"),
    "an.noShiftData":    tr("No shift data", "Нет данных по сменам", "Nessun dato sui turni", "Aucune donnée de service", "Növbə məlumatı yoxdur", "Vardiya verisi yok", "Немає даних по змінах", "Ауысым деректері жоқ"),
    "an.byDay":          tr("BY DAY", "ПО ДНЯМ", "PER GIORNO", "PAR JOUR", "GÜNLƏR ÜZRƏ", "GÜNE GÖRE", "ПО ДНЯХ", "КҮНДЕР БОЙЫНША"),
    "an.inCol":          tr("In", "Вход", "Entrata", "Entrée", "Giriş", "Giriş", "Вхід", "Кіріс"),
    "an.totalInkass":    tr("Total collected", "Всего инкассации", "Totale prelievi", "Total encaissé", "Cəmi inkassasiya", "Toplam tahsilat", "Усього інкасації", "Барлық инкассация"),
    "an.salaryToday":    tr("Accrued salary", "Зарплата н/д", "Stipendio maturato", "Salaire couru", "Hesablanmış maaş", "Tahakkuk eden maaş", "Нарахована зарплата", "Есептелген жалақы"),
    "an.noInkass":       tr("No collections", "Инкассаций нет", "Nessun prelievo", "Aucun encaissement", "İnkassasiya yoxdur", "Tahsilat yok", "Інкасацій немає", "Инкассация жоқ"),
    "an.inkNet":         tr("NET", "ИТОГО", "NETTO", "NET", "XALİS", "NET", "НЕТТО", "НЕТТО"),
    "an.cashShort":      tr("Cash", "Нал", "Cont.", "Esp.", "Nağd", "Nakit", "Гот.", "Нақ."),
    "an.cardShort":      tr("Card", "Карта", "Carta", "Carte", "Kart", "Kart", "Карта", "Карта"),
    "an.inkShort":       tr("Inkass.", "Инкасс.", "Prelievo", "Encaisse", "İnkass.", "Tahsilat", "Інкас.", "Инкасс."),
    "an.advance":        tr("Advance", "Аванс", "Anticipo", "Avance", "Avans", "Avans", "Аванс", "Аванс"),
    "an.addAdvance":     tr("Add advance", "Добавить аванс", "Aggiungi anticipo", "Ajouter avance", "Avans əlavə et", "Avans ekle", "Додати аванс", "Аванс қосу"),
    "pe.theirShift":     tr("Their shift", "Смена коллеги", "Turno del collega", "Service du collègue", "Həmkarın növbəsi", "Meslektaşın vardiyası", "Зміна колеги", "Әріптестің ауысымы"),

    // AI
    "ai.send":          tr("Send", "Отправить", "Invia", "Envoyer", "Göndər", "Gönder", "Надіслати", "Жіберу"),
    "ai.noReply":       tr("No reply from AI", "Нет ответа от AI", "Nessuna risposta AI", "Pas de réponse AI", "AI cavabı yoxdur", "AI yanıtı yok", "Немає відповіді AI", "AI жауабы жоқ"),
    "ai.noData":        tr("AI couldn't extract data", "AI не смог распознать данные", "AI non ha estratto dati", "L'IA n'a pas pu extraire", "AI məlumat çıxara bilmədi", "AI veri çıkaramadı", "AI не зміг розпізнати дані", "AI деректерді алмады"),
    "ai.err401":        tr("Authorization error — try logging in again", "Ошибка авторизации — попробуйте войти снова", "Errore autorizzazione", "Erreur d'autorisation", "İcazə xətası", "Yetkilendirme hatası", "Помилка авторизації", "Авторизация қатесі"),
    "ai.err403":        tr("AI requires Pro plan or admin activation", "AI требует Pro-план или включение в панели", "AI richiede piano Pro", "L'IA nécessite un plan Pro", "AI Pro plan tələb edir", "AI Pro plan gerektirir", "AI потребує Pro-план", "AI Pro жоспарын талап етеді"),
    "ai.err500":        tr("Server error — check API key in Vercel", "Ошибка сервера — проверьте API-ключ в Vercel", "Errore server", "Erreur serveur", "Server xətası", "Sunucu hatası", "Помилка сервера", "Сервер қатесі"),
    "ai.err502":        tr("AI service error — check API key", "Ошибка AI-сервиса — проверьте API-ключ", "Errore servizio AI", "Erreur service IA", "AI xidmət xətası", "AI servis hatası", "Помилка AI-сервісу", "AI қызмет қатесі"),
    "ai.errGeneric":    tr("AI error", "Ошибка AI", "Errore AI", "Erreur IA", "AI xətası", "AI hatası", "Помилка AI", "AI қатесі"),
    "ai.thinking":      tr("Processing...", "Обрабатываю...", "Elaboro...", "Traitement...", "İşlənir...", "İşleniyor...", "Обробляю...", "Өңдеймін..."),
    "ai.typeMessage":   tr("Type a message...", "Напишите сообщение...", "Scrivi messaggio...", "Tapez un message...", "Mesaj yazın...", "Mesaj yazın...", "Напишіть повідомлення...", "Хабар жазыңыз..."),
    "ai.applied":       tr("Fields filled", "Поля заполнены", "Campi compilati", "Champs remplis", "Sahələr dolduruldu", "Alanlar dolduruldu", "Поля заповнені", "Өрістер толтырылды"),
    "ai.close":         tr("Close", "Закрыть", "Chiudi", "Fermer", "Bağla", "Kapat", "Закрити", "Жабу"),
    "an.pcs":            tr("{n} pcs", "{n} шт", "{n} pz", "{n} pcs", "{n} əd", "{n} adet", "{n} шт", "{n} дана"),
    "an.forecastMonth":  tr("MONTH FORECAST", "ПРОГНОЗ НА МЕСЯЦ", "PREVISIONE MESE", "PRÉVISION DU MOIS", "AY PROQNOZU", "AY TAHMİNİ", "ПРОГНОЗ НА МІСЯЦЬ", "АЙЛЫҚ БОЛЖАМ"),
    "an.revenueMonth":   tr("MONTH REVENUE", "ВЫРУЧКА ЗА МЕСЯЦ", "RICAVO DEL MESE", "REVENU DU MOIS", "AYLIQ GƏLİR", "AYLIK GELİR", "ВИРУЧКА ЗА МІСЯЦЬ", "АЙЛЫҚ ТҮСІМ"),
    "an.atPace":         tr("at current pace {v}/day", "при текущем темпе {v}/день", "al ritmo attuale {v}/giorno", "au rythme actuel {v}/jour", "cari templə {v}/gün", "mevcut hızla {v}/gün", "за поточним темпом {v}/день", "қазіргі қарқынмен {v}/күн"),
    "an.sinceMonthStart": tr("Since month start", "С начала месяца", "Da inizio mese", "Depuis le début du mois", "Ay əvvəlindən", "Ay başından", "З початку місяця", "Ай басынан"),
    "an.avgPerDay":      tr("Avg/day", "В среднем/день", "Media/giorno", "Moy./jour", "Orta/gün", "Ort./gün", "Сер./день", "Орт./күн"),
    "an.prevMonth":      tr("Last month", "Прошлый месяц", "Mese scorso", "Mois dernier", "Keçən ay", "Geçen ay", "Минулий місяць", "Өткен ай"),
    "an.monthGoal":      tr("MONTH GOAL", "ЦЕЛЬ НА МЕСЯЦ", "OBIETTIVO MESE", "OBJECTIF DU MOIS", "AYLIQ HƏDƏF", "AYLIK HEDEF", "ЦІЛЬ НА МІСЯЦЬ", "АЙЛЫҚ МАҚСАТ"),
    "an.revenueGoal":    tr("Revenue goal", "Цель выручки", "Obiettivo ricavi", "Objectif de revenu", "Gəlir hədəfi", "Gelir hedefi", "Ціль виручки", "Түсім мақсаты"),
    "an.goalProgress":   tr("{pct}% · {cur} / {goal}", "{pct}% · {cur} / {goal}", "{pct}% · {cur} / {goal}", "{pct}% · {cur} / {goal}", "{pct}% · {cur} / {goal}", "{pct}% · {cur} / {goal}", "{pct}% · {cur} / {goal}", "{pct}% · {cur} / {goal}"),
    "an.onTrack":        tr("On track", "В графике", "In linea", "Dans les temps", "Qrafikdə", "Hedefte", "За графіком", "Кестеде"),
    "an.needPerDay":     tr("need {v}/day", "нужно {v}/день", "serve {v}/giorno", "besoin {v}/jour", "lazım {v}/gün", "gerek {v}/gün", "потрібно {v}/день", "қажет {v}/күн"),
    "an.goalReached":    tr("Goal reached", "Цель достигнута", "Obiettivo raggiunto", "Objectif atteint", "Hədəfə çatıldı", "Hedefe ulaşıldı", "Ціль досягнута", "Мақсатқа жетті"),
    "an.short":          tr("{v} short", "не хватило {v}", "mancano {v}", "il manque {v}", "{v} çatmadı", "{v} eksik", "не вистачило {v}", "{v} жетпеді"),

    // People — статусы задач / приоритеты / роли
    "pe.st.todo":        tr("To do", "К выполнению", "Da fare", "À faire", "Görüləcək", "Yapılacak", "До виконання", "Орындалатын"),
    "pe.st.inprogress":  tr("In progress", "В работе", "In corso", "En cours", "İcrada", "Devam ediyor", "В роботі", "Орындалуда"),
    "pe.st.done":        tr("Done", "Готово", "Fatto", "Terminé", "Hazır", "Tamam", "Готово", "Дайын"),
    "pe.prio.high":      tr("High", "Высокий", "Alta", "Haute", "Yüksək", "Yüksek", "Високий", "Жоғары"),
    "pe.prio.medium":    tr("Medium", "Средний", "Media", "Moyenne", "Orta", "Orta", "Середній", "Орташа"),
    "pe.prio.low":       tr("Low", "Низкий", "Bassa", "Basse", "Aşağı", "Düşük", "Низький", "Төмен"),
    "pe.role.general":   tr("General", "Общий", "Generale", "Général", "Ümumi", "Genel", "Загальний", "Жалпы"),
    "pe.role.kitchen":   tr("Kitchen", "Кухня", "Cucina", "Cuisine", "Mətbəx", "Mutfak", "Кухня", "Ас үй"),
    "pe.role.bar":       tr("Bar", "Бар", "Bar", "Bar", "Bar", "Bar", "Бар", "Бар"),
    "pe.role.hookah":    tr("Hookah", "Кальянная", "Narghilè", "Chicha", "Kəlyan", "Nargile", "Кальянна", "Кальян"),
    "pe.role.waiter":    tr("Hall", "Зал", "Sala", "Salle", "Zal", "Salon", "Зал", "Зал"),
    "pe.role.host":      tr("Host", "Хостес", "Host", "Hôte", "Host", "Host", "Хостес", "Хостес"),
    "pe.role.cleaner":   tr("Cleaning", "Уборка", "Pulizie", "Ménage", "Təmizlik", "Temizlik", "Прибирання", "Тазалау"),

    // People — flash
    "pe.taskNeedTitle":  tr("Enter a title and assignee", "Введите название и исполнителя", "Inserisci titolo e assegnatario", "Saisissez un titre et un assigné", "Başlıq və icraçı daxil edin", "Başlık ve atanan girin", "Введіть назву та виконавця", "Атауы мен орындаушыны енгізіңіз"),
    "pe.noRoleStaff":    tr("No active staff in this role", "Нет активных сотрудников этой роли", "Nessun dipendente attivo per questo ruolo", "Aucun employé actif pour ce rôle", "Bu rolda aktiv işçi yoxdur", "Bu rolde aktif personel yok", "Немає активних співробітників цієї ролі", "Бұл рөлде белсенді қызметкер жоқ"),
    "pe.reportNeedTitle": tr("Enter a title", "Введите заголовок", "Inserisci un titolo", "Saisissez un titre", "Başlıq daxil edin", "Başlık girin", "Введіть заголовок", "Тақырып енгізіңіз"),
    "pe.reportSent":     tr("Request sent", "Заявка отправлена", "Richiesta inviata", "Demande envoyée", "Sorğu göndərildi", "Talep gönderildi", "Заявку надіслано", "Өтініш жіберілді"),
    "pe.pickStaff":      tr("Select an employee", "Выберите сотрудника", "Seleziona un dipendente", "Choisissez un employé", "İşçi seçin", "Personel seçin", "Виберіть співробітника", "Қызметкерді таңдаңыз"),
    "pe.shiftAdded":     tr("Shift added", "Смена добавлена", "Turno aggiunto", "Service ajouté", "Növbə əlavə edildi", "Vardiya eklendi", "Зміну додано", "Ауысым қосылды"),
    "pe.noPrevWeek":     tr("No shifts last week", "На прошлой неделе смен нет", "Nessun turno la settimana scorsa", "Aucun service la semaine dernière", "Keçən həftə növbə yoxdur", "Geçen hafta vardiya yok", "Минулого тижня змін немає", "Өткен аптада ауысым жоқ"),
    "pe.copied":         tr("Copied {n} shifts", "Скопировано смен: {n}", "Copiati {n} turni", "{n} services copiés", "{n} növbə kopyalandı", "{n} vardiya kopyalandı", "Скопійовано змін: {n}", "{n} ауысым көшірілді"),
    "pe.noGeo":          tr("No location access", "Нет доступа к геолокации", "Nessun accesso alla posizione", "Pas d’accès à la localisation", "Məkana giriş yoxdur", "Konum erişimi yok", "Немає доступу до геолокації", "Геолокацияға қол жеткізу жоқ"),
    "pe.outOfZone":      tr("You’re outside the venue", "Вы вне зоны заведения", "Sei fuori dal locale", "Vous êtes hors de l’établissement", "Məkandan kənardasınız", "Mekan dışındasınız", "Ви поза зоною закладу", "Сіз орыннан тыссыз"),
    "pe.checkedIn":      tr("Check-in recorded", "Приход отмечен", "Ingresso registrato", "Arrivée enregistrée", "Gəliş qeyd edildi", "Giriş kaydedildi", "Прихід відмічено", "Келу белгіленді"),
    "pe.swapApproved":   tr("Swap approved", "Обмен одобрен", "Scambio approvato", "Échange approuvé", "Dəyişmə təsdiqləndi", "Takas onaylandı", "Обмін схвалено", "Алмасу мақұлданды"),
    "pe.openShiftFirst": tr("Open a shift in Manager first", "Сначала откройте смену в Manager", "Apri prima un turno in Manager", "Ouvrez d’abord un service dans Manager", "Əvvəlcə Manager-də növbə açın", "Önce Manager’de vardiya açın", "Спочатку відкрийте зміну в Manager", "Алдымен Manager-де ауысым ашыңыз"),
    "pe.addItem":        tr("Add at least one item", "Добавьте хотя бы один пункт", "Aggiungi almeno una voce", "Ajoutez au moins un élément", "Ən azı bir bənd əlavə edin", "En az bir madde ekleyin", "Додайте хоча б один пункт", "Кемінде бір тармақ қосыңыз"),
    "pe.checklistSaved": tr("Checklist saved", "Чек-лист сохранён", "Checklist salvata", "Checklist enregistrée", "Çek-list saxlanıldı", "Kontrol listesi kaydedildi", "Чек-лист збережено", "Чек-парақ сақталды"),
    "pe.needName":       tr("Enter a name", "Введите название", "Inserisci un nome", "Saisissez un nom", "Ad daxil edin", "İsim girin", "Введіть назву", "Атауын енгізіңіз"),
    "pe.saved":          tr("Saved", "Сохранено", "Salvato", "Enregistré", "Saxlanıldı", "Kaydedildi", "Збережено", "Сақталды"),
    "pe.pickShiftPeer":  tr("Pick a shift and a colleague", "Выберите смену и коллегу", "Scegli turno e collega", "Choisissez un service et un collègue", "Növbə və həmkar seçin", "Vardiya ve meslektaş seçin", "Виберіть зміну та колегу", "Ауысым мен әріптесті таңдаңыз"),
    "pe.requestSent":    tr("Request sent", "Запрос отправлен", "Richiesta inviata", "Demande envoyée", "Sorğu göndərildi", "Talep gönderildi", "Запит надіслано", "Сұраныс жіберілді"),
    "pe.taskCreated":    tr("Task created", "Задача создана", "Compito creato", "Tâche créée", "Tapşırıq yaradıldı", "Görev oluşturuldu", "Завдання створено", "Тапсырма құрылды"),
    "pe.taskCreatedN":   tr("Task created for {n}", "Задача создана для {n}", "Compito creato per {n}", "Tâche créée pour {n}", "{n} üçün tapşırıq yaradıldı", "{n} için görev oluşturuldu", "Завдання створено для {n}", "{n} үшін тапсырма құрылды"),

    // People — задачи
    "pe.reports":        tr("Requests", "Заявки", "Richieste", "Demandes", "Sorğular", "Talepler", "Заявки", "Өтініштер"),
    "pe.reportsN":       tr("Requests · {n}", "Заявки · {n}", "Richieste · {n}", "Demandes · {n}", "Sorğular · {n}", "Talepler · {n}", "Заявки · {n}", "Өтініштер · {n}"),
    "pe.newTask":        tr("New task", "Новая задача", "Nuovo compito", "Nouvelle tâche", "Yeni tapşırıq", "Yeni görev", "Нове завдання", "Жаңа тапсырма"),
    "pe.noTasks":        tr("No tasks yet", "Задач пока нет", "Nessun compito", "Aucune tâche", "Hələ tapşırıq yoxdur", "Henüz görev yok", "Завдань поки немає", "Әзірге тапсырма жоқ"),
    "pe.doneN":          tr("DONE · {n}", "ВЫПОЛНЕННОЕ · {n}", "FATTI · {n}", "TERMINÉS · {n}", "GÖRÜLƏNLƏR · {n}", "TAMAMLANAN · {n}", "ВИКОНАНЕ · {n}", "ОРЫНДАЛҒАН · {n}"),
    "pe.fTitle":         tr("Title", "Название", "Titolo", "Titre", "Başlıq", "Başlık", "Назва", "Атауы"),
    "pe.descOptional":   tr("Description (optional)", "Описание (необязательно)", "Descrizione (facoltativa)", "Description (facultatif)", "Təsvir (istəyə bağlı)", "Açıklama (isteğe bağlı)", "Опис (необов’язково)", "Сипаттама (міндетті емес)"),
    "pe.assignee":       tr("To whom", "Кому", "A chi", "À qui", "Kimə", "Kime", "Кому", "Кімге"),
    "pe.roleSection":    tr("By role", "По цеху", "Per ruolo", "Par rôle", "Rol üzrə", "Role göre", "За цехом", "Цех бойынша"),
    "pe.staffSection":   tr("Individual", "Сотрудник", "Individuale", "Individuel", "Fərdi", "Bireysel", "Окремо", "Жеке"),
    "pe.allRole":        tr("whole dept.", "весь цех", "tutto rep.", "tout le dept.", "bütün şöbə", "tüm departman", "весь цех", "барлық бөлім"),
    "pe.assigneeSection": tr("Assignee", "Исполнитель", "Assegnatario", "Assigné", "İcraçı", "Atanan", "Виконавець", "Орындаушы"),
    "pe.priority":       tr("Priority", "Приоритет", "Priorità", "Priorité", "Prioritet", "Öncelik", "Пріоритет", "Басымдық"),
    "pe.newTaskTitle":   tr("New task", "Новая задача", "Nuovo compito", "Nouvelle tâche", "Yeni tapşırıq", "Yeni görev", "Нове завдання", "Жаңа тапсырма"),
    "pe.toWork":         tr("Start", "В работу", "Avvia", "Démarrer", "İşə", "Başlat", "В роботу", "Жұмысқа"),
    "pe.return":         tr("Return", "Вернуть", "Ripristina", "Rétablir", "Qaytar", "Geri al", "Повернути", "Қайтару"),

    // People — заявки
    "pe.newReport":      tr("New request", "Новая заявка", "Nuova richiesta", "Nouvelle demande", "Yeni sorğu", "Yeni talep", "Нова заявка", "Жаңа өтініш"),
    "pe.noReports":      tr("No requests yet", "Заявок пока нет", "Nessuna richiesta", "Aucune demande", "Hələ sorğu yoxdur", "Henüz talep yok", "Заявок поки немає", "Әзірге өтініш жоқ"),
    "pe.noReportsMine":  tr("You haven’t sent any requests", "Вы ещё не отправляли заявок", "Non hai inviato richieste", "Vous n’avez envoyé aucune demande", "Hələ sorğu göndərməmisiniz", "Henüz talep göndermediniz", "Ви ще не надсилали заявок", "Сіз әлі өтініш жібермедіңіз"),
    "pe.reviewed":       tr("Reviewed", "Просмотрено", "Visto", "Vu", "Baxıldı", "İncelendi", "Переглянуто", "Қаралды"),
    "pe.resolved":       tr("Resolved", "Решено", "Risolto", "Résolu", "Həll edildi", "Çözüldü", "Вирішено", "Шешілді"),
    "pe.repNew":         tr("New", "Новая", "Nuova", "Nouvelle", "Yeni", "Yeni", "Нова", "Жаңа"),
    "pe.repShort":       tr("Briefly", "Кратко", "In breve", "En bref", "Qısa", "Kısaca", "Коротко", "Қысқаша"),
    "pe.detailsOptional": tr("Details (optional)", "Подробности (необязательно)", "Dettagli (facoltativi)", "Détails (facultatif)", "Təfərrüat (istəyə bağlı)", "Ayrıntılar (isteğe bağlı)", "Деталі (необов’язково)", "Толығырақ (міндетті емес)"),
    "pe.reportToManager": tr("Request to manager", "Заявка менеджеру", "Richiesta al manager", "Demande au manager", "Menecerə sorğu", "Yöneticiye talep", "Заявка менеджеру", "Менеджерге өтініш"),
    "pe.type":           tr("Type", "Тип", "Tipo", "Type", "Növ", "Tür", "Тип", "Түрі"),
    "pe.rt.suggestion":  tr("Suggestion", "Предложение", "Suggerimento", "Suggestion", "Təklif", "Öneri", "Пропозиція", "Ұсыныс"),
    "pe.rt.order":       tr("Order", "Заказать", "Ordinare", "Commander", "Sifariş", "Sipariş", "Замовити", "Тапсырыс"),
    "pe.rt.breakdown":   tr("Breakdown", "Поломка", "Guasto", "Panne", "Nasazlıq", "Arıza", "Поломка", "Ақаулық"),
    "pe.rt.other":       tr("Other", "Другое", "Altro", "Autre", "Digər", "Diğer", "Інше", "Басқа"),

    // People — зарплата
    "pe.noSalary":       tr("No salary data", "Нет данных по зарплате", "Nessun dato sullo stipendio", "Aucune donnée de salaire", "Maaş məlumatı yoxdur", "Maaş verisi yok", "Немає даних по зарплаті", "Жалақы деректері жоқ"),
    "pe.toPay":          tr("To pay", "К выплате", "Da pagare", "À payer", "Ödəniləcək", "Ödenecek", "До виплати", "Төленеді"),
    "pe.cardShort":      tr("card", "карта", "carta", "carte", "kart", "kart", "картка", "карта"),

    // People — смены / явка / обмены
    "pe.swaps":          tr("Swaps", "Обмены", "Scambi", "Échanges", "Dəyişmələr", "Takaslar", "Обміни", "Алмасулар"),
    "pe.onShift":        tr("You’re on shift", "Вы на смене", "Sei in turno", "Vous êtes en service", "Növbədəsiniz", "Vardiyadasınız", "Ви на зміні", "Сіз ауысымдасыз"),
    "pe.arrivedAt":      tr("Arrived at {t}", "Приход в {t}", "Arrivo alle {t}", "Arrivée à {t}", "Gəliş {t}", "Giriş {t}", "Прихід о {t}", "Келу {t}"),
    "pe.lateMin":        tr("Late +{n} min", "Опоздание +{n} мин", "Ritardo +{n} min", "Retard +{n} min", "Gecikmə +{n} dəq", "Gecikme +{n} dk", "Запізнення +{n} хв", "Кешігу +{n} мин"),
    "pe.iCame":          tr("I’m here", "Я пришёл", "Sono arrivato", "Je suis arrivé", "Gəldim", "Geldim", "Я прийшов", "Мен келдім"),
    "pe.historyCaps":    tr("HISTORY", "ИСТОРИЯ", "CRONOLOGIA", "HISTORIQUE", "TARİXÇƏ", "GEÇMİŞ", "ІСТОРІЯ", "ТАРИХ"),
    "pe.todayCaps":      tr("TODAY", "СЕГОДНЯ", "OGGI", "AUJOURD’HUI", "BU GÜN", "BUGÜN", "СЬОГОДНІ", "БҮГІН"),
    "pe.notCame":        tr("absent", "не пришёл", "assente", "absent", "gəlmədi", "gelmedi", "не прийшов", "келмеді"),
    "pe.onTime":         tr("On time", "Вовремя", "In orario", "À l’heure", "Vaxtında", "Zamanında", "Вчасно", "Уақытында"),
    "pe.lateBadge":      tr("+{n}m", "+{n}м", "+{n}m", "+{n}m", "+{n}d", "+{n}d", "+{n}х", "+{n}м"),
    "pe.proposeSwap":    tr("Propose swap", "Предложить обмен", "Proponi scambio", "Proposer un échange", "Dəyişmə təklif et", "Takas öner", "Запропонувати обмін", "Алмасу ұсыну"),
    "pe.toApprove":      tr("To approve", "На утверждение", "Da approvare", "À approuver", "Təsdiq üçün", "Onay için", "На затвердження", "Бекітуге"),
    "pe.incoming":       tr("Incoming", "Входящие", "In arrivo", "Entrants", "Gələn", "Gelen", "Вхідні", "Кіріс"),
    "pe.all":            tr("All", "Все", "Tutti", "Tous", "Hamısı", "Tümü", "Усі", "Барлығы"),
    "pe.outgoing":       tr("Outgoing", "Исходящие", "In uscita", "Sortants", "Gedən", "Giden", "Вихідні", "Шығыс"),
    "pe.noSwaps":        tr("No swap requests", "Запросов на обмен нет", "Nessuna richiesta di scambio", "Aucune demande d’échange", "Dəyişmə sorğusu yoxdur", "Takas talebi yok", "Запитів на обмін немає", "Алмасу сұранысы жоқ"),
    "pe.accept":         tr("Accept", "Принять", "Accetta", "Accepter", "Qəbul et", "Kabul et", "Прийняти", "Қабылдау"),
    "pe.declineBtn":     tr("Decline", "Отклонить", "Rifiuta", "Refuser", "Rədd et", "Reddet", "Відхилити", "Бас тарту"),
    "pe.cancelReq":      tr("Cancel request", "Отменить запрос", "Annulla richiesta", "Annuler la demande", "Sorğunu ləğv et", "Talebi iptal et", "Скасувати запит", "Сұранысты болдырмау"),
    "pe.approve":        tr("Approve", "Одобрить", "Approva", "Approuver", "Təsdiqlə", "Onayla", "Схвалити", "Мақұлдау"),
    "pe.swap.pendingPeer": tr("Awaiting colleague", "Ждёт коллегу", "In attesa del collega", "En attente du collègue", "Həmkarı gözləyir", "Meslektaşı bekliyor", "Чекає колегу", "Әріптесті күтуде"),
    "pe.swap.peerAccepted": tr("Awaiting manager", "Ждёт менеджера", "In attesa del manager", "En attente du manager", "Meneceri gözləyir", "Yöneticiyi bekliyor", "Чекає менеджера", "Менеджерді күтуде"),
    "pe.swap.approved":  tr("Approved", "Одобрено", "Approvato", "Approuvé", "Təsdiqləndi", "Onaylandı", "Схвалено", "Мақұлданды"),
    "pe.swap.rejected":  tr("Declined", "Отклонено", "Rifiutato", "Refusé", "Rədd edildi", "Reddedildi", "Відхилено", "Қабылданбады"),
    "pe.swap.cancelled": tr("Cancelled", "Отменено", "Annullato", "Annulé", "Ləğv edildi", "İptal edildi", "Скасовано", "Болдырылмады"),
    "pe.myShift":        tr("My shift", "Моя смена", "Il mio turno", "Mon service", "Mənim növbəm", "Vardiyam", "Моя зміна", "Менің ауысымым"),
    "pe.shiftWord":      tr("Shift", "Смена", "Turno", "Service", "Növbə", "Vardiya", "Зміна", "Ауысым"),
    "pe.toWhom":         tr("Offer to", "Кому предложить", "Offri a", "Proposer à", "Kimə təklif", "Kime öner", "Кому запропонувати", "Кімге ұсыну"),
    "pe.colleague":      tr("Colleague", "Коллега", "Collega", "Collègue", "Həmkar", "Meslektaş", "Колега", "Әріптес"),
    "pe.comment":        tr("Comment", "Комментарий", "Commento", "Commentaire", "Şərh", "Yorum", "Коментар", "Пікір"),
    "pe.optional":       tr("Optional", "Необязательно", "Facoltativo", "Facultatif", "İstəyə bağlı", "İsteğe bağlı", "Необов’язково", "Міндетті емес"),

    // People — график
    "pe.addShift":       tr("Add shift", "Добавить смену", "Aggiungi turno", "Ajouter un service", "Növbə əlavə et", "Vardiya ekle", "Додати зміну", "Ауысым қосу"),
    "pe.lastWeek":       tr("Last week", "Прошлая неделя", "Settimana scorsa", "Semaine dernière", "Keçən həftə", "Geçen hafta", "Минулий тиждень", "Өткен апта"),
    "pe.who":            tr("Who", "Кто", "Chi", "Qui", "Kim", "Kim", "Хто", "Кім"),
    "pe.start":          tr("Start", "Начало", "Inizio", "Début", "Başlanğıc", "Başlangıç", "Початок", "Басы"),
    "pe.end":            tr("End", "Конец", "Fine", "Fin", "Son", "Bitiş", "Кінець", "Соңы"),
    "pe.newShift":       tr("New shift", "Новая смена", "Nuovo turno", "Nouveau service", "Yeni növbə", "Yeni vardiya", "Нова зміна", "Жаңа ауысым"),
    "pe.scheduleEmptyMgr": tr("No schedule this month", "Расписание на этот месяц пустое", "Nessun programma questo mese", "Aucun planning ce mois-ci", "Bu ay qrafik yoxdur", "Bu ay program yok", "Розклад на цей місяць порожній", "Осы айда кесте жоқ"),
    "pe.scheduleEmptyStaff": tr("You have no shifts this month", "У вас нет смен в этом месяце", "Non hai turni questo mese", "Vous n’avez aucun service ce mois-ci", "Bu ay növbəniz yoxdur", "Bu ay vardiyanız yok", "У вас немає змін цього місяця", "Бұл айда ауысымыңыз жоқ"),

    // People — зал / стоп / заказы / чек-листы / техкарты
    "pe.stop":           tr("Stop", "Стоп", "Stop", "Stop", "Stop", "Stop", "Стоп", "Стоп"),
    "pe.orders":         tr("Orders", "Заказы", "Ordini", "Commandes", "Sifarişlər", "Siparişler", "Замовлення", "Тапсырыстар"),
    "pe.ordersN":        tr("Orders · {n}", "Заказы · {n}", "Ordini · {n}", "Commandes · {n}", "Sifarişlər · {n}", "Siparişler · {n}", "Замовлення · {n}", "Тапсырыстар · {n}"),
    "pe.checklists":     tr("Checklists", "Чек-листы", "Checklist", "Checklists", "Çek-listlər", "Kontrol listeleri", "Чек-листи", "Чек-парақтар"),
    "pe.techcards":      tr("Tech cards", "Техкарты", "Schede tecniche", "Fiches techniques", "Texnoloji kartlar", "Teknik kartlar", "Техкарти", "Техкарталар"),
    "pe.open":           tr("Opening", "Открытие", "Apertura", "Ouverture", "Açılış", "Açılış", "Відкриття", "Ашылу"),
    "pe.close":          tr("Closing", "Закрытие", "Chiusura", "Fermeture", "Bağlanış", "Kapanış", "Закриття", "Жабылу"),
    "pe.noChecklists":   tr("No checklists set", "Чек-листы не заданы", "Nessuna checklist", "Aucune checklist", "Çek-list təyin edilməyib", "Kontrol listesi yok", "Чек-листи не задані", "Чек-парақтар белгіленбеген"),
    "pe.checklistForRole": tr("Checklist for a section", "Чек-лист для цеха", "Checklist per reparto", "Checklist par poste", "Sahə üçün çek-list", "Bölüm için liste", "Чек-лист для цеху", "Цех үшін чек-парақ"),
    "pe.checklistHistory": tr("Checklist history", "История чек-листов", "Cronologia checklist", "Historique des checklists", "Çek-list tarixçəsi", "Liste geçmişi", "Історія чек-листів", "Чек-парақ тарихы"),
    "pe.checklistNoShiftHint": tr("Open a shift in Manager to run the checklist", "Откройте смену в Manager, чтобы вести чек-лист", "Apri un turno in Manager per la checklist", "Ouvrez un service dans Manager pour la checklist", "Çek-list üçün Manager-də növbə açın", "Liste için Manager’de vardiya açın", "Відкрийте зміну в Manager, щоб вести чек-лист", "Чек-парақ үшін Manager-де ауысым ашыңыз"),
    "pe.readyCaps":      tr("DONE", "ГОТОВО", "FATTO", "FAIT", "HAZIR", "HAZIR", "ГОТОВО", "ДАЙЫН"),
    "pe.workshop":       tr("Section", "Цех", "Reparto", "Poste", "Sahə", "Bölüm", "Цех", "Цех"),
    "pe.items":          tr("Items", "Пункты", "Voci", "Éléments", "Bəndlər", "Maddeler", "Пункти", "Тармақтар"),
    "pe.itemN":          tr("Item {n}", "Пункт {n}", "Voce {n}", "Élément {n}", "Bənd {n}", "Madde {n}", "Пункт {n}", "Тармақ {n}"),
    "pe.moreItem":       tr("Another item", "Ещё пункт", "Altra voce", "Un autre élément", "Daha bir bənd", "Bir madde daha", "Ще пункт", "Тағы тармақ"),
    "pe.checklistOpenTitle": tr("Opening checklist", "Чек-лист открытия", "Checklist di apertura", "Checklist d’ouverture", "Açılış çek-listi", "Açılış listesi", "Чек-лист відкриття", "Ашылу чек-парағы"),
    "pe.checklistCloseTitle": tr("Closing checklist", "Чек-лист закрытия", "Checklist di chiusura", "Checklist de fermeture", "Bağlanış çek-listi", "Kapanış listesi", "Чек-лист закриття", "Жабылу чек-парағы"),
    "pe.historyEmpty":   tr("History is empty", "История пуста", "Cronologia vuota", "Historique vide", "Tarixçə boşdur", "Geçmiş boş", "Історія порожня", "Тарих бос"),
    "pe.allDone":        tr("All done", "Всё выполнено", "Tutto fatto", "Tout est fait", "Hamısı edildi", "Hepsi tamam", "Усе виконано", "Бәрі орындалды"),
    "pe.newTech":        tr("New tech card", "Новая техкарта", "Nuova scheda", "Nouvelle fiche", "Yeni kart", "Yeni kart", "Нова техкарта", "Жаңа техкарта"),
    "pe.noTech":         tr("No tech cards yet", "Техкарт пока нет", "Nessuna scheda", "Aucune fiche", "Hələ kart yoxdur", "Henüz kart yok", "Техкарт поки немає", "Әзірге техкарта жоқ"),
    "pe.stepsCount":     tr("{n} steps", "{n} шагов", "{n} passi", "{n} étapes", "{n} addım", "{n} adım", "{n} кроків", "{n} қадам"),
    "pe.tc.dish":        tr("Dish", "Блюдо", "Piatto", "Plat", "Yemək", "Yemek", "Страва", "Тағам"),
    "pe.tc.prep":        tr("Prep", "Заготовка", "Preparazione", "Préparation", "Hazırlıq", "Hazırlık", "Заготовка", "Дайындама"),
    "pe.tc.other":       tr("Other", "Другое", "Altro", "Autre", "Digər", "Diğer", "Інше", "Басқа"),
    "pe.techName":       tr("Name", "Название", "Nome", "Nom", "Ad", "İsim", "Назва", "Атауы"),
    "pe.steps":          tr("Steps", "Шаги", "Passi", "Étapes", "Addımlar", "Adımlar", "Кроки", "Қадамдар"),
    "pe.stepN":          tr("Step {n}", "Шаг {n}", "Passo {n}", "Étape {n}", "Addım {n}", "Adım {n}", "Крок {n}", "Қадам {n}"),
    "pe.moreStep":       tr("Another step", "Ещё шаг", "Altro passo", "Une autre étape", "Daha bir addım", "Bir adım daha", "Ще крок", "Тағы қадам"),
    "pe.techTitle":      tr("Tech card", "Техкарта", "Scheda tecnica", "Fiche technique", "Texnoloji kart", "Teknik kart", "Техкарта", "Техкарта"),
    "pe.active":         tr("Active", "Активные", "Attivi", "Actives", "Aktiv", "Aktif", "Активні", "Белсенді"),
    "pe.activeN":        tr("Active · {n}", "Активные · {n}", "Attivi · {n}", "Actives · {n}", "Aktiv · {n}", "Aktif · {n}", "Активні · {n}", "Белсенді · {n}"),
    "pe.finished":       tr("Finished", "Завершённые", "Completati", "Terminées", "Bitmiş", "Tamamlanan", "Завершені", "Аяқталған"),
    "pe.noActive":       tr("No active orders", "Активных заказов нет", "Nessun ordine attivo", "Aucune commande active", "Aktiv sifariş yoxdur", "Aktif sipariş yok", "Активних замовлень немає", "Белсенді тапсырыс жоқ"),
    "pe.callWaiter":     tr("Calling a waiter", "Зовут официанта", "Chiamano un cameriere", "Appel d’un serveur", "Ofisiant çağırırlar", "Garson çağrılıyor", "Кличуть офіціанта", "Даяшы шақыруда"),
    "pe.tableN":         tr("Table {n}", "Стол {n}", "Tavolo {n}", "Table {n}", "Masa {n}", "Masa {n}", "Стіл {n}", "Үстел {n}"),
    "pe.coming":         tr("On my way", "Иду", "Arrivo", "J’arrive", "Gəlirəm", "Geliyorum", "Іду", "Барамын"),
    "pe.cooking":        tr("Cooking", "Готовим", "In preparazione", "En préparation", "Hazırlanır", "Hazırlanıyor", "Готуємо", "Дайындаудамыз"),
    "pe.readyBtn":       tr("Ready", "Готово", "Pronto", "Prêt", "Hazır", "Hazır", "Готово", "Дайын"),
    "pe.order.new":      tr("New", "Новый", "Nuovo", "Nouveau", "Yeni", "Yeni", "Новий", "Жаңа"),
    "pe.order.inProgress": tr("Cooking", "Готовится", "In preparazione", "En cours", "Hazırlanır", "Hazırlanıyor", "Готується", "Дайындалуда"),
    "pe.order.done":     tr("Ready", "Готов", "Pronto", "Prêt", "Hazır", "Hazır", "Готовий", "Дайын"),
    "pe.order.cancelled": tr("Cancelled", "Отменён", "Annullato", "Annulé", "Ləğv edildi", "İptal edildi", "Скасований", "Болдырылмады"),
    "pe.menuEmpty":      tr("Menu is empty", "Меню пустое", "Menu vuoto", "Menu vide", "Menyu boşdur", "Menü boş", "Меню порожнє", "Мәзір бос"),
    "pe.stopList":       tr("STOP LIST", "СТОП-ЛИСТ", "STOP LIST", "STOP LIST", "STOP-LİST", "STOP LİSTE", "СТОП-ЛИСТ", "СТОП-ПАРАҚ"),
    "pe.inStopN":        tr("{n} in stop", "{n} в стопе", "{n} in stop", "{n} en stop", "{n} stopda", "{n} stopta", "{n} у стопі", "{n} стопта"),
    "pe.inMenu":         tr("On menu", "В меню", "Nel menu", "Au menu", "Menyuda", "Menüde", "У меню", "Мәзірде"),
    "pe.inStop":         tr("In stop", "В стопе", "In stop", "En stop", "Stopda", "Stopta", "У стопі", "Стопта"),
    "pe.due":            tr("Due date", "Срок", "Scadenza", "Échéance", "Son tarix", "Son tarih", "Термін", "Мерзім"),
    "pe.deductN":        tr("Deduction ({n})", "Вычет ({n})", "Detrazione ({n})", "Retenue ({n})", "Tutulma ({n})", "Kesinti ({n})", "Відрахування ({n})", "Шегерім ({n})"),
    "pe.staffOne":       tr("Employee", "Сотрудник", "Dipendente", "Employé", "İşçi", "Personel", "Співробітник", "Қызметкер"),
    "pe.time":           tr("Time", "Время", "Ora", "Heure", "Vaxt", "Saat", "Час", "Уақыт"),
    "pe.note":           tr("Note", "Заметка", "Nota", "Note", "Qeyd", "Not", "Нотатка", "Жазба"),

    // Общее (доп.)
    "back":              tr("Back", "Назад", "Indietro", "Retour", "Geri", "Geri", "Назад", "Артқа"),

    // Онбординг — плавающие фичи + экраны
    "ob.feat1":          tr("Shifts & cash", "Смены и касса", "Turni e cassa", "Services et caisse", "Növbə və kassa", "Vardiya ve kasa", "Зміни та каса", "Ауысым және касса"),
    "ob.feat2":          tr("Real-time revenue", "Выручка в реальном времени", "Ricavi in tempo reale", "Revenus en temps réel", "Real vaxtda gəlir", "Gerçek zamanlı gelir", "Виручка в реальному часі", "Нақты уақыттағы түсім"),
    "ob.feat3":          tr("Stock control", "Контроль склада", "Controllo stock", "Gestion du stock", "Anbar nəzarəti", "Stok kontrolü", "Контроль складу", "Қойма бақылауы"),
    "ob.feat4":          tr("Team schedule", "Расписание команды", "Turni del team", "Planning d’équipe", "Komanda qrafiki", "Ekip programı", "Розклад команди", "Команда кестесі"),
    "ob.feat5":          tr("Payroll without spreadsheets", "Зарплаты без таблиц", "Stipendi senza fogli", "Salaires sans tableurs", "Cədvəlsiz maaş", "Tablosuz maaş", "Зарплати без таблиць", "Кестесіз жалақы"),
    "ob.feat6":          tr("QR menu", "QR-меню", "Menu QR", "Menu QR", "QR-menyu", "QR menü", "QR-меню", "QR-мәзір"),
    "ob.feat7":          tr("Inventory", "Инвентаризация", "Inventario", "Inventaire", "İnventarizasiya", "Envanter", "Інвентаризація", "Түгендеу"),
    "ob.feat8":          tr("Lounge sessions", "Сессии лаунжа", "Sessioni lounge", "Sessions lounge", "Launc sessiyaları", "Lounge seansları", "Сесії лаунжу", "Лаунж сеанстары"),
    "ob.scanTitle":      tr("Scan the venue QR", "Отсканируйте QR заведения", "Scansiona il QR del locale", "Scannez le QR de l’établissement", "Məkanın QR-ını skan edin", "Mekan QR’ını tarayın", "Відскануйте QR закладу", "Орынның QR кодын сканерлеңіз"),
    "ob.scanHint":       tr("The owner shows your personal QR in the Mise dashboard, “Access” section.", "Индивидуальный QR-код вам покажет владелец — в дашборде Mise, раздел «Доступ».", "Il proprietario mostra il tuo QR personale nella dashboard Mise, sezione “Accesso”.", "Le propriétaire montre votre QR personnel dans le tableau de bord Mise, section « Accès ».", "Şəxsi QR-ı sahib Mise idarə panelində, «Giriş» bölməsində göstərir.", "Kişisel QR’ınızı sahibi Mise panosunda “Erişim” bölümünde gösterir.", "Власник покаже ваш персональний QR у дашборді Mise, розділ «Доступ».", "Жеке QR-ды иесі Mise дашбордында, «Қол жеткізу» бөлімінде көрсетеді."),
    "ob.qrInvalid":      tr("Not a Mise QR code. Try again.", "Неверный QR Mise. Попробуйте снова.", "QR Mise non valido. Riprova.", "QR Mise invalide. Réessayez.", "Yanlış Mise QR-ı. Yenidən cəhd edin.", "Geçersiz Mise QR’ı. Tekrar deneyin.", "Невірний QR Mise. Спробуйте ще раз.", "Жарамсыз Mise QR-ы. Қайта көріңіз."),
    "ob.noCamera":       tr("No camera access. Allow it in Settings → Mise → Camera.", "Нет доступа к камере. Разрешите его в Настройках → Mise → Камера.", "Nessun accesso alla fotocamera. Consentilo in Impostazioni → Mise → Fotocamera.", "Pas d’accès à la caméra. Autorisez-le dans Réglages → Mise → Caméra.", "Kameraya giriş yoxdur. Tənzimləmələr → Mise → Kamera-da icazə verin.", "Kamera erişimi yok. Ayarlar → Mise → Kamera’dan izin verin.", "Немає доступу до камери. Дозвольте в Налаштування → Mise → Камера.", "Камераға қол жеткізу жоқ. Параметрлер → Mise → Камера ішінде рұқсат етіңіз."),
    "ob.faceTitle":      tr("Face ID login", "Вход по Face ID", "Accesso con Face ID", "Connexion Face ID", "Face ID ilə giriş", "Face ID ile giriş", "Вхід через Face ID", "Face ID арқылы кіру"),
    "ob.faceDesc":       tr("Next login — instant and secure, no PIN.", "Следующий вход — без ввода PIN, мгновенно и безопасно.", "Prossimo accesso — istantaneo e sicuro, senza PIN.", "Prochaine connexion — instantanée et sûre, sans PIN.", "Növbəti giriş — PIN-siz, ani və təhlükəsiz.", "Sonraki giriş — PIN’siz, anında ve güvenli.", "Наступний вхід — без PIN, миттєво й безпечно.", "Келесі кіру — PIN-сіз, жылдам әрі қауіпсіз."),
    "ob.faceCta":        tr("Enable Face ID", "Включить Face ID", "Attiva Face ID", "Activer Face ID", "Face ID-ni aktiv et", "Face ID’yi aç", "Увімкнути Face ID", "Face ID қосу"),
    "ob.notifTitle":     tr("Notifications", "Уведомления", "Notifiche", "Notifications", "Bildirişlər", "Bildirimler", "Сповіщення", "Хабарламалар"),
    "ob.notifDesc":      tr("New orders, low stock, shift end — on time.", "Новые заказы, заканчивается остаток, конец смены — вовремя.", "Nuovi ordini, scorte in esaurimento, fine turno — in tempo.", "Nouvelles commandes, stock bas, fin de service — à temps.", "Yeni sifarişlər, stok azalır, növbə sonu — vaxtında.", "Yeni siparişler, stok azalıyor, vardiya sonu — zamanında.", "Нові замовлення, запаси закінчуються, кінець зміни — вчасно.", "Жаңа тапсырыстар, қор азайды, ауысым соңы — уақытында."),
    "ob.notifCta":       tr("Allow notifications", "Разрешить уведомления", "Consenti notifiche", "Autoriser les notifications", "Bildirişlərə icazə ver", "Bildirimlere izin ver", "Дозволити сповіщення", "Хабарламаларға рұқсат"),
    "ob.geoTitle":       tr("Location", "Геолокация", "Posizione", "Localisation", "Məkan", "Konum", "Геолокація", "Геолокация"),
    "ob.geoDesc":        tr("Check-in uses your location only when you tap the button to confirm arrival. No background tracking — you can always skip and mark manually.", "Геолокация используется только при нажатии кнопки явки. Фоновое отслеживание не ведётся — можно пропустить и отмечаться вручную.", "Usata solo quando tocchi il pulsante per confermare l'arrivo. Nessun tracciamento in background — puoi saltare e fare il check-in manualmente.", "Utilisée uniquement quand vous tapez le bouton d'arrivée. Pas de suivi en arrière-plan — vous pouvez ignorer et pointer manuellement.", "Yalnız gəliş düyməsinə basanda aktivəşir. Arxa planda izləmə yoxdur — əl ilə qeyd etmək üçün keçin.", "Yalnızca varış düğmesine basarken kullanılır. Arka plan takibi yok — atlayip elle giriş yapabilirsiniz.", "Використовується лише при натисканні кнопки явки. Фонового відстеження немає — можна пропустити та відмічатись вручну.", "Тек келу батырмасын басқанда іске қосылады. Фондық бақылау жоқ — өткізіп жіберіп, қолмен белгілеуге болады."),
    "ob.geoCta":         tr("Continue", "Продолжить", "Continua", "Continuer", "Davam et", "Devam et", "Продовжити", "Жалғастыру"),
    "ob.notNow":         tr("Not now", "Не сейчас", "Non ora", "Pas maintenant", "İndi yox", "Şimdi değil", "Не зараз", "Қазір емес"),
    "comingSoon":        tr("This module is coming to the native app soon", "Модуль скоро появится в нативной версии", "Questo modulo arriverà presto nell’app nativa", "Ce module arrive bientôt dans l’app native", "Bu modul tezliklə tətbiqdə olacaq", "Bu modül yakında uygulamada", "Модуль скоро з’явиться в застосунку", "Бұл модуль жақында қолданбада"),
    "st.totalStock":     tr("Total in stock", "Всего на складе", "Totale in magazzino", "Total en stock", "Anbarda cəmi", "Stokta toplam", "Усього на складі", "Қоймада барлығы"),
    "pe.pickDates":      tr("Select dates", "Выберите даты", "Seleziona le date", "Choisissez les dates", "Tarixləri seçin", "Tarihleri seçin", "Виберіть дати", "Күндерді таңдаңыз"),
    "pe.dates":          tr("Dates", "Даты", "Date", "Dates", "Tarixlər", "Tarihler", "Дати", "Күндер"),
    "pe.datesN":         tr("Selected: {n}", "Выбрано: {n}", "Selezionati: {n}", "Sélectionnés : {n}", "Seçildi: {n}", "Seçildi: {n}", "Вибрано: {n}", "Таңдалды: {n}"),

    // Bookings & News — подписи модулей
    "mod.bookings.sub":   tr("Table bookings", "Брони столов", "Prenotazioni tavoli", "Réservations", "Masa rezervləri", "Masa rezervasyonları", "Броні столів", "Үстел брондары"),
    "mod.news.sub":       tr("Feed & announcements", "Лента и объявления", "Feed e annunci", "Fil & annonces", "Lent və elanlar", "Akış ve duyurular", "Стрічка та оголошення", "Таспа және хабарландырулар"),

    // Bookings
    "bk.stNew":           tr("New", "Новая", "Nuova", "Nouvelle", "Yeni", "Yeni", "Нова", "Жаңа"),
    "bk.stNone":          tr("No status", "Без статуса", "Senza stato", "Sans statut", "Statussuz", "Durumsuz", "Без статусу", "Статуссыз"),
    "bk.stConfirmed":     tr("Confirmed", "Подтверждена", "Confermata", "Confirmée", "Təsdiqləndi", "Onaylandı", "Підтверджена", "Расталды"),
    "bk.stCancelled":     tr("Cancelled", "Отменена", "Annullata", "Annulée", "Ləğv edildi", "İptal", "Скасована", "Бас тартылды"),
    "bk.stArrived":       tr("Arrived", "Пришёл", "Arrivato", "Arrivé", "Gəldi", "Geldi", "Прийшов", "Келді"),
    "bk.stLate":          tr("Late", "Опаздывает", "In ritardo", "En retard", "Gecikir", "Gecikiyor", "Запізнюється", "Кешігеді"),
    "bk.empty":           tr("No bookings", "Нет броней", "Nessuna prenotazione", "Aucune réservation", "Rezerv yoxdur", "Rezervasyon yok", "Немає броней", "Брон жоқ"),
    "bk.emptyHint":       tr("Tap + to add a booking for this day", "Нажмите +, чтобы добавить бронь на этот день", "Tocca + per aggiungere una prenotazione", "Touchez + pour ajouter une réservation", "Bu gün üçün rezerv əlavə edin", "Bu gün için rezervasyon ekleyin", "Натисніть +, щоб додати бронь на цей день", "Осы күнге брон қосу үшін + басыңыз"),
    "bk.noName":          tr("Guest", "Гость", "Ospite", "Invité", "Qonaq", "Misafir", "Гість", "Қонақ"),
    "bk.new":             tr("New booking", "Новая бронь", "Nuova prenotazione", "Nouvelle réservation", "Yeni rezerv", "Yeni rezervasyon", "Нова бронь", "Жаңа брон"),
    "bk.edit":            tr("Edit booking", "Редактировать", "Modifica", "Modifier", "Düzəliş", "Düzenle", "Редагувати", "Өзгерту"),
    "bk.save":            tr("Save", "Сохранить", "Salva", "Enregistrer", "Yadda saxla", "Kaydet", "Зберегти", "Сақтау"),
    "bk.secGuest":        tr("Guest", "Гость", "Ospite", "Invité", "Qonaq", "Misafir", "Гість", "Қонақ"),
    "bk.name":            tr("Name", "Имя", "Nome", "Nom", "Ad", "Ad", "Ім'я", "Аты"),
    "bk.phone":           tr("Phone", "Телефон", "Telefono", "Téléphone", "Telefon", "Telefon", "Телефон", "Телефон"),
    "bk.guests":          tr("Guests", "Гостей", "Ospiti", "Personnes", "Qonaq sayı", "Kişi", "Гостей", "Қонақтар"),
    "bk.secBooking":      tr("Booking", "Бронь", "Prenotazione", "Réservation", "Rezerv", "Rezervasyon", "Бронь", "Брон"),
    "bk.setTime":         tr("Set time", "Указать время", "Imposta orario", "Définir l'heure", "Vaxtı təyin et", "Saat belirle", "Вказати час", "Уақытты көрсету"),
    "bk.time":            tr("Time", "Время", "Orario", "Heure", "Vaxt", "Saat", "Час", "Уақыт"),
    "bk.table":           tr("Table", "Стол", "Tavolo", "Table", "Masa", "Masa", "Стіл", "Үстел"),
    "bk.status":          tr("Status", "Статус", "Stato", "Statut", "Status", "Durum", "Статус", "Күй"),
    "bk.note":            tr("Comment", "Комментарий", "Commento", "Commentaire", "Şərh", "Yorum", "Коментар", "Пікір"),
    "bk.notePh":          tr("Comment…", "Комментарий…", "Commento…", "Commentaire…", "Şərh…", "Yorum…", "Коментар…", "Пікір…"),
    "bk.delete":          tr("Delete booking", "Удалить бронь", "Elimina prenotazione", "Supprimer", "Rezervi sil", "Rezervasyonu sil", "Видалити бронь", "Бронды жою"),

    // News
    "nw.kInfo":           tr("Info", "Информация", "Info", "Info", "Məlumat", "Bilgi", "Інформація", "Ақпарат"),
    "nw.kStop":           tr("Stop-list", "Стоп-лист", "Stop-list", "Rupture", "Stop-list", "Stop-list", "Стоп-лист", "Стоп-тізім"),
    "nw.kPromo":          tr("Promo", "Акция", "Promo", "Promo", "Aksiya", "Kampanya", "Акція", "Акция"),
    "nw.kUpdate":         tr("Update", "Нововведение", "Novità", "Nouveauté", "Yenilik", "Yenilik", "Нововведення", "Жаңалық"),
    "nw.empty":           tr("No news yet", "Пока нет новостей", "Ancora nessuna novità", "Pas encore d'actualités", "Hələ xəbər yoxdur", "Henüz haber yok", "Поки немає новин", "Әзірге жаңалық жоқ"),
    "nw.emptyHint":       tr("Announcements from managers appear here", "Здесь появятся объявления руководства", "Qui appariranno gli annunci", "Les annonces apparaîtront ici", "Rəhbərliyin elanları burada görünəcək", "Yönetim duyuruları burada görünür", "Тут з'являться оголошення керівництва", "Басшылық хабарландырулары осында шығады"),
    "nw.emptyHintManager": tr("Tap to publish the first announcement", "Нажмите, чтобы опубликовать первое объявление", "Tocca per pubblicare il primo annuncio", "Touchez pour publier la première annonce", "İlk elanı yerləşdirmək üçün toxunun", "İlk duyuruyu yayınlamak için dokunun", "Натисніть, щоб опублікувати перше оголошення", "Алғашқы хабарландыруды жариялау үшін басыңыз"),
    "nw.delete":          tr("Delete", "Удалить", "Elimina", "Supprimer", "Sil", "Sil", "Видалити", "Жою"),
    "nw.type":            tr("Type", "Тип", "Tipo", "Type", "Növ", "Tür", "Тип", "Түрі"),
    "nw.priority":        tr("Priority", "Приоритет", "Priorità", "Priorité", "Prioritet", "Öncelik", "Пріоритет", "Басымдық"),
    "nw.pNormal":         tr("Normal", "Обычная", "Normale", "Normale", "Adi", "Normal", "Звичайна", "Қалыпты"),
    "nw.pImportant":      tr("Important", "Важная", "Importante", "Importante", "Vacib", "Önemli", "Важлива", "Маңызды"),
    "nw.pUrgent":         tr("Urgent", "Срочная", "Urgente", "Urgent", "Təcili", "Acil", "Термінова", "Шұғыл"),
    "nw.titleField":      tr("Title", "Заголовок", "Titolo", "Titre", "Başlıq", "Başlık", "Заголовок", "Тақырып"),
    "nw.titlePh":         tr("Title (optional)", "Заголовок (необязательно)", "Titolo (facoltativo)", "Titre (facultatif)", "Başlıq (istəyə bağlı)", "Başlık (isteğe bağlı)", "Заголовок (необов'язково)", "Тақырып (міндетті емес)"),
    "nw.body":            tr("Message", "Сообщение", "Messaggio", "Message", "Mesaj", "Mesaj", "Повідомлення", "Хабарлама"),
    "nw.bodyPh":          tr("What's new?…", "Что нового?…", "Cosa c'è di nuovo?…", "Quoi de neuf ?…", "Nə yenilik var?…", "Ne var ne yok?…", "Що нового?…", "Не жаңалық?…"),
    "nw.new":             tr("New post", "Новый пост", "Nuovo post", "Nouveau post", "Yeni paylaşım", "Yeni gönderi", "Новий допис", "Жаңа жазба"),
    "nw.publish":         tr("Publish", "Опубликовать", "Pubblica", "Publier", "Yerləşdir", "Yayınla", "Опублікувати", "Жариялау"),

    // People — дополнительные (свайп-действия, офлайн-явка)
    "pe.cancelOrder":       tr("Cancel order?", "Отменить заказ?", "Annullare l'ordine?", "Annuler la commande ?", "Sifarişi ləğv et?", "Siparişi iptal et?", "Скасувати замовлення?", "Тапсырысты болдырмау?"),
    "pe.keep":              tr("Keep", "Оставить", "Mantieni", "Garder", "Saxla", "Tut", "Залишити", "Сақтау"),
    "pe.checkInPending":    tr("Pending sync", "Ожидает отправки", "In attesa di sync", "En attente de sync", "Göndərilmə gözləyir", "Bekliyor", "Очікує надсилання", "Жіберілуін күтуде"),
    "pe.checkInPendingHint": tr("Check-in saved offline. Will be sent when network is available.", "Явка записана локально. Отправится при наличии сети.", "Ingresso salvato offline. Verrà inviato alla connessione.", "Arrivée enregistrée hors ligne. Sera envoyée à la connexion.", "Gəliş oflayn saxlanıldı. Şəbəkə olduqda göndəriləcək.", "Giriş çevrimdışı kaydedildi. Ağ bağlantısında gönderilecek.", "Явку збережено офлайн. Надішлеться при підключенні.", "Келу офлайн сақталды. Желі болғанда жіберіледі."),

    // KPI — цели по кальянам
    "tab.goal":           tr("Goal", "Цель", "Obiettivo", "Objectif", "Hədəf", "Hedef", "Ціль", "Мақсат"),
    "kpi.title":          tr("Hookah goal", "Цель по кальянам", "Obiettivo narghilè", "Objectif chicha", "Kalyan hədəfi", "Nargile hedefi", "Ціль по кальянах", "Кальян мақсаты"),
    "kpi.setGoal":        tr("Set a hookah goal", "Задать цель по кальянам", "Imposta un obiettivo", "Définir un objectif", "Kalyan hədəfi təyin et", "Nargile hedefi belirle", "Задати ціль по кальянах", "Кальян мақсатын қою"),
    "kpi.empty":          tr("No goal set", "Цель не задана", "Nessun obiettivo", "Aucun objectif", "Hədəf yoxdur", "Hedef yok", "Ціль не задана", "Мақсат жоқ"),
    "kpi.emptyHint":      tr("The team goal for the month appears here", "Здесь появится командная цель на месяц", "Qui appare l'obiettivo del mese", "L'objectif du mois apparaît ici", "Ayın komanda hədəfi burada görünür", "Ayın takım hedefi burada görünür", "Тут з'явиться командна ціль на місяць", "Айдың команда мақсаты осында шығады"),
    "kpi.emptyHintManager": tr("Tap + to set a goal for this month", "Нажмите +, чтобы задать цель на этот месяц", "Tocca + per impostare un obiettivo", "Touchez + pour définir un objectif", "Bu ay üçün hədəf təyin edin", "Bu ay için hedef belirleyin", "Натисніть +, щоб задати ціль на місяць", "Осы айға мақсат қою үшін + басыңыз"),
    "kpi.reached":        tr("Goal reached", "Цель достигнута", "Obiettivo raggiunto", "Objectif atteint", "Hədəf çatdı", "Hedefe ulaşıldı", "Ціль досягнута", "Мақсатқа жетті"),
    "kpi.left":           tr("Left: {n}", "Осталось: {n}", "Restano: {n}", "Reste : {n}", "Qaldı: {n}", "Kaldı: {n}", "Залишилось: {n}", "Қалды: {n}"),
    "kpi.allTypes":       tr("All types", "Все виды", "Tutti i tipi", "Tous les types", "Bütün növlər", "Tüm türler", "Усі види", "Барлық түрлер"),
    "kpi.new":            tr("New goal", "Новая цель", "Nuovo obiettivo", "Nouvel objectif", "Yeni hədəf", "Yeni hedef", "Нова ціль", "Жаңа мақсат"),
    "kpi.edit":           tr("Edit goal", "Редактировать цель", "Modifica obiettivo", "Modifier l'objectif", "Hədəfi düzəlt", "Hedefi düzenle", "Редагувати ціль", "Мақсатты өзгерту"),
    "kpi.save":           tr("Save", "Сохранить", "Salva", "Enregistrer", "Yadda saxla", "Kaydet", "Зберегти", "Сақтау"),
    "kpi.delete":         tr("Delete goal", "Удалить цель", "Elimina obiettivo", "Supprimer l'objectif", "Hədəfi sil", "Hedefi sil", "Видалити ціль", "Мақсатты жою"),
    "kpi.fTitle":         tr("Title", "Название", "Titolo", "Titre", "Başlıq", "Başlık", "Назва", "Атауы"),
    "kpi.titlePh":        tr("e.g. Fruit hookahs (optional)", "напр. Фруктовые кальяны (необязательно)", "es. Narghilè alla frutta", "ex. Chicha aux fruits", "məs. Meyvəli kalyan", "örn. Meyveli nargile", "напр. Фруктові кальяни", "мыс. Жеміс кальяндары"),
    "kpi.types":          tr("Hookah types", "Виды кальянов", "Tipi di narghilè", "Types de chicha", "Kalyan növləri", "Nargile türleri", "Види кальянів", "Кальян түрлері"),
    "kpi.noTypes":        tr("No hookah types — add them in settings", "Нет видов кальянов — добавьте в настройках", "Nessun tipo — aggiungi nelle impostazioni", "Aucun type — ajoutez dans les réglages", "Növ yoxdur — ayarlarda əlavə edin", "Tür yok — ayarlardan ekleyin", "Немає видів — додайте в налаштуваннях", "Түрлер жоқ — баптаулардан қосыңыз"),
    "kpi.target":         tr("Target (qty)", "Цель (кол-во)", "Obiettivo (q.tà)", "Objectif (qté)", "Hədəf (say)", "Hedef (adet)", "Ціль (к-сть)", "Мақсат (саны)"),

    // Analytics — Export
    "an.export":          tr("Export", "Экспорт", "Esporta", "Exporter", "İxrac", "Dışa aktar", "Експорт", "Экспорт"),
    "an.exportCSV":       tr("Export CSV", "Скачать CSV", "Esporta CSV", "Exporter CSV", "CSV ixrac", "CSV dışa aktar", "Експорт CSV", "CSV экспорты"),
    "an.exportPDF":       tr("Export PDF", "Скачать PDF", "Esporta PDF", "Exporter PDF", "PDF ixrac", "PDF dışa aktar", "Експорт PDF", "PDF экспорты"),
    "an.csvDate":         tr("Date", "Дата", "Data", "Date", "Tarix", "Tarih", "Дата", "Күні"),
    "an.csvOpening":      tr("Opening", "Открытие", "Apertura", "Ouverture", "Açılış", "Açılış", "Відкриття", "Ашылу"),
    "an.csvIncome":       tr("Income", "Доход", "Entrate", "Revenu", "Gəlir", "Gelir", "Дохід", "Кіріс"),
    "an.csvExpense":      tr("Expense", "Расход", "Spese", "Dépense", "Xərc", "Gider", "Витрата", "Шығыс"),
    "an.csvInkass":       tr("Inkass.", "Инкасс.", "Prelievo", "Encaisse", "İnkass.", "Tahsilat", "Інкас.", "Инкасс."),
    "an.csvClosing":      tr("Closing", "Закрытие", "Chiusura", "Clôture", "Bağlanış", "Kapanış", "Закриття", "Жабылу"),
    "an.csvTotal":        tr("Total", "Итого", "Totale", "Total", "Cəmi", "Toplam", "Разом", "Барлығы"),
    "an.pdfTitle":        tr("Analytics Report", "Отчёт по аналитике", "Report analitico", "Rapport analytique", "Analitika hesabatı", "Analiz raporu", "Звіт по аналітиці", "Аналитика есебі"),
    "an.pdfShiftsTable":  tr("Shifts", "Смены", "Turni", "Services", "Növbələr", "Vardiyalar", "Зміни", "Ауысымдар"),
    "an.exportFailed":    tr("Export failed", "Ошибка экспорта", "Esportazione fallita", "Échec de l'export", "İxrac xətası", "Dışa aktarma hatası", "Помилка експорту", "Экспорт қатесі"),

    // Analytics — AI Advisor
    "an.advisor":         tr("Advisor", "Советник", "Consulente", "Conseiller", "Məsləhətçi", "Danışman", "Радник", "Кеңесші"),
    "an.advisorRefresh":  tr("Refresh", "Обновить", "Aggiorna", "Actualiser", "Yenilə", "Yenile", "Оновити", "Жаңарту"),
    "an.advisorLoading":  tr("Analysing data...", "Анализирую данные...", "Analizzando...", "Analyse en cours...", "Məlumatlar analiz edilir...", "Veriler analiz ediliyor...", "Аналізую дані...", "Деректер талданып жатыр..."),
    "an.advisorEmpty":    tr("No insights yet — tap Refresh", "Нет наблюдений — нажмите «Обновить»", "Nessuna analisi — premi Aggiorna", "Pas d'analyse — appuyez sur Actualiser", "Hələ məlumat yoxdur — Yenilə düyməsinə basın", "Henüz analiz yok — Yenile'ye dokunun", "Немає спостережень — натисніть «Оновити»", "Ақпарат жоқ — Жаңарту басыңыз"),
    "an.advisorPrompt":   tr("Give 2-3 short practical observations and tips based on this data: compare with last month, note anomalies, what to improve.", "Дай 2-3 кратких практичных наблюдения и совета по этим данным: сравни с прошлым месяцем, отметь аномалии, что улучшить.", "Dai 2-3 brevi osservazioni pratiche su questi dati: confronta con il mese scorso, segnala anomalie, cosa migliorare.", "Donne 2-3 courtes observations pratiques sur ces données : compare avec le mois dernier, note les anomalies, quoi améliorer.", "Bu məlumatlar üzrə 2-3 qısa praktik müşahidə ver: keçən ay ilə müqayisə et, anormallıqları qeyd et, nəyi yaxşılaşdırmaq olar.", "Bu veriler hakkında 2-3 kısa pratik gözlem ver: geçen ayla karşılaştır, anormallikleri belirt, neyi iyileştirmeli.", "Дай 2-3 коротких практичних спостереження за цими даними: порівняй з минулим місяцем, відзнач аномалії, що покращити.", "Осы деректер бойынша 2-3 қысқа практикалық байқау бер: өткен айбен салыстыр, ауытқуларды атап өт, нені жақсарту керек."),
    // Bookings — расширение (поиск, диапазоны, гости)
    "bk.searchPh":        tr("Search by name or phone", "Поиск по имени или телефону", "Cerca per nome o telefono", "Rechercher par nom ou téléphone", "Ad və ya telefon ilə axtar", "Ad veya telefon ile ara", "Пошук за ім'ям або телефоном", "Аты немесе телефон бойынша іздеу"),
    "bk.today":           tr("Today", "Сегодня", "Oggi", "Aujourd'hui", "Bu gün", "Bugün", "Сьогодні", "Бүгін"),
    "bk.tomorrow":        tr("Tomorrow", "Завтра", "Domani", "Demain", "Sabah", "Yarın", "Завтра", "Ертең"),
    "bk.week":            tr("Week", "Неделя", "Settimana", "Semaine", "Həftə", "Hafta", "Тиждень", "Апта"),
    "bk.rangeToday":      tr("Today", "Сегодня", "Oggi", "Aujourd'hui", "Bu gün", "Bugün", "Сьогодні", "Бүгін"),
    "bk.rangeTomorrow":   tr("Tomorrow", "Завтра", "Domani", "Demain", "Sabah", "Yarın", "Завтра", "Ертең"),
    "bk.rangeWeek":       tr("7 Days", "7 дней", "7 giorni", "7 jours", "7 gün", "7 gün", "7 днів", "7 күн"),
    "bk.totalGuests":     tr("{n} guests", "{n} гостей", "{n} ospiti", "{n} personnes", "{n} qonaq", "{n} kişi", "{n} гостей", "{n} қонақ"),
    "bk.duplicate":       tr("Duplicate", "Дублировать", "Duplica", "Dupliquer", "Kopyala", "Kopyala", "Дублювати", "Көшіру"),
    "bk.duplicateTitle":  tr("Duplicate booking", "Дублировать бронь", "Duplica prenotazione", "Dupliquer la réservation", "Rezervi kopyala", "Rezervasyonu kopyala", "Дублювати бронь", "Бронды көшіру"),
    "bk.duplicateFor":    tr("For date", "На дату", "Per data", "Pour la date", "Tarix üçün", "Tarih için", "На дату", "Күні үшін"),
    "bk.callAction":      tr("Call", "Позвонить", "Chiama", "Appeler", "Zəng et", "Ara", "Зателефонувати", "Қоңырау шалу"),
    "bk.whatsapp":        tr("WhatsApp", "WhatsApp", "WhatsApp", "WhatsApp", "WhatsApp", "WhatsApp", "WhatsApp", "WhatsApp"),
    "bk.contactGuest":    tr("Contact guest", "Связаться с гостем", "Contatta l'ospite", "Contacter l'invité", "Qonaqla əlaqə", "Misafirle iletişim", "Зв'язатися з гостем", "Қонақпен байланысу"),
    "bk.markArrived":     tr("Arrived", "Пришёл", "Arrivato", "Arrivé", "Gəldi", "Geldi", "Прийшов", "Келді"),
    "bk.markLate":        tr("Late", "Опоздал", "In ritardo", "En retard", "Gecikdi", "Gecikmeli", "Запізнився", "Кешікті"),
    "bk.confirmDelete":   tr("Delete booking?", "Удалить бронь?", "Eliminare la prenotazione?", "Supprimer la réservation ?", "Rezervi silinsin?", "Rezervasyon silinsin mi?", "Видалити бронь?", "Бронды жою керек пе?"),
    "bk.swipeArrived":    tr("Arrived", "Пришёл", "Arrivato", "Arrivé", "Gəldi", "Geldi", "Прийшов", "Келді"),

    // Guests (loyalty)
    "gs.title":           tr("Guests", "Гости", "Ospiti", "Invités", "Qonaqlar", "Misafirler", "Гості", "Қонақтар"),
    "gs.visits":          tr("{n} visits", "{n} визитов", "{n} visite", "{n} visites", "{n} ziyarət", "{n} ziyaret", "{n} візитів", "{n} рет келген"),
    "gs.lastVisit":       tr("Last visit", "Последний визит", "Ultima visita", "Dernière visite", "Son ziyarət", "Son ziyaret", "Останній візит", "Соңғы келуі"),
    "gs.totalGuests":     tr("{n} people total", "Всего {n} гостей", "Totale {n} ospiti", "{n} personnes au total", "Cəmi {n} qonaq", "Toplam {n} kişi", "Всього {n} гостей", "Барлығы {n} қонақ"),
    "gs.history":         tr("Booking history", "История броней", "Storico prenotazioni", "Historique des réservations", "Rezerv tarixçəsi", "Rezervasyon geçmişi", "Історія броней", "Брондар тарихы"),
    "gs.empty":           tr("No guests yet", "Пока нет гостей", "Nessun ospite", "Aucun invité", "Hələ qonaq yoxdur", "Henüz misafir yok", "Поки немає гостей", "Әзірге қонақ жоқ"),
    "gs.emptyHint":       tr("Guests who made bookings appear here", "Здесь появятся гости, которые делали брони", "Gli ospiti che hanno prenotato appariranno qui", "Les invités ayant réservé apparaîtront ici", "Rezerv edən qonaqlar burada görünəcək", "Rezervasyon yapan misafirler burada görünür", "Тут з'являться гості, які робили брони", "Брон жасаған қонақтар осында шығады"),
    "gs.regularBadge":    tr("Regular", "Постоянник", "Habitué", "Habitué", "Daimi", "Daimi", "Постійний", "Тұрақты"),
    "gs.visitBadge":      tr("Visit {n}", "{n}-й визит", "Visita {n}", "Visite {n}", "{n} ziyarət", "{n}. ziyaret", "{n}-й візит", "{n}-ші рет"),
    "gs.loading":         tr("Loading guests…", "Загрузка гостей…", "Caricamento ospiti…", "Chargement des invités…", "Qonaqlar yüklənir…", "Misafirler yükleniyor…", "Завантаження гостей…", "Қонақтар жүктелуде…"),
    "gs.newBooking":      tr("New booking", "Новая бронь", "Nuova prenotazione", "Nouvelle réservation", "Yeni rezerv", "Yeni rezervasyon", "Нова бронь", "Жаңа брон"),
    "gs.note":            tr("Guest note", "Заметка о госте", "Nota ospite", "Note sur l’invité", "Qonaq qeydi", "Misafir notu", "Нотатка про гостя", "Қонақ туралы жазба"),
    "gs.notePh":          tr("Allergies, preferences, VIP…", "Аллергии, предпочтения, VIP…", "Allergie, preferenze, VIP…", "Allergies, préférences, VIP…", "Allergiya, üstünlüklər, VIP…", "Alerjiler, tercihler, VIP…", "Алергії, уподобання, VIP…", "Аллергия, қалаулар, VIP…"),
    "gs.avgParty":        tr("Avg party", "Средняя компания", "Gruppo medio", "Groupe moyen", "Orta qrup", "Ort. grup", "Середня компанія", "Орташа топ"),
    "gs.favTable":        tr("Favorite table", "Любимый стол", "Tavolo preferito", "Table préférée", "Sevimli masa", "Favori masa", "Улюблений стіл", "Сүйікті үстел"),
    "gs.today":           tr("Today", "Сегодня", "Oggi", "Aujourd’hui", "Bu gün", "Bugün", "Сьогодні", "Бүгін"),
    "gs.daysAgo":         tr("{n} d ago", "{n} дн. назад", "{n} g fa", "il y a {n} j", "{n} gün əvvəl", "{n} gün önce", "{n} дн. тому", "{n} күн бұрын"),
    "gs.monthsAgo":       tr("{n} mo ago", "{n} мес. назад", "{n} mesi fa", "il y a {n} mois", "{n} ay əvvəl", "{n} ay önce", "{n} міс. тому", "{n} ай бұрын"),
]
