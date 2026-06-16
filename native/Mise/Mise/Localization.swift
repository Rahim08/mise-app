import SwiftUI

// Локализация нативного приложения. Подход — как в вебе (lib/i18n.tsx): один словарь
// STRINGS (ключ → переводы по локалям), фолбэк на английский. Язык по умолчанию берётся
// из системы iPhone, но переопределяется выбором в Настройках (живое переключение без
// перезапуска — @Observable, view перерисовываются при смене языка).

enum Lang: String, CaseIterable, Sendable {
    case en, ru, it, fr, az, tr, uk, kk
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

@MainActor
@Observable
final class L10n {
    static let shared = L10n()
    private let key = "mise_lang"

    var lang: Lang {
        didSet { UserDefaults.standard.set(lang.rawValue, forKey: key); I18n.code = lang.rawValue }
    }

    private init() {
        if let saved = UserDefaults.standard.string(forKey: "mise_lang"), let l = Lang(rawValue: saved) {
            lang = l
        } else {
            let sys = Locale.preferredLanguages.first?.prefix(2).lowercased() ?? "en"
            lang = Lang(rawValue: String(sys)) ?? .en
        }
        I18n.code = lang.rawValue
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
    "add":    tr("Add", "Добавить", "Aggiungi", "Ajouter", "Əlavə et", "Ekle", "Додати", "Қосу"),
    "send":   tr("Send", "Отправить", "Invia", "Envoyer", "Göndər", "Gönder", "Надіслати", "Жіберу"),
    "create": tr("Create", "Создать", "Crea", "Créer", "Yarat", "Oluştur", "Створити", "Жасау"),
    "history": tr("History", "История", "Cronologia", "Historique", "Tarixçə", "Geçmiş", "Історія", "Тарих"),

    // Настройки
    "settings":        tr("Settings", "Настройки", "Impostazioni", "Réglages", "Tənzimləmələr", "Ayarlar", "Налаштування", "Параметрлер"),
    "settings.lang":   tr("Language", "Язык", "Lingua", "Langue", "Dil", "Dil", "Мова", "Тіл"),
    "logout":          tr("Log out", "Выйти", "Esci", "Déconnexion", "Çıxış", "Çıkış yap", "Вийти", "Шығу"),
    "logout.confirm":  tr("Log out of venue?", "Выйти из заведения?", "Uscire dal locale?", "Quitter l’établissement ?", "Məkandan çıxılsın?", "Mekandan çıkılsın mı?", "Вийти із закладу?", "Орыннан шығу керек пе?"),
    "logout.msg":      tr("You’ll need to scan the QR and enter the PIN again.", "Понадобится снова отсканировать QR и ввести PIN.", "Dovrai scansionare di nuovo il QR e inserire il PIN.", "Vous devrez scanner le QR et saisir le PIN à nouveau.", "QR-u yenidən skan edib PIN daxil etməli olacaqsınız.", "QR'ı tekrar tarayıp PIN girmeniz gerekecek.", "Потрібно буде знову відсканувати QR і ввести PIN.", "QR-ды қайта сканерлеп, PIN енгізу қажет болады."),

    // Роли
    "role.owner": tr("Owner", "Владелец", "Proprietario", "Propriétaire", "Sahib", "Sahip", "Власник", "Иесі"),

    // Подзаголовки модулей
    "mod.manager.sub":   tr("Shifts & cash", "Смены и касса", "Turni e cassa", "Services et caisse", "Növbələr və kassa", "Vardiyalar ve kasa", "Зміни та каса", "Ауысым және касса"),
    "mod.analytics.sub": tr("Revenue & analytics", "Выручка и аналитика", "Ricavi e analisi", "Revenus et analyses", "Gəlir və analitika", "Gelir ve analiz", "Виручка та аналітика", "Кіріс және аналитика"),
    "mod.stash.sub":     tr("Stock & hookah", "Склад и кальян", "Magazzino e narghilè", "Stock et chicha", "Anbar və kalyan", "Stok ve nargile", "Склад і кальян", "Қойма және кальян"),
    "mod.people.sub":    tr("Team & schedule", "Команда и расписание", "Team e turni", "Équipe et planning", "Komanda və qrafik", "Ekip ve program", "Команда та розклад", "Команда және кесте"),

    // Вкладки Analytics
    "tab.period":   tr("Period", "Период", "Periodo", "Période", "Dövr", "Dönem", "Період", "Кезең"),
    "tab.kassa":    tr("Cash", "Касса", "Cassa", "Caisse", "Kassa", "Kasa", "Каса", "Касса"),
    "tab.forecast": tr("Forecast", "Прогноз", "Previsione", "Prévision", "Proqnoz", "Tahmin", "Прогноз", "Болжам"),
    "tab.salary":   tr("Salary", "Зарплата", "Stipendio", "Salaire", "Maaş", "Maaş", "Зарплата", "Жалақы"),
    "tab.hookah":   tr("Hookah", "Кальян", "Narghilè", "Chicha", "Kalyan", "Nargile", "Кальян", "Кальян"),

    // Вкладки People
    "tab.shifts": tr("Shifts", "Смены", "Turni", "Services", "Növbələr", "Vardiyalar", "Зміни", "Ауысымдар"),
    "tab.tasks":  tr("Tasks", "Задачи", "Compiti", "Tâches", "Tapşırıqlar", "Görevler", "Завдання", "Тапсырмалар"),
    "tab.hall":   tr("Hall", "Зал", "Sala", "Salle", "Zal", "Salon", "Зал", "Зал"),

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
]
