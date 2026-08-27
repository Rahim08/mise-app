import SwiftUI
import UIKit

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
        didSet {
            UserDefaults.standard.set(lang.rawValue, forKey: key); I18n.code = lang.rawValue
            refreshQuickActionShortcuts()
            PushManager.shared.reuploadIfPossible()   // синк lang в push_subscriptions
            // Виджет — отдельный процесс/песочница, mise_lang из UserDefaults.standard ему
            // не виден. Пишем язык в App Group, чтобы виджет рендерил текст на нём же.
            UserDefaults(suiteName: kMiseAppGroup)?.set(lang.rawValue, forKey: kMiseWidgetLangKey)
        }
    }

    var theme: AppTheme {
        didSet {
            UserDefaults.standard.set(theme.rawValue, forKey: themeKey)
            applyThemeToWindows()
        }
    }

    /// SwiftUI colorScheme override (nil = system).
    var colorScheme: ColorScheme? {
        switch theme {
        case .dark:   return .dark
        case .light:  return .light
        case .system: return nil
        }
    }

    /// Применяет тему на уровне UIWindow. `preferredColorScheme` не догоняет уже
    /// открытый sheet (Настройки) и нативный таб-бар — они меняются лишь при
    /// пересоздании иерархии. Override стиля окна шлёт trait-изменение всем
    /// потомкам сразу, поэтому переключение видно вживую везде.
    func applyThemeToWindows() {
        let style: UIUserInterfaceStyle
        switch theme {
        case .dark:   style = .dark
        case .light:  style = .light
        case .system: style = .unspecified
        }
        for scene in UIApplication.shared.connectedScenes {
            guard let ws = scene as? UIWindowScene else { continue }
            for w in ws.windows {
                w.overrideUserInterfaceStyle = style
                // Нативный liquid-glass UITabBar не перекрашивается от смены стиля окна,
                // пока не пройдёт layout-проход — форсируем его вручную.
                if let root = w.rootViewController { Self.refreshTabBars(in: root) }
            }
        }
    }

    /// Рекурсивно обходит иерархию контроллеров и форсирует перерисовку таб-баров.
    private static func refreshTabBars(in vc: UIViewController) {
        if let tbc = vc as? UITabBarController {
            let bar = tbc.tabBar
            // Переназначение appearance + layout заставляет бар перечитать trait-стиль.
            let std = bar.standardAppearance
            bar.standardAppearance = std
            bar.scrollEdgeAppearance = bar.scrollEdgeAppearance
            bar.setNeedsLayout()
            bar.layoutIfNeeded()
        }
        for child in vc.children { refreshTabBars(in: child) }
        if let presented = vc.presentedViewController { refreshTabBars(in: presented) }
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
        // didSet не срабатывает на присвоении в собственном init — синкаем явно, иначе
        // виджет узнает язык только после первой ручной смены в Настройках.
        UserDefaults(suiteName: kMiseAppGroup)?.set(resolvedLang.rawValue, forKey: kMiseWidgetLangKey)
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

/// Код языка для локали форматтеров дат — читается/пишется только на MainActor.
@MainActor enum I18n { static var code = "en" }
/// Локаль для форматтеров дат — следует выбранному языку.
@MainActor func appLocale() -> Locale { Locale(identifier: I18n.code) }

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
    "settings.dayStart":      tr("Operating day", "Операционный день", "Giorno operativo", "Journée d’exploitation", "Əməliyyat günü", "Çalışma günü", "Операційний день", "Жұмыс күні"),
    "settings.dayStartValue": tr("New day starts at {h}", "Новый день начинается в {h}", "Il nuovo giorno inizia alle {h}", "Nouvelle journée à {h}", "Yeni gün {h}-də başlayır", "Yeni gün {h} başlıyor", "Новий день починається о {h}", "Жаңа күн {h} басталады"),
    "settings.dayStartHint":  tr("Bookings before this hour are treated as late night of the previous day, not the start of a new day.", "Брони раньше этого часа считаются поздним вечером предыдущего дня, а не началом нового.", "Le prenotazioni prima di quest'ora sono considerate tarda serata del giorno precedente.", "Les réservations avant cette heure sont considérées comme la fin de soirée du jour précédent.", "Bu saatdən əvvəlki rezervasiyalar əvvəlki günün gecəsi sayılır.", "Bu saatten önceki rezervasyonlar bir önceki günün gecesi sayılır.", "Броні раніше цієї години вважаються пізнім вечором попереднього дня.", "Осы сағатқа дейінгі брондар алдыңғы күннің түні болып саналады."),
    "theme.system":    tr("System", "Системная", "Sistema", "Système", "Sistem", "Sistem", "Системна", "Жүйелік"),
    "theme.dark":      tr("Dark", "Тёмная", "Scuro", "Sombre", "Tünd", "Koyu", "Темна", "Қараңғы"),
    "theme.light":     tr("Light", "Светлая", "Chiaro", "Clair", "İşıqlı", "Açık", "Світла", "Жарық"),
    "logout":          tr("Log out", "Выйти", "Esci", "Déconnexion", "Çıxış", "Çıkış yap", "Вийти", "Шығу"),
    "logout.confirm":  tr("Log out of venue?", "Выйти из заведения?", "Uscire dal locale?", "Quitter l’établissement ?", "Məkandan çıxılsın?", "Mekândan çıkılsın mı?", "Вийти із закладу?", "Орыннан шығу керек пе?"),
    "logout.msg":      tr("You’ll need to scan the QR and enter the PIN again.", "Понадобится снова отсканировать QR и ввести PIN.", "Dovrai scansionare di nuovo il QR e inserire il PIN.", "Vous devrez scanner le QR et saisir le PIN à nouveau.", "QR-u yenidən skan edib PIN daxil etməli olacaqsınız.", "QR'ı tekrar tarayıp PIN girmeniz gerekecek.", "Потрібно буде знову відсканувати QR і ввести PIN.", "QR-ды қайта сканерлеп, PIN енгізу қажет болады."),
    "discard.title":   tr("Discard entry?", "Отменить ввод?", "Annullare l’inserimento?", "Annuler la saisie ?", "Daxiletmə ləğv edilsin?", "Giriş iptal edilsin mi?", "Скасувати введення?", "Енгізу тоқтатылсын ба?"),
    "discard.msg":     tr("The entered data won’t be saved.", "Введённые данные не сохранятся.", "I dati inseriti non verranno salvati.", "Les données saisies ne seront pas enregistrées.", "Daxil edilmiş məlumatlar saxlanılmayacaq.", "Girilen veriler kaydedilmeyecek.", "Введені дані не збережуться.", "Енгізілген деректер сақталмайды."),
    "discard.confirm": tr("Discard", "Не сохранять", "Non salvare", "Ne pas enregistrer", "Saxlama", "Kaydetme", "Не зберігати", "Сақтамау"),

    // Роли
    "role.owner": tr("Owner", "Владелец", "Proprietario", "Propriétaire", "Sahib", "Sahip", "Власник", "Иесі"),

    // Подзаголовки модулей
    "mod.manager.sub":   tr("Shifts & cash", "Смены и касса", "Turni e cassa", "Services et caisse", "Növbələr və kassa", "Vardiyalar ve kasa", "Зміни та каса", "Ауысым және касса"),
    "mod.analytics.sub": tr("Revenue & analytics", "Выручка и аналитика", "Ricavi e analisi", "Revenus et analyses", "Gəlir və analitika", "Gelir ve analiz", "Виручка та аналітика", "Кіріс және аналитика"),
    "mod.stash.sub":     tr("Stock & sessions", "Склад и сессии", "Magazzino e sessioni", "Stock et sessions", "Anbar və seanslar", "Stok ve seanslar", "Склад і сесії", "Қойма және сеанстар"),
    "mod.people.sub":    tr("Team & schedule", "Команда и расписание", "Team e turni", "Équipe et planning", "Komanda və qrafik", "Ekip ve program", "Команда та розклад", "Команда және кесте"),

    // Хаб — редактирование раскладки плиток (HubLayout.swift)
    "hub.editHint":        tr("Hold a tile to reorder or resize", "Зажмите плитку, чтобы переставить или изменить размер", "Tieni premuta una scheda per riordinare o ridimensionare", "Maintenez une tuile pour la réorganiser ou la redimensionner", "Sırasını və ölçüsünü dəyişmək üçün kafeli basılı saxlayın", "Sırasını veya boyutunu değiştirmek için kutucuğa uzun basın", "Затисніть плитку, щоб переставити або змінити розмір", "Ретін немесе өлшемін өзгерту үшін плитканы басып тұрыңыз"),
    "hub.stat.shiftOpen":  tr("Open", "Открыта", "Aperta", "Ouverte", "Açıq", "Açık", "Відкрита", "Ашық"),
    "hub.stat.shiftClosed": tr("Closed", "Закрыта", "Chiusa", "Fermée", "Bağlı", "Kapalı", "Закрита", "Жабық"),
    "hub.stat.lowStock":   tr("running low", "на исходе", "in esaurimento", "en rupture", "azalır", "azalıyor", "закінчується", "таусылып барады"),
    "hub.stat.onShift":    tr("on shift", "на смене", "in turno", "en service", "növbədə", "vardiyada", "на зміні", "ауысымда"),
    "hub.stat.unreadNews": tr("new", "новых", "nuove", "nouvelles", "yeni", "yeni", "нових", "жаңа"),
    "faceid.loginReason":  tr("Sign in to Mise", "Вход в Mise", "Accesso a Mise", "Connexion à Mise", "Mise-ə giriş", "Mise'e giriş", "Вхід у Mise", "Mise-ге кіру"),
    "pe.iLeft":      tr("I'm leaving", "Я ушёл", "Sto uscendo", "Je pars", "Mən getdim", "Çıkıyorum", "Я пішов", "Мен кеттім"),
    "pe.checkedOut": tr("Check-out recorded", "Уход отмечен", "Uscita registrata", "Départ enregistré", "Çıxış qeyd olundu", "Çıkış kaydedildi", "Вихід зафіксовано", "Кету тіркелді"),
    "pe.leftAt":     tr("Left at {t}", "Ушёл в {t}", "Uscito alle {t}", "Parti à {t}", "{t}-də getdi", "{t}'de çıktı", "Пішов о {t}", "{t}-де кетті"),
    "faceid.enableReason": tr("Enable Face ID sign-in", "Включить вход по Face ID", "Attiva l'accesso con Face ID", "Activer la connexion Face ID", "Face ID ilə girişi aktivləşdir", "Face ID ile girişi etkinleştir", "Увімкнути вхід за Face ID", "Face ID арқылы кіруді қосу"),

    // Вкладки Analytics
    "tab.period":   tr("Period", "Период", "Periodo", "Période", "Dövr", "Dönem", "Період", "Кезең"),
    "tab.kassa":    tr("Cash", "Касса", "Cassa", "Caisse", "Kassa", "Kasa", "Каса", "Касса"),
    "tab.bank":     tr("Bank", "Банк", "Banca", "Banque", "Bank", "Banka", "Банк", "Банк"),
    "tab.salary":   tr("Salary", "Зарплата", "Stipendio", "Salaire", "Maaş", "Maaş", "Зарплата", "Жалақы"),
    "tab.hookah":   tr("Sessions", "Сессии", "Sessioni", "Sessions", "Seanslar", "Seanslar", "Сесії", "Сеанстар"),

    // Вкладки Manager
    "tab.shift":     tr("Shift", "Смена", "Turno", "Service", "Növbə", "Vardiya", "Зміна", "Ауысым"),
    "tab.settings":  tr("Settings", "Настройки", "Impostazioni", "Paramètres", "Ayarlar", "Ayarlar", "Налаштування", "Баптаулар"),
    "tab.discipline": tr("Discipline", "Дисциплина", "Disciplina", "Discipline", "İntizam", "Disiplin", "Дисципліна", "Тәртіп"),

    // Вкладки People
    "tab.shifts": tr("Shifts", "Смены", "Turni", "Services", "Növbələr", "Vardiyalar", "Зміни", "Ауысымдар"),
    "tab.tasks":  tr("Tasks", "Задачи", "Attività", "Tâches", "Tapşırıqlar", "Görevler", "Завдання", "Тапсырмалар"),
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
    "pe.catHookah":    tr("Hookah", "Кальян", "Narghilè", "Chicha", "Qəlyan", "Nargile", "Кальян", "Кальян"),
    "pe.catHousehold": tr("Household", "Хозтовары", "Casalinghi", "Ménage", "Təsərrüfat", "Ev", "Господарські", "Шаруашылық"),
    "pe.catGeneral":   tr("General", "Общее", "Generale", "Général", "Ümumi", "Genel", "Загальне", "Жалпы"),
    "pe.nsTitle":      tr("Notification settings", "Настройки уведомлений", "Impostazioni notifiche", "Réglages des notifications", "Bildiriş tənzimləmələri", "Bildirim ayarları", "Налаштування сповіщень", "Хабарландыру баптаулары"),
    "pe.nsShiftReminder": tr("Shift reminders", "Напоминания о смене", "Promemoria turni", "Rappels de service", "Növbə xatırlatmaları", "Vardiya hatırlatıcıları", "Нагадування про зміну", "Ауысым еске салулары"),
    "pe.nsTask":       tr("Tasks", "Задачи", "Attività", "Tâches", "Tapşırıqlar", "Görevler", "Завдання", "Тапсырмалар"),
    "pe.nsSwap":       tr("Shift swaps", "Обмены смен", "Scambi turni", "Échanges de service", "Növbə dəyişiklikləri", "Vardiya değişimleri", "Обміни змін", "Ауысым алмасулары"),
    "pe.nsNews":       tr("News & announcements", "Новости и объявления", "Notizie e annunci", "Actualités et annonces", "Xəbərlər və elanlar", "Haberler ve duyurular", "Новини та оголошення", "Жаңалықтар мен хабарландырулар"),
    "pe.nsBooking":    tr("New bookings", "Новые брони", "Nuove prenotazioni", "Nouvelles réservations", "Yeni rezervlər", "Yeni rezervasyonlar", "Нові бронювання", "Жаңа брондаулар"),
    "pe.nsAttendance": tr("Staff arrivals", "Приход на смену", "Arrivi del personale", "Arrivées du personnel", "İşçi gəlişləri", "Personel gelişleri", "Прихід на зміну", "Қызметкердің келуі"),
    "pe.nsCashOpen":   tr("Cash opened", "Открытие кассы", "Cassa aperta", "Caisse ouverte", "Kassa açılışı", "Kasa açılışı", "Відкриття каси", "Касса ашылуы"),
    "pe.nsCashClose":  tr("Cash closed", "Закрытие кассы", "Cassa chiusa", "Caisse fermée", "Kassa bağlanışı", "Kasa kapanışı", "Закриття каси", "Касса жабылуы"),
    "pe.nsSalaryPayout": tr("Salary payout reminder", "Напоминание о выплате ЗП", "Promemoria pagamento stipendi", "Rappel de versement du salaire", "Maaş ödəniş xatırlatması", "Maaş ödeme hatırlatması", "Нагадування про виплату ЗП", "Жалақы төлемін еске салу"),
    "pe.nsPurchase":   tr("Purchases", "Закуп", "Acquisti", "Achats", "Satınalma", "Satın alma", "Закупівля", "Сатып алу"),
    "pe.nsShowAmount": tr("Show cash amount", "Показывать сумму кассы", "Mostra importo cassa", "Afficher le montant", "Kassa məbləğini göstər", "Kasa tutarını göster", "Показувати суму каси", "Касса сомасын көрсету"),
    "pe.nsPurchaseMode": tr("Purchase alerts", "Уведомления о закупе", "Avvisi acquisti", "Alertes achats", "Satınalma bildirişləri", "Satın alma uyarıları", "Сповіщення про закупівлю", "Сатып алу хабарландырулары"),
    "pe.nsEach":       tr("Each item", "Каждая позиция", "Ogni articolo", "Chaque article", "Hər məhsul", "Her ürün", "Кожна позиція", "Әр тауар"),
    "pe.nsDaily":      tr("Once a day", "Раз в день", "Una volta al giorno", "Une fois par jour", "Gündə bir dəfə", "Günde bir kez", "Раз на день", "Күніне бір рет"),
    "pe.nsForManagers": tr("For managers and owner", "Для менеджеров и владельца", "Per manager e titolare", "Pour managers et propriétaire", "Menecerlər və sahib üçün", "Yöneticiler ve sahip için", "Для менеджерів і власника", "Менеджерлер мен иеге"),

    // Дисциплина (pe.dis*) — "pe.discipline"/"pe.disMore" удалены (B2/C7, аудит 2026-08-13):
    // Дисциплина переехала в Manager→Дисциплина целиком, оба ключа осиротели.
    "pe.checklistErrors": tr("Checklist errors", "Ошибки чек-листов", "Errori checklist", "Erreurs de checklist", "Çek-list xətaları", "Kontrol listesi hataları", "Помилки чек-листів", "Чек-парақ қателері"),
    "pe.checklistErrorsShort": tr("errors", "ошибок", "errori", "erreurs", "xəta", "hata", "помилок", "қате"),
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
    "tab.inventory":  tr("Inventory", "Инвентарь", "Inventario", "Inventaire", "İnventarizasiya", "Envanter", "Інвентаризація", "Түгендеу"),

    // Онбординг
    "onb.tagline": tr("Everything for your venue — in one app", "Всё для заведения — в одном приложении", "Tutto per il tuo locale, in un’app", "Tout pour votre établissement, dans une app", "Məkanınız üçün hər şey — bir tətbiqdə", "Mekânınız için her şey — tek uygulamada", "Усе для закладу — в одному застосунку", "Орныңызға керектің бәрі — бір қолданбада"),
    "onb.login":   tr("Log in", "Войти", "Accedi", "Se connecter", "Daxil ol", "Giriş yap", "Увійти", "Кіру"),
    "pin.enter":   tr("Enter PIN", "Введите PIN", "Inserisci il PIN", "Saisir le PIN", "PIN daxil edin", "PIN girin", "Введіть PIN", "PIN енгізіңіз"),
    "pin.change":  tr("Change venue", "Сменить заведение", "Cambia locale", "Changer d’établissement", "Məkanı dəyiş", "Mekânı değiştir", "Змінити заклад", "Орынды ауыстыру"),
    "pin.deviceMismatch":    tr("Device not recognised", "Устройство не распознано", "Dispositivo non riconosciuto", "Appareil non reconnu", "Cihaz tanınmadı", "Cihaz tanınmadı", "Пристрій не розпізнано", "Құрылғы танылмады"),
    "pin.deviceMismatchMsg": tr("This PIN is linked to another device. Ask your manager to reset the device binding.", "Этот PIN привязан к другому устройству. Попросите менеджера сбросить привязку.", "Questo PIN è collegato a un altro dispositivo. Chiedi al manager di reimpostare il collegamento.", "Ce PIN est lié à un autre appareil. Demandez à votre manager de réinitialiser le lien.", "Bu PIN başqa cihaza bağlıdır. Menecerdən cihaz bağlantısını sıfırlamasını xahiş edin.", "Bu PIN başka bir cihaza bağlı. Yöneticinizden cihaz bağlantısını sıfırlamasını isteyin.", "Цей PIN прив’язаний до іншого пристрою. Попросіть менеджера скинути прив’язку.", "Бұл PIN басқа құрылғыға байланған. Менеджерден байланысты нөлдеуді сұраңыз."),
    "pin.deviceLimit":       tr("Device limit reached", "Достигнут лимит устройств", "Limite dispositivi raggiunto", "Limite d’appareils atteint", "Cihaz limiti doldu", "Cihaz limiti doldu", "Ліміт пристроїв вичерпано", "Құрылғы лимиті толды"),
    "pin.deviceLimitMsg":    tr("Your plan’s device limit is reached. Ask your manager to upgrade the subscription.", "Лимит устройств вашего тарифа исчерпан. Попросите менеджера обновить подписку.", "Il limite dispositivi del tuo piano è stato raggiunto. Chiedi al manager di aggiornare l’abbonamento.", "La limite d’appareils de votre abonnement est atteinte. Demandez à votre manager de mettre à niveau.", "Planınızın cihaz limiti doldu. Menecerdən abunəliyi yeniləməsini xahiş edin.", "Planınızın cihaz limiti doldu. Yöneticinizden aboneliği güncellemesini isteyin.", "Ліміт пристроїв вашого тарифу вичерпано. Попросіть менеджера оновити підписку.", "Тарифыңыздың құрылғы лимиті толды. Менеджерден жазылымды жаңартуды сұраңыз."),

    // Общее (доп.)
    "saving":     tr("Saving…", "Сохранение…", "Salvataggio…", "Enregistrement…", "Saxlanılır…", "Kaydediliyor…", "Збереження…", "Сақталуда…"),
    "saveFailed": tr("Not saved: {err}", "Не сохранилось: {err}", "Non salvato: {err}", "Non enregistré : {err}", "Saxlanılmadı: {err}", "Kaydedilmedi: {err}", "Не збережено: {err}", "Сақталмады: {err}"),
    "refreshFailed": tr("Couldn’t refresh", "Не удалось обновить", "Aggiornamento non riuscito", "Échec de l’actualisation", "Yenilənmədi", "Yenilenemedi", "Не вдалося оновити", "Жаңарту сәтсіз"),
    "loadFailed": tr("Couldn’t load", "Не удалось загрузить", "Caricamento non riuscito", "Échec du chargement", "Yüklənmədi", "Yüklenemedi", "Не вдалося завантажити", "Жүктелмеді"),
    "retry":      tr("Retry", "Повторить", "Riprova", "Réessayer", "Təkrar", "Tekrar", "Повторити", "Қайталау"),
    "empty":      tr("Empty", "Пусто", "Vuoto", "Vide", "Boş", "Boş", "Порожньо", "Бос"),
    "noData":     tr("No data", "Нет данных", "Nessun dato", "Aucune donnée", "Məlumat yoxdur", "Veri yok", "Немає даних", "Дерек жоқ"),

    // Manager
    "mg.noShift":        tr("Shift not open", "Смена не открыта", "Turno non aperto", "Service non ouvert", "Növbə açıq deyil", "Vardiya açık değil", "Зміна не відкрита", "Ауысым ашылмаған"),
    "mg.noShiftHint":    tr("Open a shift to track the till for this day", "Откройте смену, чтобы вести кассу за этот день", "Apri un turno per gestire la cassa di questa giornata", "Ouvrez un service pour gérer la caisse du jour", "Bu gün üçün kassanı aparmaq üçün növbə açın", "Bu günün kasasını tutmak için vardiya açın", "Відкрийте зміну, щоб вести касу за цей день", "Осы күнге касса жүргізу үшін ауысым ашыңыз"),
    "mg.openShift":      tr("Open shift", "Открыть смену", "Apri turno", "Ouvrir le service", "Növbəni aç", "Vardiya aç", "Відкрити зміну", "Ауысым ашу"),
    "mg.cash":           tr("Cash", "Касса", "Cassa", "Caisse", "Kassa", "Kasa", "Каса", "Касса"),
    "mg.cashIncome":     tr("Cash", "Наличные", "Contanti", "Espèces", "Nağd", "Nakit", "Готівка", "Қолма-қол"),
    "mg.cardIncome":     tr("Card (cashless)", "Безнал (карта)", "Carta (elettronico)", "Carte (sans espèces)", "Kart (nağdsız)", "Kart (nakitsiz)", "Безгот. (картка)", "Картамен"),
    "mg.expenses":       tr("Expenses", "Расходы", "Spese", "Dépenses", "Xərclər", "Giderler", "Витрати", "Шығындар"),
    "mg.debtToggle":     tr("Mark as debt — not paid from register today", "В долг — не оплачено из кассы сегодня", "Segna come debito — non pagato dalla cassa oggi", "Marquer comme dette — non payé de la caisse aujourd'hui", "Borc kimi qeyd et — bu gün kassadan ödənilməyib", "Borç olarak işaretle — bugün kasadan ödenmedi", "Позначити як борг — не оплачено з каси сьогодні", "Борыш деп белгілеу — бүгін кассадан төленбеді"),
    "mg.inkass":         tr("Cash collection", "Инкассация", "Prelievo cassa", "Encaisse", "İnkassasiya", "Tahsilat", "Інкасація", "Инкассация"),
    "mg.tabSalary":      tr("Salary", "Зарплата", "Stipendio", "Salaire", "Maaş", "Maaş", "Зарплата", "Жалақы"),
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
    "mg.inkReserve":     tr("Collection reserve", "Остаток инкассации", "Riserva versamenti", "Réserve d'encaissement", "İnkassasiya ehtiyatı", "Kasa devri rezervi", "Залишок інкасації", "Инкассация қалдығы"),
    "mg.inkReserveHint": tr("total since the beginning, not just this month", "всего с начала учёта, не только за месяц", "totale dall'inizio, non solo questo mese", "total depuis le début, pas seulement ce mois", "əvvəldən bəri cəmi, təkcə bu ay deyil", "baştan beri toplam, sadece bu ay değil", "усього з початку обліку, не лише за місяць", "есептің басынан барлығы, тек осы ай емес"),
    "mg.closeChecklistWarnTitle":  tr("Closing checklist not done", "Чек-лист закрытия не пройден", "Checklist di chiusura non completata", "Checklist de clôture non terminée", "Bağlanış çek-listi tamamlanmayıb", "Kapanış kontrol listesi tamamlanmadı", "Чек-лист закриття не пройдено", "Жабылу тексеру тізімі толтырылмаған"),
    "mg.closeChecklistWarnBody":   tr("Is everything really closed? The closing checklist for today isn't fully checked off.", "Точно всё закрыто? Чек-лист закрытия на сегодня не отмечен полностью.", "È tutto davvero chiuso? La checklist di chiusura di oggi non è completa.", "Tout est-il vraiment fermé ? La checklist de clôture d'aujourd'hui n'est pas entièrement cochée.", "Həqiqətən hər şey bağlanıb? Bugünkü bağlanış çek-listi tam qeyd olunmayıb.", "Gerçekten her şey kapalı mı? Bugünün kapanış kontrol listesi tam işaretlenmedi.", "Точно все закрито? Чек-лист закриття на сьогодні не відмічено повністю.", "Шынымен бәрі жабылды ма? Бүгінгі жабылу тексеру тізімі толық белгіленбеген."),
    "mg.closeChecklistWarnBack":   tr("Back to checklist", "Вернуться к чек-листу", "Torna alla checklist", "Retour à la checklist", "Çek-listə qayıt", "Kontrol listesine dön", "Повернутися до чек-листа", "Тексеру тізіміне оралу"),
    "mg.closeChecklistWarnAnyway": tr("Close anyway", "Всё равно закрыть", "Chiudi comunque", "Fermer quand même", "Yenə də bağla", "Yine de kapat", "Все одно закрити", "Бәрібір жабу"),
    // C8 (юзер-фидбок 2026-08-15) — мягкий гейт: погашение долгов может увести кассу в минус.
    "mg.debtNegativeWarnTitle": tr("Register will go negative", "Касса уйдёт в минус", "La cassa andrà in negativo", "La caisse passera en négatif", "Kassa mənfiyə düşəcək", "Kasa eksiye düşecek", "Каса піде в мінус", "Касса минусқа кетеді"),
    "mg.debtNegativeWarnBody": tr("Settling the selected debts will push the register balance to {amount}. Continue?", "Погашение выбранных долгов уведёт остаток кассы в минус: {amount}. Продолжить?", "Il saldo dei debiti selezionati porterà la cassa a {amount}. Continuare?", "Le règlement des dettes sélectionnées portera la caisse à {amount}. Continuer ?", "Seçilmiş borcların ödənilməsi kassa qalığını {amount}-a endirəcək. Davam edilsin?", "Seçilen borçların ödenmesi kasa bakiyesini {amount} yapacak. Devam edilsin mi?", "Погашення вибраних боргів приведе касу до {amount}. Продовжити?", "Таңдалған борыштарды өтеу касса қалдығын {amount} дейін түсіреді. Жалғастыру керек пе?"),
    "mg.debtNegativeWarnBack": tr("Back", "Назад", "Indietro", "Retour", "Geri", "Geri", "Назад", "Артқа"),
    "mg.debtNegativeWarnAnyway": tr("Settle anyway", "Погасить всё равно", "Salda comunque", "Régler quand même", "Yenə də ödə", "Yine de öde", "Погасити все одно", "Бәрібір өтеу"),
    "mg.cellInk":        tr("Collection", "Инкасса", "Versamento", "Encaissement", "İnkassasiya", "Kasa devri", "Інкасація", "Инкассация"),
    "mg.saveShift":      tr("Save shift", "Сохранить смену", "Salva turno", "Enregistrer le service", "Növbəni saxla", "Vardiyayı kaydet", "Зберегти зміну", "Ауысымды сақтау"),
    "mg.shiftOpened":    tr("Shift opened", "Смена открыта", "Turno aperto", "Service ouvert", "Növbə açıldı", "Vardiya açıldı", "Зміна відкрита", "Ауысым ашылды"),
    "mg.shiftSaved":     tr("Shift saved", "Смена сохранена", "Turno salvato", "Service enregistré", "Növbə saxlanıldı", "Vardiya kaydedildi", "Зміну збережено", "Ауысым сақталды"),
    "mg.pushCashOpen":     tr("Cash opened", "Касса открыта", "Cassa aperta", "Caisse ouverte", "Kassa açıldı", "Kasa açıldı", "Касу відкрито", "Касса ашылды"),
    "mg.pushShiftOpened":  tr("Shift opened", "Смена открыта", "Turno aperto", "Service ouvert", "Növbə açıldı", "Vardiya açıldı", "Зміну відкрито", "Ауысым ашылды"),
    "mg.pushCashClosed":   tr("Cash closed", "Касса закрыта", "Cassa chiusa", "Caisse fermée", "Kassa bağlandı", "Kasa kapandı", "Касу закрито", "Касса жабылды"),
    "mg.pushShiftClosed":  tr("Shift closed", "Смена закрыта", "Turno chiuso", "Service fermé", "Növbə bağlandı", "Vardiya kapandı", "Зміну закрито", "Ауысым жабылды"),

    // Digest keys (cash close push)
    "mg.dRevenue":      tr("Revenue", "Выручка", "Ricavi", "Recettes", "Gəlir", "Ciro", "Виручка", "Түсім"),
    "mg.dCard":         tr("card", "карта", "carta", "carte", "kart", "kart", "карта", "карта"),
    "mg.dExpense":      tr("Expense", "Расход", "Spesa", "Dépense", "Xərc", "Gider", "Витрата", "Шығыс"),
    "mg.dCollection":   tr("Collection", "Инкасс.", "Versamento", "Encaissement", "İnkassasiya", "Tahsilat", "Інкасація", "Инкассация"),
    "mg.dCash":         tr("Cash", "Касса", "Cassa", "Caisse", "Kassa", "Kasa", "Каса", "Касса"),
    "mg.dHookah":       tr("Hookah", "Кальяны", "Narghilè", "Chicha", "Qəlyan", "Nargile", "Кальяни", "Кальян"),

    // Stash
    "st.shiftSaved":    tr("Shift saved · {p} sold", "Смена сохранена · {p} продано", "Turno salvato · {p} venduti", "Service enregistré · {p} vendus", "Növbə saxlanıldı · {p} satıldı", "Vardiya kaydedildi · {p} satıldı", "Зміну збережено · {p} продано", "Ауысым сақталды · {p} сатылды"),
    "st.shiftSavedFree": tr(" · {f} free", " · {f} беспл.", " · {f} gratis", " · {f} gratuits", " · {f} pulsuz", " · {f} ücretsiz", " · {f} безкошт.", " · {f} тегін"),
    "st.fillRow":       tr("Fill at least one row", "Заполните хотя бы одну строку", "Compila almeno una riga", "Remplissez au moins une ligne", "Ən azı bir sətir doldurun", "En az bir satır doldurun", "Заповніть хоча б один рядок", "Кемінде бір жол толтырыңыз"),
    "st.notInStock":    tr("{b} · {fl} — not in stock", "{b} · {fl} — нет на складе", "{b} · {fl} — non in magazzino", "{b} · {fl} — pas en stock", "{b} · {fl} — anbarda yoxdur", "{b} · {fl} — stokta yok", "{b} · {fl} — немає на складі", "{b} · {fl} — қоймада жоқ"),
    "st.onlyLeft":      tr("{b} · {fl}: only {g}", "{b} · {fl}: только {g}", "{b} · {fl}: solo {g}", "{b} · {fl} : seulement {g}", "{b} · {fl}: yalnız {g}", "{b} · {fl}: sadece {g}", "{b} · {fl}: лише {g}", "{b} · {fl}: тек {g}"),
    "st.writeoffReason": tr("Specify the write-off reason", "Укажите причину списания", "Indica il motivo dello scarico", "Indiquez le motif de la radiation", "Silinmə səbəbini göstərin", "Düşüm nedenini belirtin", "Вкажіть причину списання", "Есептен шығару себебін көрсетіңіз"),
    "st.saved":         tr("Saved: {n}", "Сохранено: {n}", "Salvato: {n}", "Enregistré : {n}", "Saxlanıldı: {n}", "Kaydedildi: {n}", "Збережено: {n}", "Сақталды: {n}"),
    "st.lowStock":      tr("Low stock alert", "Товар заканчивается", "Scorte in esaurimento", "Stock bas", "Stok azalması", "Stok uyarısı", "Сповіщення про запаси", "Қор азаю ескертуі"),
    "st.andMore":       tr("and {n} more", "и ещё {n}", "e altri {n}", "et {n} de plus", "və daha {n}", "ve {n} daha", "і ще {n}", "және тағы {n}"),
    "st.noTypes":       tr("No session types set", "Виды сессий не заданы", "Nessun tipo di sessione impostato", "Aucun type de session défini", "Seans növləri təyin edilməyib", "Seans türü tanımlı değil", "Типи сесій не задані", "Сеанс түрлері белгіленбеген"),
    "st.noTypesHint":   tr("Add them in the dashboard: Settings → Sessions", "Добавьте их в дашборде: Настройки → Сессии", "Aggiungili nella dashboard: Impostazioni → Sessioni", "Ajoutez-les dans le tableau de bord : Réglages → Sessions", "Onları idarə panelində əlavə edin: Tənzimləmələr → Seanslar", "Bunları panoda ekleyin: Ayarlar → Seanslar", "Додайте їх у дашборді: Налаштування → Сесії", "Оларды дашбордта қосыңыз: Параметрлер → Сеанстар"),
    "st.toToday":       tr("To today", "К сегодня", "A oggi", "À aujourd’hui", "Bu günə", "Bugüne", "До сьогодні", "Бүгінге"),
    "st.sold":          tr("Sold", "Продано", "Venduti", "Vendus", "Satıldı", "Satıldı", "Продано", "Сатылды"),
    "st.free":          tr("Free", "Бесплатно", "Gratis", "Gratuits", "Pulsuz", "Ücretsiz", "Безкоштовно", "Тегін"),
    "st.revenue":       tr("Revenue", "Выручка", "Ricavo", "Recette", "Gəlir", "Gelir", "Виручка", "Түсім"),
    "st.tobacco":       tr("Product", "Продукт", "Prodotto", "Produit", "Məhsul", "Ürün", "Продукт", "Өнім"),
    "st.venueLeft":     tr("Tobacco on the floor", "Табака в заведении", "Tabacco nel locale", "Tabac dans l’établissement", "Müəssisədə tütün", "İşletmedeki tütün", "Тютюну в закладі", "Мекемедегі темекі"),
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
    "st.addFlavor":     tr("Add flavor", "Ещё вкус", "Aggiungi gusto", "Ajouter une saveur", "Dad əlavə et", "Aroma ekle", "Додати смак", "Дәм қосу"),
    "st.addBrand":      tr("Add brand", "Ещё бренд", "Aggiungi marca", "Ajouter une marque", "Marka əlavə et", "Marka ekle", "Додати бренд", "Бренд қосу"),
    "st.writeoffReasonField": tr("Write-off reason", "Причина списания", "Motivo dello scarico", "Motif de la radiation", "Silinmə səbəbi", "Düşüm nedeni", "Причина списання", "Есептен шығару себебі"),
    "st.movement":      tr("Movement", "Движение", "Movimento", "Mouvement", "Hərəkət", "Hareket", "Рух", "Қозғалыс"),
    "st.manual":        tr("Manual", "Вручную", "Manuale", "Manuel", "Əl ilə", "Elle", "Вручну", "Қолмен"),
    "st.fromStock":     tr("From stock", "Из склада", "Da magazzino", "Du stock", "Anbardan", "Depodan", "Зі складу", "Қоймадан"),
    "st.takeTotal":     tr("Taking total", "Итого к выдаче", "Totale preso", "Total prélevé", "Cəmi götürülür", "Toplam alınan", "Разом береш", "Барлығы аласың"),
    "st.totalIn":       tr("Total inbound", "Итого приход", "Totale entrata", "Total entrée", "Cəmi mədaxil", "Toplam giriş", "Разом прихід", "Барлық кіріс"),
    "st.totalOut":      tr("Total to issue", "Итого к выдаче", "Totale da emettere", "Total à sortir", "Cəmi verilməyə", "Toplam çıkış", "Разом до видачі", "Барлық беру"),
    "st.totalWriteoff": tr("Total to write off", "Итого к списанию", "Totale da scaricare", "Total à radier", "Cəmi silinməyə", "Toplam düşüm", "Разом до списання", "Барлық есептен шығару"),
    "st.fromWarehouse": tr("From stock", "Со склада", "Da magazzino", "Du stock", "Anbardan", "Depodan", "Зі складу", "Қоймадан"),
    "st.fromVenue":     tr("From venue", "С заведения", "Dal locale", "Du local", "Məkandan", "Mekândan", "Із закладу", "Орыннан"),
    "st.venueWriteoffLabel": tr("Venue write-off", "Списание с заведения", "Scarico locale", "Radiation locale", "Məkandan silinmə", "Mekândan düşüm", "Списання із закладу", "Орыннан есептен шығару"),
    "st.venueWriteoffHint":  tr("Total venue weight, without brand/flavor", "Общий вес в заведении, без бренда и вкуса", "Peso totale nel locale, senza marca/gusto", "Poids total au local, sans marque/saveur", "Məkanda ümumi çəki, marka/dadsız", "Mekânda toplam ağırlık, marka/aroma olmadan", "Загальна вага в закладі, без бренду/смаку", "Орындағы жалпы салмақ, бренд/дәмсіз"),
    "st.venueAvailable":     tr("In venue", "В заведении", "Nel locale", "Au local", "Məkanda", "Mekânda", "У закладі", "Орында"),
    "st.onlyLeftVenue": tr("Only {g} in venue", "В заведении только {g}", "Solo {g} nel locale", "Seulement {g} au local", "Məkanda yalnız {g}", "Mekânda yalnızca {g}", "У закладі лише {g}", "Орында тек {g}"),
    "st.movDeleted":    tr("Movement deleted", "Перемещение удалено", "Movimento eliminato", "Mouvement supprimé", "Hərəkət silindi", "Hareket silindi", "Переміщення видалено", "Қозғалыс жойылды"),
    "st.movDeleteConfirm": tr("Delete this movement? Stock will be restored.", "Удалить перемещение? Остаток вернётся.", "Eliminare il movimento? La giacenza tornerà.", "Supprimer le mouvement ? Le stock sera restauré.", "Hərəkət silinsin? Qalıq bərpa olunacaq.", "Hareketi sil? Stok geri gelecek.", "Видалити переміщення? Залишок повернеться.", "Қозғалысты жою? Қалдық қайтарылады."),
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
    "byCash":     tr("In cash", "Наличными", "In contanti", "En espèces", "Nağdla", "Nakit", "Готівкою", "Қолма-қол"),
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
    "an.atVenue":        tr("At venue", "В заведении", "Nel locale", "À l’établissement", "Məkanda", "Mekânda", "У закладі", "Орында"),
    "an.noHookahShifts": tr("No lounge sessions this month", "Сессий лаунжа в этом месяце нет", "Nessuna sessione lounge questo mese", "Aucune session lounge ce mois", "Bu ay launc seansı yoxdur", "Bu ay lounge seansı yok", "Цього місяця сесій лаунжу немає", "Бұл айда лаунж сеанстары жоқ"),
    "an.comparing":      tr("Comparing with previous month", "Сравнение с прошлым месяцем", "Confronto con il mese scorso", "Comparaison avec le mois dernier", "Keçən ayla müqayisə", "Geçen ay ile karşılaştırma", "Порівняння з минулим місяцем", "Өткен аймен салыстыру"),
    "an.shiftsByDay":    tr("SHIFTS BY DAY", "СМЕНЫ ПО ДНЯМ", "TURNI PER GIORNO", "SERVICES PAR JOUR", "GÜNLƏR ÜZRƏ NÖVBƏLƏR", "GÜNE GÖRE VARDİYALAR", "ЗМІНИ ПО ДНЯХ", "КҮНДЕР БОЙЫНША АУЫСЫМДАР"),
    "an.breakdown":      tr("Breakdown", "Разбивка", "Ripartizione", "Répartition", "Bölgü", "Dağılım", "Розбивка", "Бөліну"),
    "an.byType":         tr("By hookah type", "По видам кальяна", "Per tipo di narghilè", "Par type de chicha", "Qəlyan növünə görə", "Nargile türüne göre", "За видом кальяну", "Кальян түрі бойынша"),
    "an.byCategory":     tr("Free — by category", "Бесплатно — по категориям", "Gratis — per categoria", "Gratuits — par catégorie", "Pulsuz — kateqoriyaya görə", "Ücretsiz — kategoriye göre", "Безкоштовно — за категорією", "Тегін — санат бойынша"),
    "an.balance":        tr("Balance", "Остаток", "Saldo", "Solde", "Qalıq", "Bakiye", "Залишок", "Қалдық"),
    "an.lastIncome":     tr("Last income", "Последний доход", "Ultimo incasso", "Dernier revenu", "Son gəlir", "Son gelir", "Останній дохід", "Соңғы кіріс"),
    "an.tillBalance":    tr("CASH BALANCE", "ОСТАТОК КАССЫ", "SALDO CASSA", "SOLDE CAISSE", "KASSA QALIĞI", "KASA BAKİYESİ", "ЗАЛИШОК КАСИ", "КАССА ҚАЛДЫҒЫ"),
    "an.noShiftData":    tr("No shift data", "Нет данных по сменам", "Nessun dato sui turni", "Aucune donnée de service", "Növbə məlumatı yoxdur", "Vardiya verisi yok", "Немає даних по змінах", "Ауысым деректері жоқ"),
    "an.byDay":          tr("BY DAY", "ПО ДНЯМ", "PER GIORNO", "PAR JOUR", "GÜNLƏR ÜZRƏ", "GÜNE GÖRE", "ПО ДНЯХ", "КҮНДЕР БОЙЫНША"),
    "an.inCol":          tr("In", "Вход", "Entrata", "Entrée", "Giriş", "Giriş", "Вхід", "Кіру"),
    "an.totalInkass":    tr("Total collected", "Всего инкассации", "Totale prelievi", "Total encaissé", "Cəmi inkassasiya", "Toplam tahsilat", "Усього інкасації", "Барлық инкассация"),
    "an.salaryToday":    tr("Accrued salary", "Начислено", "Stipendio maturato", "Salaire couru", "Hesablanmış maaş", "Tahakkuk eden maaş", "Нарахована зарплата", "Есептелген жалақы"),
    "an.noInkass":       tr("No collections", "Инкассаций нет", "Nessun prelievo", "Aucun encaissement", "İnkassasiya yoxdur", "Tahsilat yok", "Інкасацій немає", "Инкассация жоқ"),
    "an.inkNet":         tr("NET", "ИТОГО", "NETTO", "NET", "XALİS", "NET", "НЕТТО", "НЕТТО"),
    "an.cashShort":      tr("Cash", "Нал", "Cont.", "Esp.", "Nağd", "Nakit", "Гот.", "Нақ."),
    "an.cardShort":      tr("Card", "Карта", "Carta", "Carte", "Kart", "Kart", "Карта", "Карта"),
    "an.inkShort":       tr("Collect.", "Инкасс.", "Prelievo", "Encaisse", "İnkass.", "Tahsilat", "Інкас.", "Инкасс."),
    "an.advance":        tr("Advance", "Аванс", "Anticipo", "Avance", "Avans", "Avans", "Аванс", "Аванс"),
    "an.addAdvance":     tr("Add advance", "Добавить аванс", "Aggiungi anticipo", "Ajouter avance", "Avans əlavə et", "Avans ekle", "Додати аванс", "Аванс қосу"),
    "an.debts":          tr("Debts", "Долги", "Debiti", "Dettes", "Borclar", "Borçlar", "Борги", "Борыштар"),
    "an.debtSettleNote": tr("Debt repayment", "Погашение долга", "Rimborso debito", "Remboursement de dette", "Borcun ödənilməsi", "Borç ödemesi", "Погашення боргу", "Борышты өтеу"),
    "an.advanceExceedsRemaining": tr("Advance exceeds what is left to pay: available {avail}", "Аванс больше остатка к выплате: доступно {avail}", "L'anticipo supera il residuo da pagare: disponibile {avail}", "L'avance dépasse le reste à payer : disponible {avail}", "Avans qalan ödəniləcək məbləğdən çoxdur: mövcud {avail}", "Avans kalan ödemeyi aşıyor: mevcut {avail}", "Аванс більший за залишок до виплати: доступно {avail}", "Аванс төленетін қалдықтан көп: қолжетімді {avail}"),
    "an.debtHistory":    tr("Paid debts history", "История погашённых долгов", "Storico debiti pagati", "Historique des dettes payées", "Ödənilmiş borclar tarixçəsi", "Ödenen borç geçmişi", "Історія погашених боргів", "Төленген борыштар тарихы"),
    "an.debtTotalHint":  tr("All open debts, all time", "Все открытые долги, за всё время", "Tutti i debiti aperti, di sempre", "Toutes les dettes ouvertes, depuis toujours", "Bütün açıq borclar, bütün dövr", "Tüm açık borçlar, tüm zamanlar", "Усі відкриті борги, за весь час", "Барлық ашық борыштар, барлық уақыт"),
    "an.debtsNonePeriod": tr("No debts in this period", "За этот период долгов нет", "Nessun debito in questo periodo", "Aucune dette sur cette période", "Bu dövrdə borc yoxdur", "Bu dönemde borç yok", "За цей період боргів немає", "Бұл кезеңде борыш жоқ"),
    "pe.theirShift":     tr("Their shift", "Смена коллеги", "Turno del collega", "Service du collègue", "Həmkarın növbəsi", "Meslektaşın vardiyası", "Зміна колеги", "Әріптестің ауысымы"),

    // AI
    "ai.send":          tr("Send", "Отправить", "Invia", "Envoyer", "Göndər", "Gönder", "Надіслати", "Жіберу"),
    "ai.noReply":       tr("No reply from AI", "Нет ответа от AI", "Nessuna risposta AI", "Pas de réponse AI", "AI cavabı yoxdur", "AI yanıtı yok", "Немає відповіді AI", "AI жауабы жоқ"),
    "ai.noData":        tr("AI couldn't extract data", "AI не смог распознать данные", "AI non ha estratto dati", "L’IA n’a pas pu extraire", "AI məlumat çıxara bilmədi", "AI veri çıkaramadı", "AI не зміг розпізнати дані", "AI деректерді алмады"),
    "ai.err401":        tr("Authorization error — try logging in again", "Ошибка авторизации — попробуйте войти снова", "Errore autorizzazione", "Erreur d’autorisation", "İcazə xətası", "Yetkilendirme hatası", "Помилка авторизації", "Авторизация қатесі"),
    "ai.err403":        tr("AI requires Pro plan or admin activation", "AI требует Pro-план или включение в панели", "AI richiede piano Pro", "L’IA nécessite un plan Pro ou une activation admin", "AI Pro plan tələb edir", "AI Pro plan gerektirir", "AI потребує Pro-плану", "AI Pro жоспарын талап етеді"),
    "ai.err500":        tr("Server error — contact support", "Ошибка сервера — обратитесь в поддержку", "Errore server", "Erreur serveur — contactez le support", "Server xətası", "Sunucu hatası", "Помилка сервера", "Сервер қатесі"),
    "ai.err502":        tr("AI service error — check API key", "Ошибка AI-сервиса — обратитесь в поддержку", "Errore servizio AI", "Erreur service IA — contactez le support", "AI xidmət xətası", "AI servis hatası", "Помилка AI-сервісу", "AI қызмет қатесі"),
    "ai.errGeneric":    tr("AI error", "Ошибка AI", "Errore AI", "Erreur IA", "AI xətası", "AI hatası", "Помилка AI", "AI қатесі"),
    "ai.errOffline":    tr("No internet connection", "Нет соединения с интернетом", "Nessuna connessione a internet", "Pas de connexion internet", "İnternet bağlantısı yoxdur", "İnternet bağlantısı yok", "Немає з'єднання з інтернетом", "Интернет байланысы жоқ"),
    "ai.thinking":      tr("Processing...", "Обрабатываю...", "Elaboro...", "Traitement...", "İşlənir...", "İşleniyor...", "Обробляю...", "Өңдеймін..."),
    "ai.typeMessage":   tr("Type a message...", "Напишите сообщение...", "Scrivi messaggio...", "Tapez un message...", "Mesaj yazın...", "Mesaj yazın...", "Напишіть повідомлення...", "Хабар жазыңыз..."),
    "ai.applied":       tr("Fields filled", "Поля заполнены", "Campi compilati", "Champs remplis", "Sahələr dolduruldu", "Alanlar dolduruldu", "Поля заповнені", "Өрістер толтырылды"),
    "ai.close":         tr("Close", "Закрыть", "Chiudi", "Fermer", "Bağla", "Kapat", "Закрити", "Жабу"),
    "ai.ask":           tr("Ask mise…", "Спроси у mise…", "Chiedi a mise…", "Demandez à mise…", "mise-dən soruş…", "mise'ye sor…", "Запитай у mise…", "mise-ден сұра…"),
    "ai.more":          tr("More", "Подробнее", "Dettagli", "Plus", "Ətraflı", "Daha fazla", "Детальніше", "Толығырақ"),
    "an.pcs":            tr("{n} pcs", "{n} шт", "{n} pz", "{n} pcs", "{n} əd", "{n} adet", "{n} шт", "{n} дана"),
    "an.history":        tr("History", "История", "Cronologia", "Historique", "Tarixçə", "Geçmiş", "Історія", "Тарих"),
    "an.bankProOnly":    tr("Bank connection is a Pro feature", "Подключение банка доступно на тарифе Pro", "Il collegamento bancario è disponibile su Pro", "La connexion bancaire est réservée au forfait Pro", "Bank qoşulması yalnız Pro tarifdə", "Banka bağlantısı yalnızca Pro planda", "Підключення банку доступне на тарифі Pro", "Банкті қосу тек Pro тарифінде"),
    "an.bankProOnlyHint": tr("Upgrade to Pro to see your bank balance and transactions here", "Перейдите на Pro, чтобы видеть баланс и операции банка здесь", "Passa a Pro per vedere qui saldo e movimenti bancari", "Passez à Pro pour voir ici le solde et les opérations bancaires", "Bank balansını və əməliyyatlarını burada görmək üçün Pro-ya keçin", "Banka bakiyenizi ve işlemlerinizi burada görmek için Pro'ya geçin", "Перейдіть на Pro, щоб бачити баланс і операції банку тут", "Банк балансы мен операцияларын мұнда көру үшін Pro-ға өтіңіз"),
    "an.bankConnectCta": tr("Connect your business bank account", "Подключите бизнес-счёт банка", "Collega il tuo conto bancario aziendale", "Connectez votre compte bancaire professionnel", "Biznes bank hesabınızı qoşun", "İşletme banka hesabınızı bağlayın", "Підключіть бізнес-рахунок банку", "Бизнес банк шотыңызды қосыңыз"),
    "an.bankCountry":    tr("Country", "Страна", "Paese", "Pays", "Ölkə", "Ülke", "Країна", "Ел"),
    "an.bankName":       tr("Bank name", "Название банка", "Nome della banca", "Nom de la banque", "Bankın adı", "Banka adı", "Назва банку", "Банк атауы"),
    "an.bankNamePlaceholder": tr("e.g. Revolut, Banco Popolare di Sondrio", "например Revolut, Banco Popolare di Sondrio", "es. Revolut, Banco Popolare di Sondrio", "ex. Revolut, Banco Popolare di Sondrio", "məs. Revolut, Banco Popolare di Sondrio", "örn. Revolut, Banco Popolare di Sondrio", "напр. Revolut, Banco Popolare di Sondrio", "мыс. Revolut, Banco Popolare di Sondrio"),
    "an.bankConnect":    tr("Connect bank", "Подключить банк", "Collega banca", "Connecter la banque", "Bankı qoş", "Bankayı bağla", "Підключити банк", "Банкті қосу"),
    "an.back":           tr("Back", "Назад", "Indietro", "Retour", "Geri", "Geri", "Назад", "Артқа"),
    "an.bankReconsentSoon": tr("Bank access expires in {n} days", "Доступ к банку истекает через {n} дн.", "L'accesso alla banca scade tra {n} giorni", "L'accès bancaire expire dans {n} jours", "Bank girişi {n} gündən sonra bitir", "Banka erişimi {n} gün içinde sona eriyor", "Доступ до банку спливає через {n} дн.", "Банкке қолжетімділік {n} күннен кейін бітеді"),
    "an.bankReconnect":  tr("Reconnect", "Переподключить", "Ricollega", "Reconnecter", "Yenidən qoş", "Yeniden bağla", "Перепідключити", "Қайта қосу"),
    "an.bankBalance":    tr("Balance", "Баланс", "Saldo", "Solde", "Balans", "Bakiye", "Баланс", "Баланс"),
    "an.bankUpdated":    tr("updated {d}", "обновлено {d}", "aggiornato {d}", "mis à jour {d}", "yeniləndi {d}", "güncellendi {d}", "оновлено {d}", "жаңартылды {d}"),
    "an.bankNoTransactions": tr("No transactions yet", "Пока нет операций", "Nessuna operazione ancora", "Aucune opération pour l'instant", "Hələ əməliyyat yoxdur", "Henüz işlem yok", "Поки немає операцій", "Әзірге операциялар жоқ"),

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
    "pe.role.hookah":    tr("Hookah", "Кальянная", "Narghilè", "Chicha", "Qəlyan", "Nargile", "Кальянна", "Кальян"),
    "pe.role.waiter":    tr("Hall", "Зал", "Sala", "Salle", "Zal", "Salon", "Зал", "Зал"),
    "pe.role.host":      tr("Host", "Хостес", "Hostess", "Hôte", "Host", "Host", "Хостес", "Хостес"),
    "pe.role.cleaner":   tr("Cleaning", "Уборка", "Pulizie", "Ménage", "Təmizlik", "Temizlik", "Прибирання", "Тазалау"),

    // People — flash
    "pe.taskNeedTitle":  tr("Enter a title and assignee", "Введите название и исполнителя", "Inserisci titolo e assegnatario", "Saisissez un titre et un assigné", "Başlıq və icraçı daxil edin", "Başlık ve atanan girin", "Введіть назву та виконавця", "Атауы мен орындаушыны енгізіңіз"),
    "pe.noRoleStaff":    tr("No active staff in this role", "Нет активных сотрудников этой роли", "Nessun dipendente attivo per questo ruolo", "Aucun employé actif pour ce rôle", "Bu rolda aktiv işçi yoxdur", "Bu rolde aktif personel yok", "Немає активних співробітників цієї ролі", "Бұл рөлде белсенді қызметкер жоқ"),
    "pe.reportNeedTitle": tr("Enter a title", "Введите заголовок", "Inserisci un titolo", "Saisissez un titre", "Başlıq daxil edin", "Başlık girin", "Введіть заголовок", "Тақырып енгізіңіз"),
    "pe.reportSent":     tr("Request sent", "Заявка отправлена", "Richiesta inviata", "Demande envoyée", "Sorğu göndərildi", "Talep gönderildi", "Заявку надіслано", "Өтініш жіберілді"),
    "pe.convertToTask":  tr("To task", "В задачу", "In attività", "En tâche", "Tapşırığa", "Göreve", "У завдання", "Тапсырмаға"),
    "pe.convertToPurchase": tr("To purchase list", "В закуп", "Nella lista acquisti", "Vers la liste d'achats", "Satınalma siyahısına", "Satın alma listesine", "У список закупівлі", "Сатып алу тізіміне"),
    "pe.reportConverted": tr("Request processed", "Заявка обработана", "Richiesta elaborata", "Demande traitée", "Sorğu işləndi", "Talep işlendi", "Заявку опрацьовано", "Өтініш өңделді"),
    "pe.category":       tr("Category", "Категория", "Categoria", "Catégorie", "Kateqoriya", "Kategori", "Категорія", "Санат"),
    "pe.qty":            tr("Quantity", "Количество", "Quantità", "Quantité", "Miqdar", "Miktar", "Кількість", "Саны"),
    "pe.unit":           tr("Unit", "Единица", "Unità", "Unité", "Vahid", "Birim", "Одиниця", "Бірлік"),
    "pe.pickStaff":      tr("Select an employee", "Выберите сотрудника", "Seleziona un dipendente", "Choisissez un employé", "İşçi seçin", "Personel seçin", "Виберіть співробітника", "Қызметкерді таңдаңыз"),
    "pe.shiftAdded":     tr("Shift added", "Смена добавлена", "Turno aggiunto", "Service ajouté", "Növbə əlavə edildi", "Vardiya eklendi", "Зміну додано", "Ауысым қосылды"),
    "pe.noPrevWeek":     tr("No shifts last week", "На прошлой неделе смен нет", "Nessun turno la settimana scorsa", "Aucun service la semaine dernière", "Keçən həftə növbə yoxdur", "Geçen hafta vardiya yok", "Минулого тижня змін немає", "Өткен аптада ауысым жоқ"),
    "pe.copied":         tr("Copied {n} shifts", "Скопировано смен: {n}", "Copiati {n} turni", "{n} services copiés", "{n} növbə kopyalandı", "{n} vardiya kopyalandı", "Скопійовано змін: {n}", "{n} ауысым көшірілді"),
    "pe.noGeo":          tr("No location access", "Нет доступа к геолокации", "Nessun accesso alla posizione", "Pas d’accès à la localisation", "Məkana giriş yoxdur", "Konum erişimi yok", "Немає доступу до геолокації", "Геолокацияға қол жеткізу жоқ"),
    "pe.outOfZone":      tr("You’re outside the venue", "Вы вне зоны заведения", "Sei fuori dal locale", "Vous êtes hors de l’établissement", "Məkandan kənardasınız", "Mekân dışındasınız", "Ви поза зоною закладу", "Сіз орыннан тыссыз"),
    "pe.checkedIn":      tr("Check-in recorded", "Приход отмечен", "Ingresso registrato", "Arrivée enregistrée", "Gəliş qeyd edildi", "Giriş kaydedildi", "Прихід відмічено", "Келу белгіленді"),
    "pe.swapApproved":   tr("Swap approved", "Обмен одобрен", "Scambio approvato", "Échange approuvé", "Dəyişmə təsdiqləndi", "Takas onaylandı", "Обмін схвалено", "Алмасу мақұлданды"),
    "pe.openShiftFirst": tr("Open a shift in Manager first", "Сначала откройте смену в Manager", "Apri prima un turno in Manager", "Ouvrez d’abord un service dans Manager", "Əvvəlcə Manager-də növbə açın", "Önce Manager’de vardiya açın", "Спочатку відкрийте зміну в Manager", "Алдымен Manager-де ауысым ашыңыз"),
    "pe.addItem":        tr("Add at least one item", "Добавьте хотя бы один пункт", "Aggiungi almeno una voce", "Ajoutez au moins un élément", "Ən azı bir bənd əlavə edin", "En az bir madde ekleyin", "Додайте хоча б один пункт", "Кемінде бір тармақ қосыңыз"),
    "pe.checklistSaved": tr("Checklist saved", "Чек-лист сохранён", "Checklist salvata", "Checklist enregistrée", "Çek-list saxlanıldı", "Kontrol listesi kaydedildi", "Чек-лист збережено", "Чек-парақ сақталды"),
    "pe.needName":       tr("Enter a name", "Введите название", "Inserisci un nome", "Saisissez un nom", "Ad daxil edin", "İsim girin", "Введіть назву", "Атауын енгізіңіз"),
    "pe.saved":          tr("Saved", "Сохранено", "Salvato", "Enregistré", "Saxlanıldı", "Kaydedildi", "Збережено", "Сақталды"),
    "pe.pickShiftPeer":  tr("Pick a shift and a colleague", "Выберите смену и коллегу", "Scegli turno e collega", "Choisissez un service et un collègue", "Növbə və həmkar seçin", "Vardiya ve meslektaş seçin", "Виберіть зміну та колегу", "Ауысым мен әріптесті таңдаңыз"),
    "pe.requestSent":    tr("Request sent", "Запрос отправлен", "Richiesta inviata", "Demande envoyée", "Sorğu göndərildi", "Talep gönderildi", "Запит надіслано", "Сұраныс жіберілді"),
    "pe.swapRequestTitle": tr("Swap request", "Запрос на обмен", "Richiesta di scambio", "Demande d’échange", "Növbə dəyişmə sorğusu", "Vardiya takas talebi", "Запит на обмін", "Ауысым алмасу сұранысы"),
    "pe.swapRequestBody":  tr("{name} is offering a shift swap", "{name} предлагает поменяться сменами", "{name} propone uno scambio di turno", "{name} propose un échange de service", "{name} növbə dəyişməyi təklif edir", "{name} vardiya takası öneriyor", "{name} пропонує обмінятися змінами", "{name} ауысым алмасуды ұсынады"),
    "pe.taskCreated":    tr("Task created", "Задача создана", "Attività creata", "Tâche créée", "Tapşırıq yaradıldı", "Görev oluşturuldu", "Завдання створено", "Тапсырма құрылды"),
    "pe.taskCreatedN":   tr("Task created for {n}", "Задача создана для {n}", "Attività creata per {n}", "Tâche créée pour {n}", "{n} üçün tapşırıq yaradıldı", "{n} için görev oluşturuldu", "Завдання створено для {n}", "{n} үшін тапсырма құрылды"),
    "pe.voiceUnavailable": tr("Voice recognition unavailable", "Распознавание речи недоступно", "Riconoscimento vocale non disponibile", "Reconnaissance vocale indisponible", "Səs tanıma əlçatan deyil", "Ses tanıma kullanılamıyor", "Розпізнавання мови недоступне", "Дауысты тану қолжетімсіз"),
    "pe.voiceEmpty":     tr("No speech detected", "Речь не распознана", "Nessun rilevamento vocale", "Aucune parole détectée", "Səs aşkar edilmədi", "Ses algılanamadı", "Мова не розпізнана", "Сөз анықталмады"),

    // People — задачи
    "pe.reports":        tr("Requests", "Заявки", "Richieste", "Demandes", "Sorğular", "Talepler", "Заявки", "Өтініштер"),
    "pe.reportsN":       tr("Requests · {n}", "Заявки · {n}", "Richieste · {n}", "Demandes · {n}", "Sorğular · {n}", "Talepler · {n}", "Заявки · {n}", "Өтініштер · {n}"),
    "pe.newTask":        tr("New task", "Новая задача", "Nuova attività", "Nouvelle tâche", "Yeni tapşırıq", "Yeni görev", "Нове завдання", "Жаңа тапсырма"),
    "pe.noTasks":        tr("No tasks yet", "Задач пока нет", "Nessuna attività", "Aucune tâche", "Hələ tapşırıq yoxdur", "Henüz görev yok", "Завдань поки немає", "Әзірге тапсырма жоқ"),
    "pe.doneN":          tr("DONE · {n}", "ВЫПОЛНЕННОЕ · {n}", "FATTI · {n}", "TERMINÉS · {n}", "GÖRÜLƏNLƏR · {n}", "TAMAMLANAN · {n}", "ВИКОНАНЕ · {n}", "ОРЫНДАЛҒАН · {n}"),
    "pe.fTitle":         tr("Title", "Название", "Titolo", "Titre", "Başlıq", "Başlık", "Назва", "Атауы"),
    "pe.descOptional":   tr("Description (optional)", "Описание (необязательно)", "Descrizione (facoltativa)", "Description (facultatif)", "Təsvir (istəyə bağlı)", "Açıklama (isteğe bağlı)", "Опис (необов’язково)", "Сипаттама (міндетті емес)"),
    "pe.assignee":       tr("To whom", "Кому", "A chi", "À qui", "Kimə", "Kime", "Кому", "Кімге"),
    "pe.roleSection":    tr("By role", "По цеху", "Per ruolo", "Par rôle", "Rol üzrə", "Role göre", "За цехом", "Цех бойынша"),
    "pe.staffSection":   tr("Individual", "Сотрудник", "Individuale", "Individuel", "Fərdi", "Bireysel", "Окремо", "Жеке"),
    "pe.allRole":        tr("whole dept.", "весь цех", "tutto rep.", "tout le dept.", "bütün şöbə", "tüm departman", "весь цех", "барлық бөлім"),
    "pe.assigneeSection": tr("Assignee", "Исполнитель", "Assegnatario", "Assigné", "İcraçı", "Atanan", "Виконавець", "Орындаушы"),
    "pe.priority":       tr("Priority", "Приоритет", "Priorità", "Priorité", "Prioritet", "Öncelik", "Пріоритет", "Басымдық"),
    "pe.newTaskTitle":   tr("New task", "Новая задача", "Nuova attività", "Nouvelle tâche", "Yeni tapşırıq", "Yeni görev", "Нове завдання", "Жаңа тапсырма"),
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
    "pe.rt.notice":      tr("Notice", "Замечание", "Segnalazione", "Remarque", "Qeyd", "Uyarı", "Зауваження", "Ескерту"),
    "pe.rt.breakdown":   tr("Breakdown", "Поломка", "Guasto", "Panne", "Nasazlıq", "Arıza", "Поломка", "Ақаулық"),
    "pe.rt.other":       tr("Other", "Другое", "Altro", "Autre", "Digər", "Diğer", "Інше", "Басқа"),

    // People — зарплата
    "pe.noSalary":       tr("No salary data", "Нет данных по зарплате", "Nessun dato sullo stipendio", "Aucune donnée de salaire", "Maaş məlumatı yoxdur", "Maaş verisi yok", "Немає даних по зарплаті", "Жалақы деректері жоқ"),
    "pe.toPay":          tr("To pay", "К выплате", "Da pagare", "À payer", "Ödəniləcək", "Ödenecek", "До виплати", "Төленеді"),
    "pe.cardShort":      tr("card", "карта", "carta", "carte", "kart", "kart", "картка", "карта"),
    "pe.markPaid":       tr("Mark as paid", "Отметить выплату", "Segna come pagato", "Marquer comme payé", "Ödənilmiş kimi qeyd et", "Ödendi olarak işaretle", "Позначити виплату", "Төлемді белгілеу"),
    "pe.paidStatus":     tr("Paid", "Выплачено", "Pagato", "Payé", "Ödənildi", "Ödendi", "Виплачено", "Төленді"),
    "pe.paidOn":         tr("Paid {date}", "Выплачено {date}", "Pagato il {date}", "Payé le {date}", "{date} ödənildi", "{date} ödendi", "Виплачено {date}", "{date} төленді"),
    "pe.oweAmount":      tr("Owed {amount}", "Осталось {amount}", "Dovuti {amount}", "Restant {amount}", "Qalıq {amount}", "Kalan {amount}", "Залишилось {amount}", "Қалды {amount}"),
    "pe.notPaidYet":     tr("Not paid yet", "Не выплачено", "Non ancora pagato", "Pas encore payé", "Hələ ödənilməyib", "Henüz ödenmedi", "Ще не виплачено", "Әлі төленбеді"),
    "pe.debtTitle":      tr("Salary debt", "Задолженность по ЗП", "Debito stipendi", "Dette de salaire", "Maaş borcu", "Maaş borcu", "Заборгованість по ЗП", "Жалақы бойынша борыш"),
    "pe.debtHint":       tr("Unpaid balance from past closed months", "Неоплаченный остаток за прошлые закрытые месяцы", "Saldo non pagato dei mesi chiusi passati", "Solde impayé des mois clos précédents", "Keçmiş bağlanmış aylardan ödənilməmiş qalıq", "Geçmiş kapanmış aylardan ödenmemiş bakiye", "Несплачений залишок за минулі закриті місяці", "Өткен жабылған айлардан төленбеген қалдық"),
    "pe.accruedToday":   tr("Accrued so far", "Начислено на сегодня", "Maturato finora", "Cumulé à ce jour", "Bu günə hesablanıb", "Bugüne kadar tahakkuk", "Нараховано на сьогодні", "Бүгінге дейін есептелді"),
    "pe.accruedTodayHint": tr("Month is not closed yet — grows daily", "Месяц ещё не закрыт — растёт по дням", "Il mese non è ancora chiuso — cresce ogni giorno", "Le mois n’est pas encore clos — augmente chaque jour", "Ay hələ bağlanmayıb — gündəlik artır", "Ay henüz kapanmadı — günlük artıyor", "Місяць ще не закрито — зростає щодня", "Ай әлі жабылған жоқ — күн сайын өседі"),
    "pe.paymentAmount":  tr("Amount", "Сумма", "Importo", "Montant", "Məbləğ", "Tutar", "Сума", "Сома"),
    "pe.paymentMethod":  tr("Method", "Способ", "Metodo", "Méthode", "Üsul", "Yöntem", "Спосіб", "Тәсіл"),
    "pe.methodCash":     tr("Cash", "Наличные", "Contanti", "Espèces", "Nağd", "Nakit", "Готівка", "Қолма-қол"),
    "pe.methodCard":     tr("Card", "Карта", "Carta", "Carte", "Kart", "Kart", "Картка", "Карта"),
    "pe.paymentDate":    tr("Date", "Дата", "Data", "Date", "Tarix", "Tarih", "Дата", "Күні"),
    "pe.paymentNote":    tr("Note", "Заметка", "Nota", "Note", "Qeyd", "Not", "Нотатка", "Ескертпе"),
    "pe.savePayment":    tr("Save payment", "Сохранить выплату", "Salva pagamento", "Enregistrer le paiement", "Ödənişi yadda saxla", "Ödemeyi kaydet", "Зберегти виплату", "Төлемді сақтау"),
    "pe.paymentSaved":   tr("Payment saved", "Выплата сохранена", "Pagamento salvato", "Paiement enregistré", "Ödəniş yadda saxlanıldı", "Ödeme kaydedildi", "Виплату збережено", "Төлем сақталды"),
    "pe.insufficientInkassation": tr("Not enough cash in the register for {date}: available {avail}", "Недостаточно инкассации за {date}: доступно {avail}", "Cassa insufficiente per il {date}: disponibile {avail}", "Caisse insuffisante pour le {date} : disponible {avail}", "{date} üçün kassada kifayət qədər nağd pul yoxdur: mövcud {avail}", "{date} için kasada yeterli nakit yok: mevcut {avail}", "Недостатньо інкасації за {date}: доступно {avail}", "{date} үшін кассада қолма-қол ақша жеткіліксіз: қолжетімді {avail}"),
    "pe.insufficientInkassationPool": tr("Not enough in the shared cash pool: available {avail}", "Недостаточно в общей инкассации: доступно {avail}", "Cassa comune insufficiente: disponibile {avail}", "Caisse commune insuffisante : disponible {avail}", "Ümumi kassada kifayət qədər vəsait yoxdur: mövcud {avail}", "Ortak kasada yeterli bakiye yok: mevcut {avail}", "Недостатньо в загальній інкасації: доступно {avail}", "Жалпы кассада қаражат жеткіліксіз: қолжетімді {avail}"),

    // People — смены / явка / обмены
    "pe.swaps":          tr("Swaps", "Обмены", "Scambi", "Échanges", "Dəyişmələr", "Takaslar", "Обміни", "Алмасулар"),
    "pe.onShift":        tr("You’re on shift", "Вы на смене", "Sei in turno", "Vous êtes en service", "Növbədəsiniz", "Vardiyadasınız", "Ви на зміні", "Сіз ауысымдасыз"),
    "pe.arrivedAt":      tr("Arrived at {t}", "Приход в {t}", "Arrivo alle {t}", "Arrivée à {t}", "Gəliş {t}", "Giriş {t}", "Прихід о {t}", "Келу {t}"),
    "pe.lateMin":        tr("Late +{n} min", "Опоздание +{n} мин", "Ritardo +{n} min", "Retard +{n} min", "Gecikmə +{n} dəq", "Gecikme +{n} dk", "Запізнення +{n} хв", "Кешігу +{n} мин"),
    "pe.iCame":          tr("I’m here", "Я на месте", "Sono arrivato", "Je suis arrivé", "Gəldim", "Geldim", "Я прийшов", "Мен келдім"),
    "pe.noScheduledShift": tr("No shift scheduled today", "Смена не назначена на сегодня", "Nessun turno programmato oggi", "Aucun service prévu aujourd’hui", "Bu gün üçün növbə təyin edilməyib", "Bugün için vardiya atanmadı", "Зміну на сьогодні не призначено", "Бүгінге ауысым тағайындалмаған"),
    "pe.noScheduledShiftHint": tr("Ask the manager to add you to the schedule", "Обратись к менеджеру, чтобы тебя внесли в график", "Chiedi al manager di inserirti nel programma", "Demande au manager de t’ajouter au planning", "Menecerdən səni qrafikə əlavə etməsini xahiş et", "Yöneticiden seni çalışma planına eklemesini iste", "Попроси менеджера внести тебе в графік", "Менеджерден графикке қосуын сұра"),
    "pe.historyCaps":    tr("HISTORY", "ИСТОРИЯ", "CRONOLOGIA", "HISTORIQUE", "TARİXÇƏ", "GEÇMİŞ", "ІСТОРІЯ", "ТАРИХ"),
    "pe.todayCaps":      tr("TODAY", "СЕГОДНЯ", "OGGI", "AUJOURD’HUI", "BU GÜN", "BUGÜN", "СЬОГОДНІ", "БҮГІН"),
    "pe.notCame":        tr("absent", "отсутствует", "assente", "absent", "gəlmədi", "gelmedi", "не прийшов", "келмеді"),
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
    "pe.checklists":     tr("Audits", "Аудиты", "Audit", "Audits", "Auditlər", "Denetimler", "Аудити", "Аудиттер"),
    "pe.auditTab":       tr("Checks", "Проверки", "Controlli", "Contrôles", "Yoxlamalar", "Kontroller", "Перевірки", "Тексерулер"),
    "pe.checklistTemplates": tr("Templates", "Шаблоны", "Modelli", "Modèles", "Şablonlar", "Şablonlar", "Шаблони", "Үлгілер"),
    "pe.verification":   tr("Verification", "Верификация", "Verifica", "Vérification", "Yoxlama", "Doğrulama", "Верифікація", "Верификация"),
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
    "pe.checklistOpenDone":  tr("Opening done", "Открытие готово", "Apertura completata", "Ouverture terminée", "Açılış hazırdır", "Açılış tamamlandı", "Відкриття готове", "Ашылу дайын"),
    "pe.checklistCloseDone": tr("Closing done", "Закрытие готово", "Chiusura completata", "Fermeture terminée", "Bağlanış hazırdır", "Kapanış tamamlandı", "Закриття готове", "Жабылу дайын"),
    "pe.historyEmpty":   tr("History is empty", "История пуста", "Cronologia vuota", "Historique vide", "Tarixçə boşdur", "Geçmiş boş", "Історія порожня", "Тарих бос"),
    "pe.allDone":        tr("All done", "Всё выполнено", "Tutto fatto", "Tout est fait", "Hamısı edildi", "Hepsi tamam", "Усе виконано", "Бәрі орындалды"),

    // Аудиты v1 (разовые проверки, фото на пункт, статистика)
    "pe.shiftTab":       tr("Shift", "Смена", "Turno", "Service", "Növbə", "Vardiya", "Зміна", "Ауысым"),
    "pe.audits":         tr("Audits", "Аудиты", "Audit", "Audits", "Auditlər", "Denetimler", "Аудити", "Аудиттер"),
    "pe.statistics":     tr("Statistics", "Статистика", "Statistiche", "Statistiques", "Statistika", "İstatistik", "Статистика", "Статистика"),
    "pe.newAuditTemplate": tr("New audit", "Новый аудит", "Nuovo audit", "Nouvel audit", "Yeni audit", "Yeni denetim", "Новий аудит", "Жаңа аудит"),
    "pe.newAudit":       tr("New audit", "Новая проверка", "Nuovo audit", "Nouvel audit", "Yeni audit", "Yeni denetim", "Нова перевірка", "Жаңа тексеру"),
    "pe.launch":         tr("Launch", "Запустить", "Avvia", "Lancer", "Başlat", "Başlat", "Запустити", "Іске қосу"),
    "pe.noRunYet":       tr("Not launched yet", "Ещё не запущен", "Non ancora avviato", "Pas encore lancé", "Hələ başlanmayıb", "Henüz başlatılmadı", "Ще не запущено", "Әлі іске қосылмаған"),

    // Восьмёрка (обход-восьмёрка, HoReCa floor-walk)
    "pe.walks":              tr("Walk", "Восьмёрка", "Giro", "Tournée", "Gəzinti", "Tur", "Обхід", "Аралау"),
    "pe.newWalkTemplate":    tr("New walk", "Новая восьмёрка", "Nuovo giro", "Nouvelle tournée", "Yeni gəzinti", "Yeni tur", "Новий обхід", "Жаңа аралау"),
    "pe.walkBlocksN":        tr("{n} blocks", "{n} блоков", "{n} blocchi", "{n} blocs", "{n} blok", "{n} blok", "{n} блоків", "{n} блок"),
    "pe.walkStart":          tr("Start", "Начать", "Avvia", "Démarrer", "Başla", "Başla", "Почати", "Бастау"),
    "pe.walkTitleLabel":     tr("Name", "Название", "Nome", "Nom", "Ad", "Ad", "Назва", "Атауы"),
    "pe.walkTitlePh":        tr("e.g. Manager's walk", "например: Восьмёрка менеджера", "es. Giro del manager", "ex. Tournée du manager", "məs. Menecerin gəzintisi", "örn. Yönetici turu", "напр. Обхід менеджера", "мыс. Менеджер аралауы"),
    "pe.walkTargetSelf":     tr("For myself", "Себе", "Per me", "Pour moi", "Özüm üçün", "Kendime", "Собі", "Өзіме"),
    "pe.walkPauseMode":      tr("Timer between blocks", "Таймер между блоками", "Timer tra blocchi", "Minuteur entre blocs", "Bloklar arası taymer", "Bloklar arası zamanlayıcı", "Таймер між блоками", "Блоктар арасы таймер"),
    "pe.walkPauseModePause": tr("Pauses", "С паузой", "In pausa", "En pause", "Fasilə ilə", "Duraklamalı", "З паузою", "Кідіріспен"),
    "pe.walkPauseModeContinuous": tr("Continuous", "Непрерывно", "Continuo", "Continu", "Fasiləsiz", "Kesintisiz", "Безперервно", "Үздіксіз"),
    "pe.walkAddBlock":       tr("Add block", "Добавить блок", "Aggiungi blocco", "Ajouter un bloc", "Blok əlavə et", "Blok ekle", "Додати блок", "Блок қосу"),
    "pe.walkBlockPh":        tr("Block (e.g. Hall)", "Блок (напр. Зал)", "Blocco (es. Sala)", "Bloc (ex. Salle)", "Blok (məs. Zal)", "Blok (örn. Salon)", "Блок (напр. Зал)", "Блок (мыс. Зал)"),
    "pe.walkAddCategory":    tr("Add category", "Добавить категорию", "Aggiungi categoria", "Ajouter une catégorie", "Kateqoriya əlavə et", "Kategori ekle", "Додати категорію", "Санат қосу"),
    "pe.walkCategoryPh":     tr("Category (e.g. Process)", "Категория (напр. Процесс)", "Categoria (es. Processo)", "Catégorie (ex. Processus)", "Kateqoriya (məs. Proses)", "Kategori (örn. Süreç)", "Категорія (напр. Процес)", "Санат (мыс. Процесс)"),
    "pe.walkAddItem":        tr("Add item", "Добавить пункт", "Aggiungi voce", "Ajouter un point", "Bənd əlavə et", "Madde ekle", "Додати пункт", "Тармақ қосу"),
    "pe.walkItemPh":         tr("Item (e.g. Table is clean)", "Пункт (напр. Стол чистый)", "Voce (es. Tavolo pulito)", "Point (ex. Table propre)", "Bənd (məs. Masa təmizdir)", "Madde (örn. Masa temiz)", "Пункт (напр. Стіл чистий)", "Тармақ (мыс. Үстел таза)"),
    "pe.walkFinish":         tr("Finish", "Завершить", "Termina", "Terminer", "Bitir", "Bitir", "Завершити", "Аяқтау"),
    "pe.walkFinishConfirm":  tr("Finish the walk? Unchecked items will be marked as not done.", "Завершить обход? Неотмеченные пункты уйдут как «не сделано».", "Terminare il giro? Le voci non spuntate saranno segnate come non fatte.", "Terminer la tournée ? Les points non cochés seront marqués comme non faits.", "Gəzinti bitsin? Qeyd olunmayan bəndlər «edilmədi» kimi qeyd olunacaq.", "Tur bitsin mi? İşaretlenmemiş maddeler \"yapılmadı\" olarak işaretlenecek.", "Завершити обхід? Невідмічені пункти підуть як «не зроблено».", "Аралау аяқталсын ба? Белгіленбеген тармақтар «орындалмады» болып қалады."),
    "pe.walkPaused":         tr("Paused", "Пауза", "In pausa", "En pause", "Fasilədə", "Duraklatıldı", "Пауза", "Кідіріс"),
    "pe.walkActive":         tr("In progress", "В процессе", "In corso", "En cours", "Davam edir", "Devam ediyor", "У процесі", "Орындалуда"),
    "pe.walkSteps":          tr("steps", "шагов", "passi", "pas", "addım", "adım", "кроків", "қадам"),
    "pe.walkStartWalk":      tr("Start walk", "Начать обход", "Avvia il giro", "Démarrer la tournée", "Gəzintini başlat", "Turu başlat", "Почати обхід", "Аралауды бастау"),
    "pe.walkBackToBlocks":   tr("All blocks", "Все блоки", "Tutti i blocchi", "Tous les blocs", "Bütün bloklar", "Tüm bloklar", "Усі блоки", "Барлық блоктар"),
    "pe.needCheckInFirst": tr("Check in first to mark items", "Сначала отметьтесь на смене", "Registra prima la tua presenza", "Pointez d’abord votre présence", "Əvvəlcə növbəyə qeydiyyatdan keçin", "Önce vardiyaya giriş yapın", "Спочатку відмітьтеся на зміні", "Алдымен ауысымға белгі қойыңыз"),
    "pe.reportProblem":  tr("Report a problem", "Сообщить о проблеме", "Segnala un problema", "Signaler un problème", "Problem barədə bildirin", "Sorun bildir", "Повідомити про проблему", "Мәселе туралы хабарлау"),
    "pe.photoRequired":  tr("Photo required", "Требуется фото", "Foto richiesta", "Photo requise", "Foto tələb olunur", "Fotoğraf gerekli", "Потрібне фото", "Фото қажет"),
    "pe.itemNote":       tr("Comment", "Комментарий", "Commento", "Commentaire", "Şərh", "Yorum", "Коментар", "Пікір"),
    "pe.auditDone":      tr("Audit complete", "Аудит завершён", "Audit completato", "Audit terminé", "Audit tamamlandı", "Denetim tamamlandı", "Аудит завершено", "Аудит аяқталды"),
    "pe.assignTaskHint": tr("Assign a task to yourself or a colleague", "Поставьте задачу себе или коллеге", "Assegna un’attività a te o a un collega", "Attribuez une tâche à vous ou à un collègue", "Özünüzə və ya həmkarınıza tapşırıq verin", "Kendinize veya bir meslektaşa görev atayın", "Поставте завдання собі або колезі", "Өзіңізге не әріптесіңізге тапсырма беріңіз"),
    "pe.reportHint":     tr("Report a breakdown or suggestion", "Сообщите о поломке или предложении", "Segnala un guasto o un suggerimento", "Signalez une panne ou une suggestion", "Nasazlıq və ya təklif bildirin", "Bir arıza veya öneri bildirin", "Повідомте про поломку чи пропозицію", "Бұзылу не ұсыныс туралы хабарлаңыз"),
    "pe.itemsAddedInDash": tr("Items are added in the dashboard → Menu", "Позиции добавляются в дашборде → Меню", "Le voci si aggiungono nella dashboard → Menu", "Les articles s’ajoutent dans le tableau de bord → Menu", "Mövqelər idarə panelində → Menyu əlavə edilir", "Ürünler panelden → Menü eklenir", "Позиції додаються в дашборді → Меню", "Позициялар басқару тақтасында → Мәзір қосылады"),
    "pe.noNotifsHint":   tr("Updates on shifts, tasks and audits will appear here", "Здесь появятся события по сменам, задачам и проверкам", "Qui appariranno aggiornamenti su turni, attività e audit", "Les nouvelles des services, tâches et audits apparaîtront ici", "Növbələr, tapşırıqlar və yoxlamalar üzrə xəbərlər burada görünəcək", "Vardiya, görev ve denetim güncellemeleri burada görünecek", "Тут з’являтимуться події щодо змін, завдань і перевірок", "Ауысым, тапсырма және тексеру жаңалықтары осында шығады"),
    "pe.disEmptyHint":   tr("Lateness is tracked automatically when staff check in with “I’m here”", "Опоздания считаются автоматически по отметке «Я здесь»", "I ritardi si calcolano automaticamente al check-in «Sono qui»", "Les retards sont suivis automatiquement via le pointage « Je suis là »", "“Buradayam” qeydi ilə gecikmələr avtomatik hesablanır", "Gecikmeler “Buradayım” işaretiyle otomatik izlenir", "Запізнення рахуються автоматично за відміткою «Я тут»", "«Мен осындамын» белгісі бойынша кешігу автоматты есептеледі"),
    "pe.auditHistory":   tr("History", "История", "Cronologia", "Historique", "Tarixçə", "Geçmiş", "Історія", "Тарих"),
    "pe.auditHistoryEmpty": tr("No runs in the last 30 days", "Нет прогонов за 30 дней", "Nessuna esecuzione negli ultimi 30 giorni", "Aucune exécution sur 30 jours", "Son 30 gündə keçid yoxdur", "Son 30 günde çalıştırma yok", "Немає проходжень за 30 днів", "Соңғы 30 күнде өту жоқ"),
    "pe.auditReport":    tr("Report", "Отчёт", "Report", "Rapport", "Hesabat", "Rapor", "Звіт", "Есеп"),
    "pe.resultFail":     tr("Violation", "Нарушение", "Violazione", "Non-conformité", "Pozuntu", "İhlal", "Порушення", "Бұзушылық"),
    "pe.notChecked":     tr("Not checked", "Не проверено", "Non verificato", "Non vérifié", "Yoxlanmayıb", "Kontrol edilmedi", "Не перевірено", "Тексерілмеген"),
    "pe.notifications":  tr("Notifications", "Уведомления", "Notifiche", "Notifications", "Bildirişlər", "Bildirimler", "Сповіщення", "Хабарландырулар"),
    "pe.noNotifs":       tr("Quiet for now — no notifications", "Пока тихо — уведомлений нет", "Per ora tutto tranquillo — nessuna notifica", "Calme pour l’instant — aucune notification", "Hələlik sakitdir — bildiriş yoxdur", "Şimdilik sessiz — bildirim yok", "Поки тихо — сповіщень немає", "Әзірге тыныш — хабарландыру жоқ"),
    "pe.clearAllNotifs": tr("Clear all", "Очистить всё", "Cancella tutto", "Tout effacer", "Hamısını təmizlə", "Tümünü temizle", "Очистити все", "Барлығын тазалау"),
    "pe.clearAllNotifsConfirm": tr("Delete all notifications?", "Удалить все уведомления?", "Eliminare tutte le notifiche?", "Supprimer toutes les notifications ?", "Bütün bildirişlər silinsin?", "Tüm bildirimler silinsin mi?", "Видалити всі сповіщення?", "Барлық хабарландыруларды жою керек пе?"),
    "pe.linkExistingTask": tr("There is already an open task for this item", "Уже есть открытая задача по этому пункту", "C’è già un’attività aperta per questo punto", "Il existe déjà une tâche ouverte pour cet élément", "Bu bənd üzrə artıq açıq tapşırıq var", "Bu madde için açık görev zaten var", "Уже є відкрите завдання за цим пунктом", "Бұл тармақ бойынша ашық тапсырма бар"),
    "pe.openExisting":   tr("Open it", "Открыть её", "Aprila", "L’ouvrir", "Onu aç", "Aç", "Відкрити", "Ашу"),
    "pe.pick":           tr("Pick", "Выбрать", "Scegli", "Choisir", "Seç", "Seç", "Обрати", "Таңдау"),
    "pe.recurrenceLabel":   tr("Repeat", "Повтор", "Ripeti", "Répéter", "Təkrar", "Tekrar", "Повтор", "Қайталау"),
    "pe.recurrenceNone":    tr("Does not repeat", "Не повторять", "Non ripetere", "Ne pas répéter", "Təkrarlanmır", "Tekrarlanmıyor", "Не повторювати", "Қайталанбайды"),
    "pe.recurrenceDaily":   tr("Every day", "Каждый день", "Ogni giorno", "Chaque jour", "Hər gün", "Her gün", "Щодня", "Күн сайын"),
    "pe.recurrenceWeekly":  tr("By weekday", "По дням недели", "Per giorno della settimana", "Par jour de semaine", "Həftənin günləri üzrə", "Haftanın günlerine göre", "За днями тижня", "Апта күндері бойынша"),
    "pe.recurrenceMonthly": tr("Once a month", "Раз в месяц", "Una volta al mese", "Une fois par mois", "Ayda bir dəfə", "Ayda bir kez", "Раз на місяць", "Айына бір рет"),
    "pe.dayOfMonth":     tr("Day of month", "День месяца", "Giorno del mese", "Jour du mois", "Ayın günü", "Ayın günü", "День місяця", "Ай күні"),
    "pe.dayOfMonthSummary": tr("{n} of the month", "{n} числа месяца", "Il giorno {n}", "Le {n} du mois", "ayın {n}-i", "ayın {n}'i", "{n} числа місяця", "айдың {n}-і"),
    "pe.wdSun":          tr("Su", "Вс", "Do", "Di", "B", "Pz", "Нд", "Жс"),
    "pe.wdMon":          tr("Mo", "Пн", "Lu", "Lu", "B.e", "Pt", "Пн", "Дс"),
    "pe.wdTue":          tr("Tu", "Вт", "Ma", "Ma", "Ç.a", "Sa", "Вт", "Сс"),
    "pe.wdWed":          tr("We", "Ср", "Me", "Me", "Ç", "Ça", "Ср", "Ср"),
    "pe.wdThu":          tr("Th", "Чт", "Gi", "Je", "C.a", "Pe", "Чт", "Бс"),
    "pe.wdFri":          tr("Fr", "Пт", "Ve", "Ve", "C", "Cu", "Пт", "Жм"),
    "pe.wdSat":          tr("Sa", "Сб", "Sa", "Sa", "Ş", "Ct", "Сб", "Сн"),
    "pe.addPhoto":       tr("Add photo", "Добавить фото", "Aggiungi foto", "Ajouter une photo", "Foto əlavə et", "Fotoğraf ekle", "Додати фото", "Фото қосу"),
    "pe.targetScope":    tr("Assign to", "Кому назначено", "Assegna a", "Assigner à", "Kimə təyin edilib", "Kime atandı", "Кому призначено", "Кімге тағайындалды"),
    "pe.targetRole":     tr("By section", "По цеху", "Per reparto", "Par poste", "Sahə üzrə", "Bölüme göre", "За цехом", "Цех бойынша"),
    "pe.targetStaff":    tr("Specific person", "Сотруднику", "Persona specifica", "Personne précise", "Konkret şəxsə", "Belirli kişiye", "Конкретній людині", "Белгілі адамға"),
    "pe.targetVenue":    tr("Whole shift", "Вся смена", "Tutto il turno", "Tout le service", "Bütün növbə", "Tüm vardiya", "Уся зміна", "Барлық ауысым"),
    "pe.auditTitle":     tr("Audit name", "Название проверки", "Nome audit", "Nom de l’audit", "Audit adı", "Denetim adı", "Назва перевірки", "Тексеру атауы"),
    "pe.requiresPhoto":  tr("Requires photo", "Требует фото", "Richiede foto", "Photo requise", "Foto tələb edir", "Fotoğraf gerektirir", "Потребує фото", "Фото талап етеді"),
    "pe.statsCompletionRate": tr("Completion rate (30 days)", "% выполнения (30 дней)", "Tasso completamento (30 giorni)", "Taux de réalisation (30 j)", "Tamamlanma (30 gün)", "Tamamlanma oranı (30 gün)", "% виконання (30 днів)", "Орындалу % (30 күн)"),
    "pe.statsTopViolations": tr("Frequent violations", "Частые нарушения", "Violazioni frequenti", "Violations fréquentes", "Tez-tez pozuntular", "Sık ihlaller", "Часті порушення", "Жиі бұзушылықтар"),
    "pe.statsStaffRating": tr("Completion rating", "Рейтинг по выполнению", "Classifica completamento", "Classement de réalisation", "Yerinə yetirmə reytinqi", "Tamamlama sıralaması", "Рейтинг виконання", "Орындау рейтингі"),
    "pe.statsNoData":    tr("Not enough data yet", "Пока недостаточно данных", "Dati non sufficienti", "Données insuffisantes", "Hələ kifayət qədər məlumat yoxdur", "Henüz yeterli veri yok", "Поки недостатньо даних", "Әзірге деректер жеткіліксіз"),
    "pe.statsAvgDuration": tr("Avg. duration", "Среднее время", "Durata media", "Durée moyenne", "Orta müddət", "Ortalama süre", "Середній час", "Орташа уақыт"),
    "pe.statsRunsCount":   tr("Walks (30d)", "Обходов за 30 дней", "Giri (30gg)", "Tournées (30j)", "Gəzintilər (30 gün)", "Turlar (30g)", "Обходів за 30 днів", "30 күндегі аралаулар"),
    "pe.walkConductedBy":  tr("Conducted by", "Кто проводил", "Effettuato da", "Effectué par", "Kim keçirdi", "Kim yaptı", "Хто проводив", "Кім жүргізді"),
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
    "pe.callWaiter":     tr("Waiter requested", "Зовут официанта", "Chiamano un cameriere", "Appel d’un serveur", "Ofisiant çağırırlar", "Garson çağrılıyor", "Кличуть офіціанта", "Даяшы шақыруда"),
    "pe.callCoal":       tr("Coals requested", "Просят угли", "Chiedono carboni", "Charbons demandés", "Kömür istəyirlər", "Kömür isteniyor", "Просять вугілля", "Көмір сұрап жатыр"),
    "pe.callWater":      tr("Water requested", "Просят воду", "Chiedono acqua", "Eau demandée", "Su istəyirlər", "Su isteniyor", "Просять воду", "Су сұрап жатыр"),
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
    "ob.feat8":          tr("Lounge sessions", "Сессии лаунжа", "Sessioni lounge", "Sessions lounge", "Launc seansları", "Lounge seansları", "Сесії лаунжу", "Лаунж сеанстары"),
    "ob.scanTitle":      tr("Scan the venue QR", "Отсканируйте QR заведения", "Scansiona il QR del locale", "Scannez le QR de l’établissement", "Məkanın QR-ını skan edin", "Mekân QR’ını tarayın", "Відскануйте QR закладу", "Орынның QR кодын сканерлеңіз"),
    "ob.scanHint":       tr("The owner shows your personal QR in the Mise dashboard, “Access” section.", "Индивидуальный QR-код вам покажет владелец — в дашборде Mise, раздел «Доступ».", "Il proprietario mostra il tuo QR personale nella dashboard Mise, sezione “Accesso”.", "Le propriétaire montre votre QR personnel dans le tableau de bord Mise, section « Accès ».", "Şəxsi QR-ı sahib Mise idarə panelində, «Giriş» bölməsində göstərir.", "Kişisel QR’ınızı sahibi Mise panosunda “Erişim” bölümünde gösterir.", "Власник покаже ваш персональний QR у дашборді Mise, розділ «Доступ».", "Жеке QR-ды иесі Mise дашбордында, «Қол жеткізу» бөлімінде көрсетеді."),
    "ob.qrInvalid":      tr("Not a Mise QR code. Try again.", "Неверный QR Mise. Попробуйте снова.", "QR Mise non valido. Riprova.", "QR Mise invalide. Réessayez.", "Yanlış Mise QR-ı. Yenidən cəhd edin.", "Geçersiz Mise QR’ı. Tekrar deneyin.", "Невірний QR Mise. Спробуйте ще раз.", "Жарамсыз Mise QR-ы. Қайта көріңіз."),
    "ob.noCamera":       tr("No camera access. Allow it in Settings → Mise → Camera.", "Нет доступа к камере. Разрешите его в Настройках → Mise → Камера.", "Nessun accesso alla fotocamera. Consentilo in Impostazioni → Mise → Fotocamera.", "Pas d’accès à la caméra. Autorisez-le dans Réglages → Mise → Caméra.", "Kameraya giriş yoxdur. Tənzimləmələr → Mise → Kamera-da icazə verin.", "Kamera erişimi yok. Ayarlar → Mise → Kamera’dan izin verin.", "Немає доступу до камери. Дозвольте в Налаштування → Mise → Камера.", "Камераға қол жеткізу жоқ. Параметрлер → Mise → Камера ішінде рұқсат етіңіз."),
    "ob.faceTitle":      tr("Face ID login", "Вход по Face ID", "Accesso con Face ID", "Connexion Face ID", "Face ID ilə giriş", "Face ID ile giriş", "Вхід через Face ID", "Face ID арқылы кіру"),
    "ob.faceDesc":       tr("Next login — instant and secure, no PIN.", "Следующий вход — без ввода PIN, мгновенно и безопасно.", "Prossimo accesso — istantaneo e sicuro, senza PIN.", "Prochaine connexion — instantanée et sûre, sans PIN.", "Növbəti giriş — PIN-siz, ani və təhlükəsiz.", "Sonraki giriş — PIN’siz, anında ve güvenli.", "Наступний вхід — без PIN, миттєво й безпечно.", "Келесі кіру — PIN-сіз, жылдам әрі қауіпсіз."),
    "ob.faceCta":        tr("Enable Face ID", "Включить Face ID", "Attiva Face ID", "Activer Face ID", "Face ID-ni aktiv et", "Face ID’yi aç", "Увімкнути Face ID", "Face ID қосу"),
    "ob.notifTitle":     tr("Notifications", "Уведомления", "Notifiche", "Notifications", "Bildirişlər", "Bildirimler", "Сповіщення", "Хабарландырулар"),
    "ob.notifDesc":      tr("New orders, stock movements, shift end — on time.", "Новые заказы, движения склада, конец смены — вовремя.", "Nuovi ordini, movimenti di magazzino, fine turno — in tempo.", "Nouvelles commandes, mouvements de stock, fin de service — à temps.", "Yeni sifarişlər, anbar hərəkətləri, növbə sonu — vaxtında.", "Yeni siparişler, depo hareketleri, vardiya sonu — zamanında.", "Нові замовлення, рухи складу, кінець зміни — вчасно.", "Жаңа тапсырыстар, қойма қозғалысы, ауысым соңы — уақытында."),
    "ob.notifCta":       tr("Allow notifications", "Разрешить уведомления", "Consenti notifiche", "Autoriser les notifications", "Bildirişlərə icazə ver", "Bildirimlere izin ver", "Дозволити сповіщення", "Хабарландыруларға рұқсат"),
    "ob.geoTitle":       tr("Location", "Геолокация", "Posizione", "Localisation", "Məkan", "Konum", "Геолокація", "Геолокация"),
    "ob.geoDesc":        tr("Check-in uses your location only when you tap the button to confirm arrival. No background tracking — you can always skip and mark manually.", "Геолокация используется только при нажатии кнопки явки. Фоновое отслеживание не ведётся — можно пропустить и отмечаться вручную.", "Usata solo quando tocchi il pulsante per confermare l’arrivo. Nessun tracciamento in background — puoi saltare e fare il check-in manualmente.", "Utilisée uniquement quand vous tapez le bouton d’arrivée. Pas de suivi en arrière-plan — vous pouvez ignorer et pointer manuellement.", "Yalnız gəliş düyməsinə basanda aktivləşir. Arxa planda izləmə yoxdur — əl ilə qeyd etmək üçün keçin.", "Yalnızca varış düğmesine basarken kullanılır. Arka plan takibi yok — atlayabilir ve elle giriş yapabilirsiniz.", "Використовується лише при натисканні кнопки явки. Фонового відстеження немає — можна пропустити та відмічатись вручну.", "Тек келу батырмасын басқанда іске қосылады. Фондық бақылау жоқ — өткізіп жіберіп, қолмен белгілеуге болады."),
    "ob.geoCta":         tr("Continue", "Продолжить", "Continua", "Continuer", "Davam et", "Devam et", "Продовжити", "Жалғастыру"),
    "ob.notNow":         tr("Not now", "Не сейчас", "Non ora", "Pas maintenant", "İndi yox", "Şimdi değil", "Не зараз", "Қазір емес"),
    "comingSoon":        tr("This module is coming to the native app soon", "Модуль скоро появится в нативной версии", "Questo modulo arriverà presto nell’app nativa", "Ce module arrive bientôt dans l’app native", "Bu modul tezliklə tətbiqdə olacaq", "Bu modül yakında uygulamada", "Модуль скоро з’явиться в застосунку", "Бұл модуль жақында қолданбада"),
    "st.totalStock":     tr("Total in stock", "Всего на складе", "Totale in magazzino", "Total en stock", "Anbarda cəmi", "Stokta toplam", "Усього на складі", "Қоймада барлығы"),
    "pe.pickDates":      tr("Select dates", "Выберите даты", "Seleziona le date", "Choisissez les dates", "Tarixləri seçin", "Tarihleri seçin", "Виберіть дати", "Күндерді таңдаңыз"),
    "pe.dates":          tr("Dates", "Даты", "Date", "Dates", "Tarixlər", "Tarihler", "Дати", "Күндер"),
    "pe.datesN":         tr("Selected: {n}", "Выбрано: {n}", "Selezionati: {n}", "Sélectionnés : {n}", "Seçildi: {n}", "Seçildi: {n}", "Вибрано: {n}", "Таңдалды: {n}"),

    // Bookings & News — подписи модулей
    "mod.bookings.sub":   tr("Table bookings", "Брони столов", "Prenotazioni tavoli", "Réservations", "Masa rezervləri", "Masa rezervasyonları", "Бронювання столів", "Үстелдерді брондау"),
    "mod.news.sub":       tr("Feed & announcements", "Лента и объявления", "Feed e annunci", "Fil & annonces", "Lent və elanlar", "Akış ve duyurular", "Стрічка та оголошення", "Таспа және хабарландырулар"),

    // Bookings
    "bk.stNew":           tr("New", "Новая", "Nuova", "Nouvelle", "Yeni", "Yeni", "Нова", "Жаңа"),
    "bk.stNone":          tr("No status", "Без статуса", "Senza stato", "Sans statut", "Statussuz", "Durumsuz", "Без статусу", "Статуссыз"),
    "bk.stWaiting":       tr("Waiting", "Ожидание", "In attesa", "En attente", "Gözləmə", "Bekliyor", "Очікування", "Күту"),
    "bk.stConfirmed":     tr("Confirmed", "Подтверждена", "Confermata", "Confirmée", "Təsdiqləndi", "Onaylandı", "Підтверджено", "Расталды"),
    "bk.stCancelled":     tr("Cancelled", "Отменена", "Annullata", "Annulée", "Ləğv edildi", "İptal", "Скасовано", "Бас тартылды"),
    "bk.stNoShow":        tr("No-show", "Не пришёл", "Non presentato", "Absent", "Gəlmədi", "Gelmedi", "Не з'явився", "Келмеді"),
    "bk.stArrived":       tr("Arrived", "На месте", "Arrivato", "Arrivé", "Gəldi", "Geldi", "Прийшов", "Келді"),
    "bk.stLate":          tr("Late", "Опаздывает", "In ritardo", "En retard", "Gecikir", "Gecikiyor", "Запізнюється", "Кешігеді"),
    "bk.empty":           tr("No bookings", "Нет броней", "Nessuna prenotazione", "Aucune réservation", "Rezerv yoxdur", "Rezervasyon yok", "Немає бронювань", "Брондау жоқ"),
    "bk.emptyHint":       tr("Tap + to add a booking for this day", "Нажмите +, чтобы добавить бронь на этот день", "Tocca + per aggiungere una prenotazione", "Touchez + pour ajouter une réservation", "Bu gün üçün rezerv əlavə edin", "Bu gün için rezervasyon ekleyin", "Натисніть +, щоб додати бронювання на цей день", "Осы күнге брондау қосу үшін + басыңыз"),
    "bk.noName":          tr("Guest", "Гость", "Ospite", "Invité", "Qonaq", "Misafir", "Гість", "Қонақ"),
    "bk.new":             tr("New booking", "Новая бронь", "Nuova prenotazione", "Nouvelle réservation", "Yeni rezerv", "Yeni rezervasyon", "Нове бронювання", "Жаңа брондау"),
    "bk.edit":            tr("Edit booking", "Редактировать", "Modifica", "Modifier", "Düzəliş", "Düzenle", "Редагувати", "Өзгерту"),
    "bk.save":            tr("Save", "Сохранить", "Salva", "Enregistrer", "Yadda saxla", "Kaydet", "Зберегти", "Сақтау"),
    "bk.secGuest":        tr("Guest", "Гость", "Ospite", "Invité", "Qonaq", "Misafir", "Гість", "Қонақ"),
    "bk.suggestions":     tr("Existing guests", "Существующие гости", "Ospiti esistenti", "Invités existants", "Mövcud qonaqlar", "Mevcut misafirler", "Існуючі гості", "Бар қонақтар"),
    "bk.name":            tr("Full name", "Имя и фамилия", "Nome e cognome", "Nom complet", "Ad və soyad", "Ad Soyad", "Ім'я та прізвище", "Аты-жөні"),
    "bk.firstName":       tr("First name", "Имя", "Nome", "Prénom", "Ad", "Ad", "Ім'я", "Аты"),
    "bk.phone":           tr("Phone", "Телефон", "Telefono", "Téléphone", "Telefon", "Telefon", "Телефон", "Телефон"),
    "bk.guests":          tr("Guests", "Гостей", "Ospiti", "Personnes", "Qonaq sayı", "Kişi", "Гостей", "Қонақтар"),
    "bk.secBooking":      tr("Booking", "Бронь", "Prenotazione", "Réservation", "Rezerv", "Rezervasyon", "Бронювання", "Брондау"),
    "bk.date":            tr("Date", "Дата", "Data", "Date", "Tarix", "Tarih", "Дата", "Күні"),
    "bk.setTime":         tr("Set time", "Указать время", "Imposta orario", "Définir l’heure", "Vaxtı təyin et", "Saat belirle", "Вказати час", "Уақытты көрсету"),
    "bk.time":            tr("Time", "Время", "Orario", "Heure", "Vaxt", "Saat", "Час", "Уақыт"),
    "bk.table":           tr("Table", "Стол", "Tavolo", "Table", "Masa", "Masa", "Стіл", "Үстел"),
    "bk.status":          tr("Status", "Статус", "Stato", "Statut", "Status", "Durum", "Статус", "Күй"),
    "bk.note":            tr("Comment", "Комментарий", "Commento", "Commentaire", "Şərh", "Yorum", "Коментар", "Пікір"),
    "bk.notePh":          tr("Comment…", "Комментарий…", "Commento…", "Commentaire…", "Şərh…", "Yorum…", "Коментар…", "Пікір…"),
    "bk.delete":          tr("Delete booking", "Удалить бронь", "Elimina prenotazione", "Supprimer", "Rezervi sil", "Rezervasyonu sil", "Видалити бронювання", "Брондауды жою"),
    "bk.saveFailed":      tr("Couldn't save", "Не удалось сохранить", "Salvataggio non riuscito", "Échec de l’enregistrement", "Saxlanmadı", "Kaydedilemedi", "Не вдалося зберегти", "Сақталмады"),
    "bk.advanceInkassationMissing": tr("Advance saved, but cash register wasn't updated — check manually", "Аванс сохранён, но касса не обновлена — проверьте вручную", "Anticipo salvato, ma la cassa non è stata aggiornata — controlla manualmente", "Avance enregistrée, mais la caisse n'a pas été mise à jour — vérifiez manuellement", "Avans saxlanıldı, lakin kassa yenilənmədi — əl ilə yoxlayın", "Avans kaydedildi, ancak kasa güncellenmedi — manuel kontrol edin", "Аванс збережено, але каса не оновлена — перевірте вручну", "Аванс сақталды, бірақ касса жаңартылмады — қолмен тексеріңіз"),

    // News
    "nw.kInfo":           tr("Info", "Информация", "Info", "Info", "Məlumat", "Bilgi", "Інформація", "Ақпарат"),
    "nw.kStop":           tr("Stop-list", "Стоп-лист", "Stop-list", "Stop-list", "Stop-list", "Stop-list", "Стоп-лист", "Стоп-тізім"),
    "nw.kPromo":          tr("Promo", "Акция", "Promo", "Promo", "Aksiya", "Kampanya", "Акція", "Акция"),
    "nw.kUpdate":         tr("Update", "Нововведение", "Novità", "Nouveauté", "Yenilik", "Yenilik", "Нововведення", "Жаңалық"),
    "nw.empty":           tr("No news yet", "Пока нет новостей", "Ancora nessuna novità", "Pas encore d’actualités", "Hələ xəbər yoxdur", "Henüz haber yok", "Поки немає новин", "Әзірге жаңалық жоқ"),
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
    "nw.bodyPh":          tr("What's new?…", "Что нового?…", "Cosa c’è di nuovo?…", "Quoi de neuf ?…", "Nə yenilik var?…", "Ne var ne yok?…", "Що нового?…", "Не жаңалық?…"),
    "nw.new":             tr("New post", "Новый пост", "Nuovo post", "Nouveau post", "Yeni paylaşım", "Yeni gönderi", "Новий допис", "Жаңа жазба"),
    "nw.publish":         tr("Publish", "Опубликовать", "Pubblica", "Publier", "Yerləşdir", "Yayınla", "Опублікувати", "Жариялау"),
    "nw.post":            tr("News", "Новость", "Novità", "Actualité", "Xəbər", "Haber", "Новина", "Жаңалық"),
    "nw.saveFailed":      tr("Couldn't save", "Не удалось сохранить", "Salvataggio non riuscito", "Échec de l’enregistrement", "Saxlanmadı", "Kaydedilemedi", "Не вдалося зберегти", "Сақталмады"),
    "nw.deleteFailed":    tr("Couldn't delete", "Не удалось удалить", "Eliminazione non riuscita", "Échec de la suppression", "Silinmədi", "Silinemedi", "Не вдалося видалити", "Жойылмады"),

    // People — дополнительные (свайп-действия, офлайн-явка)
    "pe.cancelOrder":       tr("Cancel order?", "Отменить заказ?", "Annullare l’ordine?", "Annuler la commande ?", "Sifariş ləğv edilsin?", "Siparişi iptal et?", "Скасувати замовлення?", "Тапсырысты болдырмау?"),
    "pe.keep":              tr("Keep", "Оставить", "Mantieni", "Garder", "Saxla", "Tut", "Залишити", "Сақтау"),
    "pe.checkInPending":    tr("Pending sync", "Ожидает отправки", "In attesa di sync", "En attente de sync", "Göndərilmə gözləyir", "Bekliyor", "Очікує надсилання", "Жіберілуін күтуде"),
    "pe.checkInPendingHint": tr("Check-in saved offline. Will be sent when network is available.", "Явка записана локально. Отправится при наличии сети.", "Ingresso salvato offline. Verrà inviato alla connessione.", "Arrivée enregistrée hors ligne. Sera envoyée à la connexion.", "Gəliş oflayn saxlanıldı. Şəbəkə olduqda göndəriləcək.", "Giriş çevrimdışı kaydedildi. Ağ bağlantısında gönderilecek.", "Явку збережено офлайн. Надішлеться при підключенні.", "Келу офлайн сақталды. Желі болғанда жіберіледі."),

    // KPI — цели по кальянам
    "tab.goal":           tr("Goal", "Цель", "Obiettivo", "Objectif", "Hədəf", "Hedef", "Ціль", "Мақсат"),
    "kpi.title":          tr("Hookah goal", "Цель по кальянам", "Obiettivo narghilè", "Objectif chicha", "Qəlyan hədəfi", "Nargile hedefi", "Ціль по кальянах", "Кальян мақсаты"),
    "kpi.setGoal":        tr("Set a hookah goal", "Задать цель по кальянам", "Imposta un obiettivo", "Définir un objectif", "Qəlyan hədəfi təyin et", "Nargile hedefi belirle", "Задати ціль по кальянах", "Кальян мақсатын қою"),
    "kpi.empty":          tr("No goal set", "Цель не задана", "Nessun obiettivo", "Aucun objectif", "Hədəf yoxdur", "Hedef yok", "Ціль не задана", "Мақсат жоқ"),
    "kpi.emptyHint":      tr("The team goal for the month appears here", "Здесь появится командная цель на месяц", "Qui appare l’obiettivo del mese", "L’objectif du mois apparaît ici", "Ayın komanda hədəfi burada görünür", "Ayın takım hedefi burada görünür", "Тут з'явиться командна ціль на місяць", "Айдың команда мақсаты осында шығады"),
    "kpi.emptyHintManager": tr("Tap + to set a goal for this month", "Нажмите +, чтобы задать цель на этот месяц", "Tocca + per impostare un obiettivo", "Touchez + pour définir un objectif", "Bu ay üçün hədəf təyin edin", "Bu ay için hedef belirleyin", "Натисніть +, щоб задати ціль на місяць", "Осы айға мақсат қою үшін + басыңыз"),
    "kpi.reached":        tr("Goal reached", "Цель достигнута", "Obiettivo raggiunto", "Objectif atteint", "Hədəf çatdı", "Hedefe ulaşıldı", "Ціль досягнута", "Мақсатқа жетті"),
    "kpi.left":           tr("Left: {n}", "Осталось: {n}", "Restano: {n}", "Reste : {n}", "Qaldı: {n}", "Kaldı: {n}", "Залишилось: {n}", "Қалды: {n}"),
    "kpi.allTypes":       tr("All types", "Все виды", "Tutti i tipi", "Tous les types", "Bütün növlər", "Tüm türler", "Усі види", "Барлық түрлер"),
    "kpi.new":            tr("New goal", "Новая цель", "Nuovo obiettivo", "Nouvel objectif", "Yeni hədəf", "Yeni hedef", "Нова ціль", "Жаңа мақсат"),
    "kpi.edit":           tr("Edit goal", "Редактировать цель", "Modifica obiettivo", "Modifier l’objectif", "Hədəfi düzəlt", "Hedefi düzenle", "Редагувати ціль", "Мақсатты өзгерту"),
    "kpi.save":           tr("Save", "Сохранить", "Salva", "Enregistrer", "Yadda saxla", "Kaydet", "Зберегти", "Сақтау"),
    "kpi.delete":         tr("Delete goal", "Удалить цель", "Elimina obiettivo", "Supprimer l’objectif", "Hədəfi sil", "Hedefi sil", "Видалити ціль", "Мақсатты жою"),
    "kpi.fTitle":         tr("Title", "Название", "Titolo", "Titre", "Başlıq", "Başlık", "Назва", "Атауы"),
    "kpi.titlePh":        tr("e.g. Fruit hookahs (optional)", "напр. Фруктовые кальяны (необязательно)", "es. Narghilè alla frutta", "ex. Chicha aux fruits", "məs. Meyvəli kalyan", "örn. Meyveli nargile", "напр. Фруктові кальяни", "мыс. Жеміс кальяндары"),
    "kpi.types":          tr("Hookah types", "Виды кальянов", "Tipi di narghilè", "Types de chicha", "Qəlyan növləri", "Nargile türleri", "Види кальянів", "Кальян түрлері"),
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
    "an.csvInkass":       tr("Collect.", "Инкасс.", "Prelievo", "Encaisse", "İnkass.", "Tahsilat", "Інкас.", "Инкасс."),
    "an.csvClosing":      tr("Closing", "Закрытие", "Chiusura", "Clôture", "Bağlanış", "Kapanış", "Закриття", "Жабылу"),
    "an.csvTotal":        tr("Total", "Итого", "Totale", "Total", "Cəmi", "Toplam", "Разом", "Барлығы"),
    "an.pdfTitle":        tr("Analytics Report", "Отчёт по аналитике", "Report analitico", "Rapport analytique", "Analitika hesabatı", "Analiz raporu", "Звіт по аналітиці", "Аналитика есебі"),
    "an.pdfGenerated":    tr("Generated", "Сформировано", "Generato", "Généré", "Yaradıldı", "Oluşturuldu", "Сформовано", "Жасалды"),
    "an.pdfShiftsTable":  tr("Shifts", "Смены", "Turni", "Services", "Növbələr", "Vardiyalar", "Зміни", "Ауысымдар"),
    "an.exportFailed":    tr("Export failed", "Ошибка экспорта", "Esportazione fallita", "Échec de l’export", "İxrac xətası", "Dışa aktarma hatası", "Помилка експорту", "Экспорт қатесі"),

    // Analytics — AI Advisor
    "an.advisor":         tr("Advisor", "Советник", "Consulente", "Conseiller", "Məsləhətçi", "Danışman", "Радник", "Кеңесші"),
    "an.advisorRefresh":  tr("Refresh", "Обновить", "Aggiorna", "Actualiser", "Yenilə", "Yenile", "Оновити", "Жаңарту"),
    "an.advisorLoading":  tr("Analysing data...", "Анализирую данные...", "Analizzando...", "Analyse en cours...", "Məlumatlar analiz edilir...", "Veriler analiz ediliyor...", "Аналізую дані...", "Деректер талданып жатыр..."),
    "an.advisorEmpty":    tr("No insights yet — tap Refresh", "Нет наблюдений — нажмите «Обновить»", "Nessuna analisi — premi Aggiorna", "Pas d’analyse — appuyez sur Actualiser", "Hələ məlumat yoxdur — Yenilə düyməsinə basın", "Henüz analiz yok — Yenile'ye dokunun", "Немає спостережень — натисніть «Оновити»", "Ақпарат жоқ — Жаңарту басыңыз"),
    "an.advisorPrompt":   tr("Give 2-3 short practical observations and tips based on this data: compare with last month, note anomalies, what to improve.", "Дай 2-3 кратких практичных наблюдения и совета по этим данным: сравни с прошлым месяцем, отметь аномалии, что улучшить.", "Dai 2-3 brevi osservazioni pratiche su questi dati: confronta con il mese scorso, segnala anomalie, cosa migliorare.", "Donne 2-3 courtes observations pratiques sur ces données : compare avec le mois dernier, note les anomalies, quoi améliorer.", "Bu məlumatlar üzrə 2-3 qısa praktik müşahidə ver: keçən ay ilə müqayisə et, anormallıqları qeyd et, nəyi yaxşılaşdırmaq olar.", "Bu veriler hakkında 2-3 kısa pratik gözlem ver: geçen ayla karşılaştır, anormallikleri belirt, neyi iyileştirmeli.", "Дай 2-3 коротких практичних спостереження за цими даними: порівняй з минулим місяцем, відзнач аномалії, що покращити.", "Осы деректер бойынша 2-3 қысқа практикалық байқау бер: өткен аймен салыстыр, ауытқуларды атап өт, нені жақсарту керек."),
    // Bookings — расширение (поиск, диапазоны, гости)
    "bk.searchPh":        tr("Search by name or phone", "Поиск по имени или телефону", "Cerca per nome o telefono", "Rechercher par nom ou téléphone", "Ad və ya telefon ilə axtar", "Ad veya telefon ile ara", "Пошук за ім'ям або телефоном", "Аты немесе телефон бойынша іздеу"),
    "bk.today":           tr("Today", "Сегодня", "Oggi", "Aujourd’hui", "Bu gün", "Bugün", "Сьогодні", "Бүгін"),
    "bk.tomorrow":        tr("Tomorrow", "Завтра", "Domani", "Demain", "Sabah", "Yarın", "Завтра", "Ертең"),
    "bk.week":            tr("Week", "Неделя", "Settimana", "Semaine", "Həftə", "Hafta", "Тиждень", "Апта"),
    "bk.rangeToday":      tr("Today", "Сегодня", "Oggi", "Aujourd’hui", "Bu gün", "Bugün", "Сьогодні", "Бүгін"),
    "bk.rangeTomorrow":   tr("Tomorrow", "Завтра", "Domani", "Demain", "Sabah", "Yarın", "Завтра", "Ертең"),
    "bk.rangeWeek":       tr("7 Days", "7 дней", "7 giorni", "7 jours", "7 gün", "7 gün", "7 днів", "7 күн"),
    "bk.totalGuests":     tr("{n} guests", "{n} гостей", "{n} ospiti", "{n} personnes", "{n} qonaq", "{n} kişi", "{n} гостей", "{n} қонақ"),
    "bk.duplicate":       tr("Duplicate", "Дублировать", "Duplica", "Dupliquer", "Kopyala", "Kopyala", "Дублювати", "Көшіру"),
    "bk.duplicateTitle":  tr("Duplicate booking", "Дублировать бронь", "Duplica prenotazione", "Dupliquer la réservation", "Rezervi kopyala", "Rezervasyonu kopyala", "Дублювати бронювання", "Брондауды көшіру"),
    "bk.duplicateFor":    tr("For date", "На дату", "Per data", "Pour la date", "Tarix üçün", "Tarih için", "На дату", "Күні үшін"),
    "bk.callAction":      tr("Call", "Позвонить", "Chiama", "Appeler", "Zəng et", "Ara", "Зателефонувати", "Қоңырау шалу"),
    "bk.whatsapp":        tr("WhatsApp", "WhatsApp", "WhatsApp", "WhatsApp", "WhatsApp", "WhatsApp", "WhatsApp", "WhatsApp"),
    "bk.contactGuest":    tr("Contact guest", "Связаться с гостем", "Contatta l’ospite", "Contacter l’invité", "Qonaqla əlaqə", "Misafirle iletişim", "Зв'язатися з гостем", "Қонақпен байланысу"),
    "bk.markArrived":     tr("Arrived", "На месте", "Arrivato", "Arrivé", "Gəldi", "Geldi", "Прийшов", "Келді"),
    "bk.markLate":        tr("Late", "Опоздал", "In ritardo", "En retard", "Gecikdi", "Gecikmeli", "Запізнився", "Кешікті"),
    "bk.confirmDelete":   tr("Delete booking?", "Удалить бронь?", "Eliminare la prenotazione?", "Supprimer la réservation ?", "Rezervi silinsin?", "Rezervasyon silinsin mi?", "Видалити бронювання?", "Брондауды жою керек пе?"),
    "bk.swipeArrived":    tr("Arrived", "На месте", "Arrivato", "Arrivé", "Gəldi", "Geldi", "Прийшов", "Келді"),

    // Google reviews (Bookings tab)
    "bk.rvTitle":         tr("Reviews", "Отзывы", "Recensioni", "Avis", "Rəylər", "Yorumlar", "Відгуки", "Пікірлер"),
    "bk.rvNotConfigured": tr("Google reviews not connected", "Google-отзывы не подключены", "Recensioni Google non collegate", "Avis Google non connectés", "Google rəyləri qoşulmayıb", "Google yorumları bağlı değil", "Google-відгуки не підключені", "Google пікірлері қосылмаған"),
    "bk.rvNotConfiguredSub": tr("Add your Place ID and API key on the web dashboard (Settings) to see rating and reviews here.", "Добавьте Place ID и API-ключ в веб-панели (Настройки) — рейтинг и отзывы появятся здесь.", "Aggiungi Place ID e chiave API nel pannello web (Impostazioni) per vedere qui rating e recensioni.", "Ajoutez votre Place ID et clé API sur le tableau de bord web (Paramètres) pour voir ici note et avis.", "Reytinq və rəyləri burada görmək üçün veb-paneldə (Ayarlar) Place ID və API açarını əlavə edin.", "Puan ve yorumları burada görmek için web panelinden (Ayarlar) Place ID ve API anahtarınızı ekleyin.", "Додайте Place ID та API-ключ у веб-панелі (Налаштування) — рейтинг і відгуки з’являться тут.", "Рейтинг пен пікірлерді осында көру үшін веб-панельде (Баптаулар) Place ID мен API кілтін қосыңыз."),
    "bk.rvRating":        tr("Rating", "Рейтинг", "Valutazione", "Note", "Reytinq", "Puan", "Рейтинг", "Рейтинг"),
    "bk.rvTotal":         tr("Reviews on Google", "Отзывов на Google", "Recensioni su Google", "Avis sur Google", "Google-də rəylər", "Google’daki yorumlar", "Відгуків на Google", "Google-дегі пікірлер"),
    "bk.rvTrend":         tr("Rating over time", "Рейтинг во времени", "Valutazione nel tempo", "Note dans le temps", "Zaman üzrə reytinq", "Zaman içinde puan", "Рейтинг у часі", "Уақыт бойынша рейтинг"),
    "bk.rvList":          tr("Recent reviews", "Последние отзывы", "Recensioni recenti", "Avis récents", "Son rəylər", "Son yorumlar", "Останні відгуки", "Соңғы пікірлер"),
    "bk.rvNone":          tr("No reviews yet", "Отзывов пока нет", "Ancora nessuna recensione", "Aucun avis pour le moment", "Hələ rəy yoxdur", "Henüz yorum yok", "Відгуків поки немає", "Әзірге пікір жоқ"),
    "bk.rvAnon":          tr("Google user", "Пользователь Google", "Utente Google", "Utilisateur Google", "Google istifadəçisi", "Google kullanıcısı", "Користувач Google", "Google пайдаланушысы"),

    // Guests (loyalty)
    "gs.title":           tr("Guests", "Гости", "Ospiti", "Invités", "Qonaqlar", "Misafirler", "Гості", "Қонақтар"),
    "gs.visits":          tr("{n} visits", "{n} визитов", "{n} visite", "{n} visites", "{n} ziyarət", "{n} ziyaret", "{n} візитів", "{n} рет келген"),
    "gs.noShows":         tr("{n} no-shows", "{n} неявок", "{n} assenze", "{n} absences", "{n} gəlməmə", "{n} gelmeme", "{n} неявок", "{n} келмеу"),
    "gs.lastVisit":       tr("Last visit", "Последний визит", "Ultima visita", "Dernière visite", "Son ziyarət", "Son ziyaret", "Останній візит", "Соңғы келуі"),
    "gs.totalGuests":     tr("{n} people total", "Всего {n} гостей", "Totale {n} ospiti", "{n} personnes au total", "Cəmi {n} qonaq", "Toplam {n} kişi", "Всього {n} гостей", "Барлығы {n} қонақ"),
    "gs.history":         tr("Booking history", "История броней", "Storico prenotazioni", "Historique des réservations", "Rezerv tarixçəsi", "Rezervasyon geçmişi", "Історія бронювань", "Брондаулар тарихы"),
    "gs.empty":           tr("No guests yet", "Пока нет гостей", "Nessun ospite", "Aucun invité", "Hələ qonaq yoxdur", "Henüz misafir yok", "Поки немає гостей", "Әзірге қонақ жоқ"),
    "gs.emptyHint":       tr("Guests who made bookings appear here", "Здесь появятся гости, которые делали брони", "Gli ospiti che hanno prenotato appariranno qui", "Les invités ayant réservé apparaîtront ici", "Rezerv edən qonaqlar burada görünəcək", "Rezervasyon yapan misafirler burada görünür", "Тут з'являться гості, які робили брони", "Брон жасаған қонақтар осында шығады"),
    "gs.regularBadge":    tr("Regular", "Постоянный гость", "Habitué", "Habitué", "Daimi", "Daimi", "Постійний", "Тұрақты"),
    "gs.visitBadge":      tr("Visit {n}", "{n}-й визит", "Visita {n}", "Visite {n}", "{n} ziyarət", "{n}. ziyaret", "{n}-й візит", "{n}-ші рет"),
    "gs.loading":         tr("Loading guests…", "Загрузка гостей…", "Caricamento ospiti…", "Chargement des invités…", "Qonaqlar yüklənir…", "Misafirler yükleniyor…", "Завантаження гостей…", "Қонақтар жүктелуде…"),
    "gs.newBooking":      tr("New booking", "Новая бронь", "Nuova prenotazione", "Nouvelle réservation", "Yeni rezerv", "Yeni rezervasyon", "Нове бронювання", "Жаңа брондау"),
    "gs.profile":         tr("Guest profile", "Профиль гостя", "Profilo ospite", "Profil de l’invité", "Qonaq profili", "Misafir profili", "Профіль гостя", "Қонақ профилі"),
    "gs.lastName":        tr("Last name", "Фамилия", "Cognome", "Nom de famille", "Soyad", "Soyad", "Прізвище", "Тегі"),
    "gs.email":           tr("Email", "Email", "Email", "Email", "Email", "Email", "Email", "Email"),
    "gs.birthday":        tr("Birthday", "Дата рождения", "Data di nascita", "Date de naissance", "Doğum tarixi", "Doğum tarihi", "Дата народження", "Туған күні"),
    "gs.note":            tr("Guest note", "Заметка о госте", "Nota ospite", "Note sur l’invité", "Qonaq qeydi", "Misafir notu", "Нотатка про гостя", "Қонақ туралы жазба"),
    "gs.notePh":          tr("Allergies, preferences, VIP…", "Аллергии, предпочтения, VIP…", "Allergie, preferenze, VIP…", "Allergies, préférences, VIP…", "Allergiya, üstünlüklər, VIP…", "Alerjiler, tercihler, VIP…", "Алергії, уподобання, VIP…", "Аллергия, қалаулар, VIP…"),
    "gs.noteSaved":       tr("Saved", "Сохранено", "Salvato", "Enregistré", "Yadda saxlanıldı", "Kaydedildi", "Збережено", "Сақталды"),
    "gs.avgParty":        tr("Avg party", "Средняя компания", "Gruppo medio", "Groupe moyen", "Orta qrup", "Ort. grup", "Середня компанія", "Орташа топ"),
    "gs.favTable":        tr("Favorite table", "Любимый стол", "Tavolo preferito", "Table préférée", "Sevimli masa", "Favori masa", "Улюблений стіл", "Сүйікті үстел"),
    "gs.today":           tr("Today", "Сегодня", "Oggi", "Aujourd’hui", "Bu gün", "Bugün", "Сьогодні", "Бүгін"),
    "gs.daysAgo":         tr("{n} d ago", "{n} дн. назад", "{n} g fa", "il y a {n} j", "{n} gün əvvəl", "{n} gün önce", "{n} дн. тому", "{n} күн бұрын"),
    "gs.monthsAgo":       tr("{n} mo ago", "{n} мес. назад", "{n} mesi fa", "il y a {n} mois", "{n} ay əvvəl", "{n} ay önce", "{n} міс. тому", "{n} ай бұрын"),
    "gs.editGuest":       tr("Edit guest", "Редактировать гостя", "Modifica ospite", "Modifier l’invité", "Qonağı düzəlt", "Misafiri düzenle", "Редагувати гостя", "Қонақты өзгерту"),
    "gs.deleteGuest":     tr("Delete guest", "Удалить гостя", "Elimina ospite", "Supprimer l’invité", "Qonağı sil", "Misafiri sil", "Видалити гостя", "Қонақты жою"),
    "gs.deleteGuestConfirm": tr("Delete all bookings for {name}?", "Удалить все брони гостя {name}?", "Eliminare tutte le prenotazioni di {name}?", "Supprimer toutes les réservations de {name} ?", "{name} üçün bütün rezervləri sil?", "{name} için tüm rezervasyonları sil?", "Видалити всі броні гостя {name}?", "{name} үшін барлық бронды жою?"),
    "gs.guestInfo":       tr("Guest info", "Информация о госте", "Info ospite", "Info invité", "Qonaq məlumatı", "Misafir bilgisi", "Інфо про гостя", "Қонақ ақпараты"),
    "gs.secContacts":     tr("Contacts", "Контактные данные", "Contatti", "Contacts", "Əlaqə məlumatları", "İletişim bilgileri", "Контактні дані", "Байланыс деректері"),
    "gs.namePh":          tr("Full name", "Имя и фамилия", "Nome e cognome", "Nom complet", "Ad və soyad", "Ad Soyad", "Ім'я та прізвище", "Аты-жөні"),
    "gs.phonePh":         tr("Phone", "Телефон", "Telefono", "Téléphone", "Telefon", "Telefon", "Телефон", "Телефон"),
    // Quick Actions
    "qa.todayBookings":   tr("Today's bookings", "Брони на сегодня", "Prenotazioni oggi", "Réservations du jour", "Bu günün rezervləri", "Bugünün rezervasyonları", "Бронювання на сьогодні", "Бүгінгі брондау"),
    "qa.openShift":       tr("Open shift", "Открыть смену", "Apri turno", "Ouvrir le service", "Növbəni aç", "Vardiyayı aç", "Відкрити зміну", "Ауысымды ашу"),
    "qa.addExpense":      tr("Add expense", "Добавить расход", "Aggiungi spesa", "Ajouter une dépense", "Xərc əlavə et", "Gider ekle", "Додати витрату", "Шығыс қосу"),
    // Siri Shortcuts (MiseShortcuts.swift) dialog-тексты — только те, что перевод произносит
    // ВНУТРИ perform() (@MainActor, доступ к t()/L10n есть). title/description/phrases —
    // static var протокола AppIntent, они nonisolated (система индексирует их до/без MainActor),
    // поэтому используют отдельную небольшую nonisolated-таблицу прямо в MiseShortcuts.swift
    // (тот же архитектурный приём, что WidgetLocalization.swift для расширения-виджета).
    "sc.revenueNoShift":  tr("No open shift right now.", "Сейчас нет открытой смены.", "Nessun turno aperto al momento.", "Aucun service ouvert actuellement.", "Hazırda açıq növbə yoxdur.", "Şu anda açık vardiya yok.", "Зараз немає відкритої зміни.", "Қазір ашық ауысым жоқ."),
    "sc.revenueDialog":   tr("Income {income}, balance {closing}.", "Приход {income}, остаток {closing}.", "Incasso {income}, saldo {closing}.", "Recettes {income}, solde {closing}.", "Gəlir {income}, qalıq {closing}.", "Gelir {income}, bakiye {closing}.", "Прихід {income}, залишок {closing}.", "Кіріс {income}, қалдық {closing}."),
    "sc.bookingNone":     tr("No bookings today.", "Броней на сегодня нет.", "Nessuna prenotazione per oggi.", "Aucune réservation aujourd'hui.", "Bu gün üçün rezerv yoxdur.", "Bugün için rezervasyon yok.", "На сьогодні броней немає.", "Бүгінге брондау жоқ."),
    "sc.bookingDialogTable": tr(", table {table}", ", стол {table}", ", tavolo {table}", ", table {table}", ", masa {table}", ", masa {table}", ", стіл {table}", ", үстел {table}"),
    "sc.bookingDialog":   tr("Nearest booking: {time}, {guest}, {party} guests{extra}. Total bookings: {count}.", "Ближайшая бронь: {time}, {guest}, {party} гост.{extra}. Всего броней: {count}.", "Prenotazione più vicina: {time}, {guest}, {party} ospiti{extra}. Totale prenotazioni: {count}.", "Réservation la plus proche : {time}, {guest}, {party} pers.{extra}. Total : {count}.", "Yaxın rezerv: {time}, {guest}, {party} qonaq{extra}. Cəmi rezerv: {count}.", "En yakın rezervasyon: {time}, {guest}, {party} kişi{extra}. Toplam rezervasyon: {count}.", "Найближче бронювання: {time}, {guest}, {party} гостей{extra}. Всього броней: {count}.", "Жақын брондау: {time}, {guest}, {party} қонақ{extra}. Барлығы: {count}."),
    "sc.countDialog":     tr("{count} bookings. Nearest: {time}, {guest}{extra}.", "{count} броней. Ближайшая: {time}, {guest}{extra}.", "{count} prenotazioni. Più vicina: {time}, {guest}{extra}.", "{count} réservations. La plus proche : {time}, {guest}{extra}.", "{count} rezerv. Yaxın: {time}, {guest}{extra}.", "{count} rezervasyon. En yakın: {time}, {guest}{extra}.", "{count} броней. Найближче: {time}, {guest}{extra}.", "{count} брондау. Жақыны: {time}, {guest}{extra}."),
    // Notification settings
    "ns.lowStock":        tr("Stock movements", "Движения склада", "Movimenti di magazzino", "Mouvements de stock", "Anbar hərəkətləri", "Depo hareketleri", "Рухи складу", "Қойма қозғалысы"),
    "ns.shiftReminder":   tr("Shift end reminder", "Напоминание о конце смены", "Promemoria fine turno", "Rappel fin de service", "Növbə sonu xatırlatması", "Vardiya sonu hatırlatması", "Нагадування про кінець зміни", "Ауысым соңы еске салу"),
    "ns.voiceTasks":      tr("Voice task confirmation", "Подтверждение голосовой задачи", "Conferma attività vocale", "Confirmation tâche vocale", "Səsli tapşırıq təsdiqi", "Sesli görev onayı", "Підтвердження голосового завдання", "Дауыстық тапсырманы растау"),
    // Shift reminder
    "shift.reminderTitle": tr("Shift ending soon", "Смена скоро заканчивается", "Turno in chiusura", "Fin de service", "Növbə tezliklə bitir", "Vardiya yakında bitiyor", "Зміна незабаром закінчується", "Ауысым жақында аяқталады"),
    "shift.reminderBody":  tr("30 minutes until shift end. Don't forget to save data!", "30 минут до конца смены. Не забудьте сохранить данные!", "30 minuti alla fine del turno. Non dimenticare di salvare!", "30 minutes avant la fin du service. N’oubliez pas de sauvegarder !", "Növbə bitməsinə 30 dəqiqə. Məlumatları saxlamağı unutmayın!", "Vardiya bitimine 30 dakika. Verileri kaydetmeyi unutmayın!", "30 хвилин до кінця зміни. Не забудьте зберегти дані!", "Ауысым аяқталуына 30 минут. Деректерді сақтауды ұмытпаңыз!"),
    // Business report
    "rp.title":           tr("Business report", "Бизнес-отчёт", "Report aziendale", "Rapport d'activité", "Biznes hesabatı", "İşletme raporu", "Бізнес-звіт", "Бизнес есебі"),
    "rp.period":          tr("Period", "Период", "Periodo", "Période", "Dövr", "Dönem", "Період", "Кезең"),
    "rp.periodMonth":     tr("Month", "Месяц", "Mese", "Mois", "Ay", "Ay", "Місяць", "Ай"),
    "rp.periodAll":       tr("All time", "Весь период", "Sempre", "Toute la période", "Bütün dövr", "Tüm zamanlar", "Весь час", "Барлық уақыт"),
    "rp.includes":        tr("Report sections", "Разделы отчёта", "Sezioni del report", "Sections du rapport", "Hesabat bölmələri", "Rapor bölümleri", "Розділи звіту", "Есеп бөлімдері"),
    "rp.secOverview":     tr("Overview", "Обзор", "Panoramica", "Aperçu", "Baxış", "Genel bakış", "Огляд", "Шолу"),
    "rp.secCash":         tr("Cash & collections", "Касса и инкассация", "Cassa e incassi", "Caisse et encaissements", "Kassa və inkassasiya", "Kasa ve tahsilat", "Каса та інкасація", "Касса және инкассация"),
    "rp.secSales":        tr("Sales & guests", "Продажи и гости", "Vendite e ospiti", "Ventes et invités", "Satış və qonaqlar", "Satış ve misafirler", "Продажі та гості", "Сатылым және қонақтар"),
    "rp.secStaff":        tr("Staff & expenses", "Персонал и расходы", "Personale e spese", "Personnel et dépenses", "Heyət və xərclər", "Personel ve giderler", "Персонал і витрати", "Персонал және шығыстар"),
    "rp.generate":        tr("Generate & share", "Сформировать и поделиться", "Genera e condividi", "Générer et partager", "Yarat və paylaş", "Oluştur ve paylaş", "Сформувати і поділитися", "Жасау және бөлісу"),
    "rp.netProfit":       tr("Net profit", "Чистая прибыль", "Utile netto", "Bénéfice net", "Xalis mənfəət", "Net kâr", "Чистий прибуток", "Таза пайда"),
    "rp.topFlavors":      tr("Top flavors", "Топ вкусов", "Gusti più venduti", "Saveurs les plus vendues", "Ən çox satılan dadlar", "En çok satan aromalar", "Топ смаків", "Топ дәмдер"),
    "rp.freePortions":    tr("Free portions", "Бесплатных порций", "Porzioni gratuite", "Portions gratuites", "Pulsuz porsiyalar", "Ücretsiz porsiyonlar", "Безкоштовних порцій", "Тегін порциялар"),
    "rp.topGuests":       tr("Top regular guests", "Топ постоянных клиентов", "Migliori clienti abituali", "Meilleurs clients fidèles", "Ən daimi qonaqlar", "En sadık misafirler", "Топ постійних гостей", "Тұрақты қонақтар топы"),
    "rp.last12mo":        tr("last 12 months", "за последние 12 месяцев", "ultimi 12 mesi", "12 derniers mois", "son 12 ay", "son 12 ay", "за останні 12 місяців", "соңғы 12 ай"),
    "rp.colGuest":        tr("Guest", "Гость", "Ospite", "Invité", "Qonaq", "Misafir", "Гість", "Қонақ"),
    "rp.colVisits":       tr("Visits", "Визиты", "Visite", "Visites", "Ziyarətlər", "Ziyaretler", "Візити", "Келу саны"),
    "rp.colLast":         tr("Last visit", "Последний визит", "Ultima visita", "Dernière visite", "Son ziyarət", "Son ziyaret", "Останній візит", "Соңғы келуі"),
    "rp.colEmployee":     tr("Employee", "Сотрудник", "Dipendente", "Employé", "Əməkdaş", "Çalışan", "Співробітник", "Қызметкер"),
    "rp.colSalary":       tr("Salary", "Оклад", "Stipendio", "Salaire", "Maaş", "Maaş", "Оклад", "Жалақы"),
    "rp.colAbsences":     tr("Absences", "Прогулы", "Assenze", "Absences", "Qayıblar", "Devamsızlık", "Прогули", "Келмеу"),
    "rp.colDeduct":       tr("Deduction", "Вычет", "Detrazione", "Retenue", "Tutulma", "Kesinti", "Відрахування", "Шегерім"),
    "rp.colCash":         tr("Cash", "Наличными", "Contanti", "Espèces", "Nağd", "Nakit", "Готівка", "Қолма-қол"),
    "rp.expenseByCat":    tr("Expenses by category", "Расходы по категориям", "Spese per categoria", "Dépenses par catégorie", "Kateqoriya üzrə xərclər", "Kategoriye göre giderler", "Витрати за категоріями", "Санат бойынша шығыстар"),
    "rp.payroll":         tr("Payroll", "Фонд оплаты труда", "Buste paga", "Masse salariale", "Əmək haqqı fondu", "Bordro", "Фонд оплати праці", "Еңбекақы қоры"),
    "rp.noData":          tr("No data for this period", "Нет данных за период", "Nessun dato per il periodo", "Aucune donnée pour cette période", "Bu dövr üçün məlumat yoxdur", "Bu dönem için veri yok", "Немає даних за період", "Осы кезең үшін деректер жоқ"),
    "rp.filledShifts":    tr("Shifts closed", "Смен закрыто", "Turni chiusi", "Services clôturés", "Bağlanan növbələr", "Kapanan vardiyalar", "Змін закрито", "Жабылған ауысымдар"),
]
