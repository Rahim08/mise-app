// Notification copy — отдельно от UI-словаря (lib/i18n.tsx), потому что текст пуша/журнала
// уведомлений должен рендериться на языке ПОЛУЧАТЕЛЯ (push_subscriptions.lang), а не
// отправителя в момент отправки. Общий для web (/api/notify) и iOS (тот же роут).
//
// Важно: НЕ переиспользует ключи из lib/i18n.tsx/Localization.swift напрямую — некоторые
// совпадающие по имени ключи там означают разное на web и iOS (напр. pe.newTask — кнопка
// с «+» на вебе, чистый заголовок на iOS). Здесь — единственный источник правды.

export type NotifyLocale = 'en' | 'ru' | 'it' | 'fr' | 'az' | 'tr' | 'uk' | 'kk'
type Row = Partial<Record<NotifyLocale, string>>

export const NOTIFY_STRINGS: Record<string, Row> = {
  'notify.cashOpenTitle':  { en: 'Cash opened', ru: 'Касса открыта', it: 'Cassa aperta', fr: 'Caisse ouverte', az: 'Kassa açıldı', tr: 'Kasa açıldı', uk: 'Касу відкрито', kk: 'Касса ашылды' },
  'notify.cashOpenBody':   { en: 'Shift opened', ru: 'Смена открыта', it: 'Turno aperto', fr: 'Service ouvert', az: 'Növbə açıldı', tr: 'Vardiya açıldı', uk: 'Зміну відкрито', kk: 'Ауысым ашылды' },
  'notify.cashCloseTitle': { en: 'Cash closed', ru: 'Касса закрыта', it: 'Cassa chiusa', fr: 'Caisse fermée', az: 'Kassa bağlandı', tr: 'Kasa kapandı', uk: 'Касу закрито', kk: 'Касса жабылды' },
  'notify.cashCloseBody':  { en: 'Shift closed', ru: 'Смена закрыта', it: 'Turno chiuso', fr: 'Service clôturé', az: 'Növbə bağlandı', tr: 'Vardiya kapandı', uk: 'Зміну закрито', kk: 'Ауысым жабылды' },

  'notify.newTaskTitle':   { en: 'New task', ru: 'Новая задача', it: 'Nuovo compito', fr: 'Nouvelle tâche', az: 'Yeni tapşırıq', tr: 'Yeni görev', uk: 'Нове завдання', kk: 'Жаңа тапсырма' },

  'notify.swapRequestTitle':  { en: 'Swap request', ru: 'Запрос на обмен', it: 'Richiesta di cambio', fr: 'Demande d’échange', az: 'Növbə dəyişmə sorğusu', tr: 'Vardiya değişim talebi', uk: 'Запит на обмін', kk: 'Ауысым сұранысы' },
  'notify.swapRequestBody':   { en: '{name} is offering a shift swap {date}', ru: '{name} предлагает обмен сменой {date}', it: '{name} propone uno scambio di turno {date}', fr: '{name} propose un échange de service {date}', az: '{name} növbə dəyişməyi təklif edir {date}', tr: '{name} vardiya değişimi öneriyor {date}', uk: '{name} пропонує обмін зміною {date}', kk: '{name} ауысым алмасуды ұсынады {date}' },
  'notify.swapPendingTitle':  { en: 'Swap pending approval', ru: 'Обмен на согласование', it: 'Scambio in approvazione', fr: 'Échange en attente d’approbation', az: 'Dəyişim təsdiq gözləyir', tr: 'Takas onay bekliyor', uk: 'Обмін на погодження', kk: 'Алмасу мақұлдауды күтуде' },
  'notify.swapPendingBody':   { en: 'Colleague accepted the swap — needs manager approval', ru: 'Коллега принял обмен — нужно одобрение менеджера', it: 'Il collega ha accettato lo scambio — serve l’approvazione del manager', fr: 'Le collègue a accepté l’échange — approbation du manager requise', az: 'Həmkar dəyişimi qəbul etdi — menecer təsdiqi lazımdır', tr: 'Meslektaş takası kabul etti — yönetici onayı gerekiyor', uk: 'Колега прийняв обмін — потрібне схвалення менеджера', kk: 'Әріптес алмасуды қабылдады — менеджер мақұлдауы қажет' },
  'notify.swapDeclinedTitle': { en: 'Swap declined', ru: 'Обмен отклонён', it: 'Scambio rifiutato', fr: 'Échange refusé', az: 'Dəyişim rədd edildi', tr: 'Takas reddedildi', uk: 'Обмін відхилено', kk: 'Алмасу қабылданбады' },
  'notify.swapDeclinedByPeerBody':    { en: 'Colleague declined the swap request', ru: 'Коллега отклонил запрос на обмен', it: 'Il collega ha rifiutato la richiesta di scambio', fr: 'Le collègue a refusé la demande d’échange', az: 'Həmkar dəyişim sorğusunu rədd etdi', tr: 'Meslektaş takas talebini reddetti', uk: 'Колега відхилив запит на обмін', kk: 'Әріптес алмасу сұранысын қабылдамады' },
  'notify.swapDeclinedByManagerBody': { en: 'Manager declined the swap', ru: 'Менеджер отклонил обмен', it: 'Il manager ha rifiutato lo scambio', fr: 'Le manager a refusé l’échange', az: 'Menecer dəyişimi rədd etdi', tr: 'Yönetici takası reddetti', uk: 'Менеджер відхилив обмін', kk: 'Менеджер алмасуды қабылдамады' },
  'notify.swapApprovedTitle': { en: 'Swap approved', ru: 'Обмен одобрен', it: 'Scambio approvato', fr: 'Échange approuvé', az: 'Dəyişim təsdiqləndi', tr: 'Takas onaylandı', uk: 'Обмін схвалено', kk: 'Алмасу мақұлданды' },
  'notify.swapApprovedBody':  { en: 'Shift reassigned to colleague', ru: 'Смена переназначена коллеге', it: 'Turno riassegnato al collega', fr: 'Service réattribué au collègue', az: 'Növbə həmkara yenidən təyin edildi', tr: 'Vardiya meslektaşa yeniden atandı', uk: 'Зміну перепризначено колезі', kk: 'Ауысым әріптеске қайта тағайындалды' },

  'notify.attendanceTitle':    { en: 'Staff on shift', ru: 'Сотрудник на смене', it: 'Personale in turno', fr: 'Personnel en service', az: 'İşçi növbədə', tr: 'Personel vardiyada', uk: 'Персонал на зміні', kk: 'Қызметкер ауысымда' },
  'notify.attendanceBody':     { en: '{name} checked in', ru: '{name} пришёл(а)', it: '{name} è arrivato/a', fr: '{name} est arrivé(e)', az: '{name} gəldi', tr: '{name} geldi', uk: '{name} прийшов(ла)', kk: '{name} келді' },
  'notify.attendanceBodyLate': { en: '{name} checked in (+{min} min)', ru: '{name} пришёл(а) (+{min} мин)', it: '{name} è arrivato/a (+{min} min)', fr: '{name} est arrivé(e) (+{min} min)', az: '{name} gəldi (+{min} dəq)', tr: '{name} geldi (+{min} dk)', uk: '{name} прийшов(ла) (+{min} хв)', kk: '{name} келді (+{min} мин)' },

  'notify.purchaseTitle':         { en: '{category} · Purchase', ru: '{category} · Закуп', it: '{category} · Acquisti', fr: '{category} · Achats', az: '{category} · Satınalma', tr: '{category} · Satın alma', uk: '{category} · Закупівля', kk: '{category} · Сатып алу' },
  'notify.purchasePositionsBody': { en: '{who}{n} items', ru: '{who}{n} позиц.', it: '{who}{n} voci', fr: '{who}{n} articles', az: '{who}{n} mövqe', tr: '{who}{n} kalem', uk: '{who}{n} позиц.', kk: '{who}{n} позиция' },
  'notify.catKitchen':   { en: 'Kitchen', ru: 'Кухня', it: 'Cucina', fr: 'Cuisine', az: 'Mətbəx', tr: 'Mutfak', uk: 'Кухня', kk: 'Ас үй' },
  'notify.catBar':       { en: 'Bar', ru: 'Бар', it: 'Bar', fr: 'Bar', az: 'Bar', tr: 'Bar', uk: 'Бар', kk: 'Бар' },
  'notify.catHookah':    { en: 'Hookah', ru: 'Кальян', it: 'Narghilè', fr: 'Chicha', az: 'Qəlyan', tr: 'Nargile', uk: 'Кальян', kk: 'Кальян' },
  'notify.catHousehold': { en: 'Household', ru: 'Хозтовары', it: 'Casalinghi', fr: 'Ménage', az: 'Təsərrüfat', tr: 'Ev', uk: 'Господарські', kk: 'Шаруашылық' },
  'notify.catGeneral':   { en: 'General', ru: 'Общее', it: 'Generale', fr: 'Général', az: 'Ümumi', tr: 'Genel', uk: 'Загальне', kk: 'Жалпы' },

  'notify.bookingTitle': { en: 'New booking', ru: 'Новая бронь', it: 'Nuova prenotazione', fr: 'Nouvelle réservation', az: 'Yeni rezerv', tr: 'Yeni rezervasyon', uk: 'Нове бронювання', kk: 'Жаңа брондау' },
  'notify.bookingTable': { en: 'Table', ru: 'Стол', it: 'Tavolo', fr: 'Table', az: 'Masa', tr: 'Masa', uk: 'Стіл', kk: 'Үстел' },
  'notify.lowStockTitle': { en: 'Low stock alert', ru: 'Товар заканчивается', it: 'Scorte in esaurimento', fr: 'Stock bas', az: 'Stok azalması', tr: 'Stok uyarısı', uk: 'Сповіщення про запаси', kk: 'Қор азаю ескертуі' },

  // Дайджест кассы при закрытии смены (secureBody) — лейблы сегментов, суммы приходят
  // уже отформатированными строками (см. secureBodySegments в lib/notify.ts).
  'notify.dRevenue':    { en: 'Revenue', ru: 'Выручка', it: 'Ricavi', fr: 'Recettes', az: 'Gəlir', tr: 'Ciro', uk: 'Виручка', kk: 'Түсім' },
  'notify.dCard':       { en: 'card', ru: 'карта', it: 'carta', fr: 'carte', az: 'kart', tr: 'kart', uk: 'карта', kk: 'карта' },
  'notify.dExpense':    { en: 'Expense', ru: 'Расход', it: 'Spesa', fr: 'Dépense', az: 'Xərc', tr: 'Gider', uk: 'Витрата', kk: 'Шығыс' },
  'notify.dCollection': { en: 'Collection', ru: 'Инкасс.', it: 'Versamento', fr: 'Encaissement', az: 'İnkassasiya', tr: 'Tahsilat', uk: 'Інкасація', kk: 'Инкассация' },
  'notify.dCash':       { en: 'Cash', ru: 'Касса', it: 'Cassa', fr: 'Caisse', az: 'Kassa', tr: 'Kasa', uk: 'Каса', kk: 'Касса' },
  'notify.dHookah':     { en: 'Hookah', ru: 'Кальяны', it: 'Narghilè', fr: 'Chicha', az: 'Qəlyan', tr: 'Nargile', uk: 'Кальяни', kk: 'Кальян' },
  'notify.dBalance':    { en: 'Balance', ru: 'Остаток', it: 'Saldo', fr: 'Solde', az: 'Qalıq', tr: 'Bakiye', uk: 'Залишок', kk: 'Қалдық' },
}

const CAT_KEYS: Record<string, string> = {
  kitchen: 'notify.catKitchen', bar: 'notify.catBar', hookah: 'notify.catHookah',
  household: 'notify.catHousehold', general: 'notify.catGeneral',
}

function isNotifyLocale(v: string | null | undefined): v is NotifyLocale {
  return !!v && v in { en: 1, ru: 1, it: 1, fr: 1, az: 1, tr: 1, uk: 1, kk: 1 }
}

export function renderNotify(locale: string | null | undefined, key: string, vars?: Record<string, string | number>): string {
  const loc: NotifyLocale = isNotifyLocale(locale) ? locale : 'en'
  const row = NOTIFY_STRINGS[key]
  let s = row?.[loc] ?? row?.en ?? key
  if (vars) for (const k in vars) s = s.split(`{${k}}`).join(String(vars[k]))
  return s.replace(/\s+/g, ' ').trim()
}

// Категория закупа: известные цеха переводятся, произвольные (пользовательские) — как есть.
export function renderCategory(locale: string | null | undefined, raw: string): string {
  const key = CAT_KEYS[raw]
  return key ? renderNotify(locale, key) : raw
}

// Составной текст из сегментов. key задан → «лейбл value» (лейбл переводится, value — как
// прислали, уже отформатированная строка); key не задан → голый value (напр. имя гостя,
// время брони — нечего переводить). sep — разделитель ПЕРЕД сегментом (по умолчанию ' · ').
export function renderSegments(locale: string | null | undefined, segments: { key?: string; value: string; sep?: string }[]): string {
  return segments.map((s, i) => {
    const text = s.key ? `${renderNotify(locale, s.key)} ${s.value}` : s.value
    return i === 0 ? text : `${s.sep ?? ' · '}${text}`
  }).join('')
}
