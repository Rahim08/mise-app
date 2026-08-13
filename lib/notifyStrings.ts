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
  // Тело кассовых пушей несёт дату смены (не дубль заголовка «Касса открыта/Смена открыта»);
  // {date} = dd.MM — важно при открытии/закрытии задним числом. Пустой {date} схлопывается trim'ом.
  'notify.cashOpenTitle':  { en: 'Cash opened', ru: 'Касса открыта', it: 'Cassa aperta', fr: 'Caisse ouverte', az: 'Kassa açıldı', tr: 'Kasa açıldı', uk: 'Касу відкрито', kk: 'Касса ашылды' },
  'notify.cashOpenBody':   { en: 'Shift for {date}', ru: 'Смена за {date}', it: 'Turno del {date}', fr: 'Service du {date}', az: '{date} növbəsi', tr: '{date} vardiyası', uk: 'Зміна за {date}', kk: '{date} ауысымы' },
  'notify.cashCloseTitle': { en: 'Cash closed', ru: 'Касса закрыта', it: 'Cassa chiusa', fr: 'Caisse fermée', az: 'Kassa bağlandı', tr: 'Kasa kapandı', uk: 'Касу закрито', kk: 'Касса жабылды' },
  'notify.cashCloseBody':  { en: 'Shift for {date}', ru: 'Смена за {date}', it: 'Turno del {date}', fr: 'Service du {date}', az: '{date} növbəsi', tr: '{date} vardiyası', uk: 'Зміна за {date}', kk: '{date} ауысымы' },

  'notify.newTaskTitle':   { en: 'New task', ru: 'Новая задача', it: 'Nuova attività', fr: 'Nouvelle tâche', az: 'Yeni tapşırıq', tr: 'Yeni görev', uk: 'Нове завдання', kk: 'Жаңа тапсырма' },

  'notify.swapRequestTitle':  { en: 'Swap request', ru: 'Запрос на обмен', it: 'Richiesta di scambio', fr: 'Demande d’échange', az: 'Növbə dəyişmə sorğusu', tr: 'Vardiya takas talebi', uk: 'Запит на обмін', kk: 'Ауысым алмасу сұранысы' },
  'notify.swapRequestBody':   { en: '{name} is offering a shift swap {date}', ru: '{name} предлагает поменяться сменами {date}', it: '{name} propone uno scambio di turno {date}', fr: '{name} propose un échange de service {date}', az: '{name} növbə dəyişməyi təklif edir {date}', tr: '{name} vardiya takası öneriyor {date}', uk: '{name} пропонує обмінятися змінами {date}', kk: '{name} ауысым алмасуды ұсынады {date}' },
  'notify.swapPendingTitle':  { en: 'Swap pending approval', ru: 'Обмен на согласование', it: 'Scambio in approvazione', fr: 'Échange en attente d’approbation', az: 'Dəyişim təsdiq gözləyir', tr: 'Takas onay bekliyor', uk: 'Обмін на погодження', kk: 'Алмасу мақұлдауды күтуде' },
  'notify.swapPendingBody':   { en: 'Colleague accepted the swap — needs manager approval', ru: 'Коллега принял(а) обмен — нужно одобрение менеджера', it: 'Il collega ha accettato lo scambio — serve l’approvazione del manager', fr: 'Le collègue a accepté l’échange — approbation du manager requise', az: 'Həmkar dəyişimi qəbul etdi — menecer təsdiqi lazımdır', tr: 'Meslektaş takası kabul etti — yönetici onayı gerekiyor', uk: 'Колега прийняв(ла) обмін — потрібне схвалення менеджера', kk: 'Әріптес алмасуды қабылдады — менеджер мақұлдауы қажет' },
  'notify.swapDeclinedTitle': { en: 'Swap declined', ru: 'Обмен отклонён', it: 'Scambio rifiutato', fr: 'Échange refusé', az: 'Dəyişim rədd edildi', tr: 'Takas reddedildi', uk: 'Обмін відхилено', kk: 'Алмасу қабылданбады' },
  'notify.swapDeclinedByPeerBody':    { en: 'Colleague declined the swap request', ru: 'Коллега отклонил(а) запрос на обмен', it: 'Il collega ha rifiutato la richiesta di scambio', fr: 'Le collègue a refusé la demande d’échange', az: 'Həmkar dəyişim sorğusunu rədd etdi', tr: 'Meslektaş takas talebini reddetti', uk: 'Колега відхилив(ла) запит на обмін', kk: 'Әріптес алмасу сұранысын қабылдамады' },
  'notify.swapDeclinedByManagerBody': { en: 'Manager declined the swap', ru: 'Менеджер отклонил(а) обмен', it: 'Il manager ha rifiutato lo scambio', fr: 'Le manager a refusé l’échange', az: 'Menecer dəyişimi rədd etdi', tr: 'Yönetici takası reddetti', uk: 'Менеджер відхилив(ла) обмін', kk: 'Менеджер алмасуды қабылдамады' },
  'notify.swapApprovedTitle': { en: 'Swap approved', ru: 'Обмен одобрен', it: 'Scambio approvato', fr: 'Échange approuvé', az: 'Dəyişim təsdiqləndi', tr: 'Takas onaylandı', uk: 'Обмін схвалено', kk: 'Алмасу мақұлданды' },
  'notify.swapApprovedBody':  { en: 'Shift reassigned to colleague', ru: 'Смена переназначена коллеге', it: 'Turno riassegnato al collega', fr: 'Service réattribué au collègue', az: 'Növbə həmkara yenidən təyin edildi', tr: 'Vardiya meslektaşa yeniden atandı', uk: 'Зміну перепризначено колезі', kk: 'Ауысым әріптеске қайта тағайындалды' },

  'notify.attendanceTitle':    { en: 'Staff on shift', ru: 'Сотрудник на смене', it: 'Personale in turno', fr: 'Personnel en service', az: 'İşçi növbədə', tr: 'Personel vardiyada', uk: 'Персонал на зміні', kk: 'Қызметкер ауысымда' },
  'notify.attendanceBody':     { en: '{name} checked in', ru: '{name} пришёл(а)', it: '{name} è arrivato/a', fr: '{name} est arrivé(e)', az: '{name} gəldi', tr: '{name} geldi', uk: '{name} прийшов(ла)', kk: '{name} келді' },
  'notify.attendanceBodyLate': { en: '{name} checked in (+{min} min)', ru: '{name} пришёл(а) (+{min} мин)', it: '{name} è arrivato/a (+{min} min)', fr: '{name} est arrivé(e) (+{min} min)', az: '{name} gəldi (+{min} dəq)', tr: '{name} geldi (+{min} dk)', uk: '{name} прийшов(ла) (+{min} хв)', kk: '{name} келді (+{min} мин)' },

  'notify.newReportTitle':        { en: 'New request', ru: 'Новая заявка', it: 'Nuova richiesta', fr: 'Nouvelle demande', az: 'Yeni sorğu', tr: 'Yeni talep', uk: 'Нова заявка', kk: 'Жаңа өтініш' },
  'notify.purchaseTitle':         { en: '{category} · Purchase', ru: '{category} · Закуп', it: '{category} · Acquisti', fr: '{category} · Achats', az: '{category} · Satınalma', tr: '{category} · Satın alma', uk: '{category} · Закупівля', kk: '{category} · Сатып алу' },
  'notify.purchaseDigestTitle':   { en: 'Purchase — daily summary', ru: 'Закуп за день', it: 'Acquisti — riepilogo del giorno', fr: 'Achats — bilan du jour', az: 'Satınalma — günün xülasəsi', tr: 'Satın alma — günlük özet', uk: 'Закупівля за день', kk: 'Күндік сатып алу қорытындысы' },
  'notify.purchaseDigestBody':    { en: '{n} items to purchase', ru: '{n} позиц. к закупке', it: '{n} voci da acquistare', fr: '{n} articles à acheter', az: 'alınacaq {n} mövqe', tr: 'satın alınacak {n} kalem', uk: '{n} позиц. до закупівлі', kk: 'сатып алынатын {n} позиция' },
  'notify.purchasePositionsBody': { en: '{who}{n} items', ru: '{who}{n} позиц.', it: '{who}{n} voci', fr: '{who}{n} articles', az: '{who}{n} mövqe', tr: '{who}{n} kalem', uk: '{who}{n} позиц.', kk: '{who}{n} позиция' },
  'notify.catKitchen':   { en: 'Kitchen', ru: 'Кухня', it: 'Cucina', fr: 'Cuisine', az: 'Mətbəx', tr: 'Mutfak', uk: 'Кухня', kk: 'Ас үй' },
  'notify.catBar':       { en: 'Bar', ru: 'Бар', it: 'Bar', fr: 'Bar', az: 'Bar', tr: 'Bar', uk: 'Бар', kk: 'Бар' },
  'notify.catHookah':    { en: 'Hookah', ru: 'Кальян', it: 'Narghilè', fr: 'Chicha', az: 'Qəlyan', tr: 'Nargile', uk: 'Кальян', kk: 'Кальян' },
  'notify.catHousehold': { en: 'Household', ru: 'Хозтовары', it: 'Casalinghi', fr: 'Ménage', az: 'Təsərrüfat', tr: 'Ev gereçleri', uk: 'Господарські', kk: 'Шаруашылық' },
  'notify.catGeneral':   { en: 'General', ru: 'Общее', it: 'Generale', fr: 'Général', az: 'Ümumi', tr: 'Genel', uk: 'Загальне', kk: 'Жалпы' },

  // Cron: напоминание о завтрашней смене + окончание триала (аудит-находка 4).
  'notify.shiftReminderTitle':    { en: 'Shift reminder', ru: 'Напоминание о смене', it: 'Promemoria turno', fr: 'Rappel de service', az: 'Növbə xatırlatması', tr: 'Vardiya hatırlatması', uk: 'Нагадування про зміну', kk: 'Ауысым туралы еске салу' },
  'notify.shiftReminderBody':     { en: 'Your shift is tomorrow', ru: 'Ваша смена завтра', it: 'Il tuo turno è domani', fr: 'Votre service est demain', az: 'Növbəniz sabahdır', tr: 'Vardiyanız yarın', uk: 'Ваша зміна завтра', kk: 'Ауысымыңыз ертең' },
  'notify.shiftReminderBodyTime': { en: 'Your shift is tomorrow at {time}', ru: 'Ваша смена завтра в {time}', it: 'Il tuo turno è domani alle {time}', fr: 'Votre service est demain à {time}', az: 'Növbəniz sabah saat {time}', tr: 'Vardiyanız yarın saat {time}', uk: 'Ваша зміна завтра о {time}', kk: 'Ауысымыңыз ертең сағат {time}' },
  'notify.trialEndingTitle': { en: 'Trial ending', ru: 'Окончание пробного периода', it: 'La prova sta per finire', fr: 'Fin de la période d’essai', az: 'Sınaq müddəti bitir', tr: 'Deneme süresi bitiyor', uk: 'Закінчення пробного періоду', kk: 'Сынақ мерзімі аяқталады' },
  'notify.trialEndingBody':  { en: '{n} days left', ru: 'Осталось {n} дн.', it: 'Mancano {n} giorni', fr: 'Plus que {n} jours', az: '{n} gün qaldı', tr: '{n} gün kaldı', uk: 'Залишилось {n} дн.', kk: '{n} күн қалды' },

  'notify.bookingTitle': { en: 'New booking', ru: 'Новая бронь', it: 'Nuova prenotazione', fr: 'Nouvelle réservation', az: 'Yeni rezervasiya', tr: 'Yeni rezervasyon', uk: 'Нове бронювання', kk: 'Жаңа брондау' },
  'notify.bookingTable': { en: 'Table', ru: 'Стол', it: 'Tavolo', fr: 'Table', az: 'Masa', tr: 'Masa', uk: 'Стіл', kk: 'Үстел' },
  'notify.lowStockTitle': { en: 'Low stock alert', ru: 'Товар заканчивается', it: 'Scorte in esaurimento', fr: 'Stock bas', az: 'Stok azalması', tr: 'Stok uyarısı', uk: 'Запаси закінчуються', kk: 'Қор азаю ескертуі' },
  'notify.stashInTitle':       { en: 'Stock received', ru: 'Приход товара', it: 'Merce in arrivo', fr: 'Marchandise reçue', az: 'Mal daxil oldu', tr: 'Mal girişi', uk: 'Товар надійшов', kk: 'Тауар келді' },
  'notify.stashOutTitle':      { en: 'Issued to venue', ru: 'Выдача в зал', it: 'Consegnato alla sala', fr: 'Sorti vers la salle', az: 'Zala verildi', tr: 'Salona verildi', uk: 'Видано в зал', kk: 'Залға берілді' },
  'notify.stashWriteoffTitle': { en: 'Write-off', ru: 'Списание', it: 'Scarico', fr: 'Radiation', az: 'Silinmə', tr: 'Düşüm', uk: 'Списання', kk: 'Есептен шығару' },
  'notify.stashMovementBody':  { en: '{n} items', ru: '{n} позиций', it: '{n} voci', fr: '{n} articles', az: '{n} mövqe', tr: '{n} kalem', uk: '{n} позицій', kk: '{n} позиция' },

  // Дайджест кассы при закрытии смены (secureBody) — лейблы сегментов, суммы приходят
  // уже отформатированными строками (см. secureBodySegments в lib/notify.ts).
  'notify.dRevenue':    { en: 'Revenue', ru: 'Выручка', it: 'Ricavi', fr: 'Recettes', az: 'Gəlir', tr: 'Ciro', uk: 'Виручка', kk: 'Түсім' },
  'notify.dCard':       { en: 'card', ru: 'карта', it: 'carta', fr: 'carte', az: 'kart', tr: 'kart', uk: 'карта', kk: 'карта' },
  'notify.dExpense':    { en: 'Expense', ru: 'Расход', it: 'Spesa', fr: 'Dépense', az: 'Xərc', tr: 'Gider', uk: 'Витрата', kk: 'Шығыс' },
  'notify.dCollection': { en: 'Collection', ru: 'Инкасс.', it: 'Versamento', fr: 'Encaissement', az: 'İnkassasiya', tr: 'Tahsilat', uk: 'Інкасація', kk: 'Инкассация' },
  'notify.dCash':       { en: 'Cash', ru: 'Касса', it: 'Cassa', fr: 'Caisse', az: 'Kassa', tr: 'Kasa', uk: 'Каса', kk: 'Касса' },
  'notify.dHookah':     { en: 'Hookah', ru: 'Кальяны', it: 'Narghilè', fr: 'Chicha', az: 'Qəlyan', tr: 'Nargile', uk: 'Кальяни', kk: 'Кальян' },
  'notify.dBalance':    { en: 'Balance', ru: 'Остаток', it: 'Saldo', fr: 'Solde', az: 'Qalıq', tr: 'Bakiye', uk: 'Залишок', kk: 'Қалдық' },

  'notify.auditAssignedTitle': { en: 'New audit', ru: 'Новый аудит', it: 'Nuovo audit', fr: 'Nouvel audit', az: 'Yeni audit', tr: 'Yeni denetim', uk: 'Новий аудит', kk: 'Жаңа аудит' },
  'notify.auditAssignedBody':  { en: '{name} assigned "{title}"', ru: '{name} назначил(а) «{title}»', it: '{name} ha assegnato "{title}"', fr: '{name} a assigné « {title} »', az: '{name} "{title}" təyin etdi', tr: '{name} "{title}" atadı', uk: '{name} призначив(ла) «{title}»', kk: '{name} «{title}» тағайындады' },
  'notify.violationTitle':     { en: 'Audit violation', ru: 'Нарушение по аудиту', it: 'Violazione audit', fr: 'Violation d’audit', az: 'Audit pozuntusu', tr: 'Denetim ihlali', uk: 'Порушення аудиту', kk: 'Аудит бұзушылығы' },
  'notify.violationBody':      { en: '{item} — needs fixing', ru: '{item} — нужно исправить', it: '{item} — da correggere', fr: '{item} — à corriger', az: '{item} — düzəldilməlidir', tr: '{item} — düzeltilmeli', uk: '{item} — потрібно виправити', kk: '{item} — түзету қажет' },
  'notify.closeChecklistReminderTitle': { en: 'Closing checklist not done', ru: 'Чек-лист закрытия не пройден', it: 'Checklist di chiusura non completata', fr: 'Checklist de clôture non terminée', az: 'Bağlanış çek-listi tamamlanmayıb', tr: 'Kapanış kontrol listesi tamamlanmadı', uk: 'Чек-лист закриття не пройдено', kk: 'Жабылу тексеру тізімі толтырылмаған' },
  'notify.closeChecklistReminderBody':  { en: 'Check off the remaining items before closing', ru: 'Отметьте оставшиеся пункты до закрытия', it: 'Spunta i punti rimanenti prima della chiusura', fr: 'Cochez les éléments restants avant la clôture', az: 'Bağlanmazdan əvvəl qalan bəndləri qeyd edin', tr: 'Kapanıştan önce kalan maddeleri işaretleyin', uk: 'Відмітьте решту пунктів до закриття', kk: 'Жабу алдында қалған тармақтарды белгілеңіз' },

  // Напоминание за N дней до дня выдачи ЗП (restaurant_settings.salary_payout_day, 2026-07-28):
  // due/reserve приходят уже отформатированными строками с валютой ресторана.
  'notify.salaryPayoutSoonTitle': { en: 'Salary payout soon', ru: 'Скоро выплата ЗП', it: 'Pagamento stipendi a breve', fr: 'Versement du salaire bientôt', az: 'Maaş ödənişi tezliklə', tr: 'Maaş ödemesi yaklaşıyor', uk: 'Скоро виплата ЗП', kk: 'Жалақы төлемі жақында' },
  'notify.salaryPayoutSoonBody':  { en: '{days} days left — due {due}, reserve {reserve}', ru: 'Через {days} дн. выплата — к оплате {due}, в резерве {reserve}', it: 'Mancano {days} giorni — da pagare {due}, riserva {reserve}', fr: 'Dans {days} jours — à verser {due}, réserve {reserve}', az: '{days} gün qalıb — ödəniləcək {due}, ehtiyatda {reserve}', tr: '{days} gün kaldı — ödenecek {due}, rezervde {reserve}', uk: 'Через {days} дн. виплата — до оплати {due}, у резерві {reserve}', kk: '{days} күн қалды — төленеді {due}, резервте {reserve}' },
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
  // Защита от незаполненной переменной (напр. звонок без bodyParams) — не показывать сырые {var}.
  s = s.replace(/\{[a-zA-Z_]+\}/g, '')
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
