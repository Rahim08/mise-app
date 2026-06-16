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

    // Общее (доп.)
    "saving":     tr("Saving…", "Сохранение…", "Salvataggio…", "Enregistrement…", "Saxlanılır…", "Kaydediliyor…", "Збереження…", "Сақталуда…"),
    "saveFailed": tr("Not saved: {err}", "Не сохранилось: {err}", "Non salvato: {err}", "Non enregistré : {err}", "Saxlanılmadı: {err}", "Kaydedilmedi: {err}", "Не збережено: {err}", "Сақталмады: {err}"),
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
    "mg.inkReason":      tr("Expense reason", "Причина расхода", "Motivo spesa", "Motif de la dépense", "Xərcin səbəbi", "Gider nedeni", "Причина витрати", "Шығыс себебі"),
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
    "st.noTypes":       tr("No hookah types set", "Виды кальянов не заданы", "Nessun tipo di narghilè impostato", "Aucun type de chicha défini", "Kalyan növləri təyin edilməyib", "Nargile türü tanımlı değil", "Види кальянів не задані", "Кальян түрлері белгіленбеген"),
    "st.noTypesHint":   tr("Add them in the dashboard: Settings → Hookah", "Добавьте их в дашборде: Настройки → Кальян", "Aggiungili nella dashboard: Impostazioni → Narghilè", "Ajoutez-les dans le tableau de bord : Réglages → Chicha", "Onları idarə panelində əlavə edin: Tənzimləmələr → Kalyan", "Bunları panoda ekleyin: Ayarlar → Nargile", "Додайте їх у дашборді: Налаштування → Кальян", "Оларды дашбордта қосыңыз: Параметрлер → Кальян"),
    "st.toToday":       tr("To today", "К сегодня", "A oggi", "À aujourd’hui", "Bu günə", "Bugüne", "До сьогодні", "Бүгінге"),
    "st.sold":          tr("Sold", "Продано", "Venduti", "Vendus", "Satıldı", "Satıldı", "Продано", "Сатылды"),
    "st.free":          tr("Free", "Бесплатно", "Gratis", "Gratuits", "Pulsuz", "Ücretsiz", "Безкоштовно", "Тегін"),
    "st.revenue":       tr("Revenue", "Выручка", "Ricavo", "Recette", "Gəlir", "Gelir", "Виручка", "Түсім"),
    "st.tobacco":       tr("Tobacco", "Табак", "Tabacco", "Tabac", "Tütün", "Tütün", "Тютюн", "Темекі"),
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
    "st.moreRow":       tr("One more row", "Ещё строка", "Altra riga", "Une ligne de plus", "Daha bir sətir", "Bir satır daha", "Ще рядок", "Тағы жол"),
    "st.writeoffReasonField": tr("Write-off reason", "Причина списания", "Motivo dello scarico", "Motif de la radiation", "Silinmə səbəbi", "Düşüm nedeni", "Причина списання", "Есептен шығару себебі"),
    "st.movement":      tr("Movement", "Движение", "Movimento", "Mouvement", "Hərəkət", "Hareket", "Рух", "Қозғалыс"),
    "st.noInventories": tr("No inventory counts yet", "Инвентаризаций пока нет", "Nessun inventario", "Aucun inventaire", "Hələ inventarizasiya yoxdur", "Henüz envanter yok", "Інвентаризацій поки немає", "Әзірге түгендеу жоқ"),
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
    "an.payrollFund":    tr("PAYROLL · TO PAY", "ФОНД ЗАРПЛАТЫ · К ВЫПЛАТЕ", "FONDO STIPENDI · DA PAGARE", "MASSE SALARIALE · À PAYER", "ƏMƏK HAQQI · ÖDƏNİLƏCƏK", "MAAŞ FONU · ÖDENECEK", "ФОНД ЗАРПЛАТИ · ДО ВИПЛАТИ", "ЖАЛАҚЫ ҚОРЫ · ТӨЛЕНЕДІ"),
    "an.cardThisMonth":  tr("To card this month", "На карту в этом месяце", "Su carta questo mese", "Sur carte ce mois", "Bu ay karta", "Bu ay karta", "На картку цього місяця", "Осы айда картаға"),
    "an.inStock":        tr("In stock", "На складе", "In magazzino", "En stock", "Anbarda", "Stokta", "На складі", "Қоймада"),
    "an.atVenue":        tr("At venue", "В заведении", "Nel locale", "Sur place", "Məkanda", "Mekanda", "У закладі", "Орында"),
    "an.noHookahShifts": tr("No hookah shifts this month", "Смен кальянщика в этом месяце нет", "Nessun turno narghilè questo mese", "Aucun service chicha ce mois", "Bu ay kalyan növbəsi yoxdur", "Bu ay nargile vardiyası yok", "Цього місяця змін кальянника немає", "Бұл айда кальян ауысымы жоқ"),
    "an.shiftsByDay":    tr("SHIFTS BY DAY", "СМЕНЫ ПО ДНЯМ", "TURNI PER GIORNO", "SERVICES PAR JOUR", "GÜNLƏR ÜZRƏ NÖVBƏLƏR", "GÜNE GÖRE VARDİYALAR", "ЗМІНИ ПО ДНЯХ", "КҮНДЕР БОЙЫНША АУЫСЫМДАР"),
    "an.balance":        tr("Balance", "Остаток", "Saldo", "Solde", "Qalıq", "Bakiye", "Залишок", "Қалдық"),
    "an.lastIncome":     tr("Last income", "Последний доход", "Ultimo incasso", "Dernier revenu", "Son gəlir", "Son gelir", "Останній дохід", "Соңғы кіріс"),
    "an.tillBalance":    tr("TILL BALANCE", "ОСТАТОК КАССЫ", "SALDO CASSA", "SOLDE CAISSE", "KASSA QALIĞI", "KASA BAKİYESİ", "ЗАЛИШОК КАСИ", "КАССА ҚАЛДЫҒЫ"),
    "an.noShiftData":    tr("No shift data", "Нет данных по сменам", "Nessun dato sui turni", "Aucune donnée de service", "Növbə məlumatı yoxdur", "Vardiya verisi yok", "Немає даних по змінах", "Ауысым деректері жоқ"),
    "an.byDay":          tr("BY DAY", "ПО ДНЯМ", "PER GIORNO", "PAR JOUR", "GÜNLƏR ÜZRƏ", "GÜNE GÖRE", "ПО ДНЯХ", "КҮНДЕР БОЙЫНША"),
    "an.inCol":          tr("In", "Вход", "Entrata", "Entrée", "Giriş", "Giriş", "Вхід", "Кіріс"),
    "an.totalInkass":    tr("Total collected", "Всего инкассации", "Totale prelievi", "Total encaissé", "Cəmi inkassasiya", "Toplam tahsilat", "Усього інкасації", "Барлық инкассация"),
    "an.salaryToday":    tr("Salary to date", "ЗП на сегодня", "Stipendio a oggi", "Salaire à ce jour", "Bu günə maaş", "Bugüne maaş", "ЗП на сьогодні", "Бүгінге жалақы"),
    "an.noInkass":       tr("No collections", "Инкассаций нет", "Nessun prelievo", "Aucun encaissement", "İnkassasiya yoxdur", "Tahsilat yok", "Інкасацій немає", "Инкассация жоқ"),
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
]
