'use client'
// Mise i18n — лёгкий клиентский словарь без зависимостей.
// • В приложениях (Capacitor IPA): язык берётся из системы iPhone (navigator.language),
//   пользователь не переключает вручную.
// • На сайте/дашборде: глобус-переключатель, выбор сохраняется в localStorage.
// Подход: один словарь STRINGS (ключ → переводы по локалям), фолбэк на английский.
// Переводы сгенерированы ИИ один раз; источник правды — en/ru, остальные правятся по месту.
import { useSyncExternalStore } from 'react'

export const SUPPORTED_LOCALES = [
  { code: 'en', native: 'English' },
  { code: 'ru', native: 'Русский' },
  { code: 'it', native: 'Italiano' },
  { code: 'fr', native: 'Français' },
  { code: 'az', native: 'Azərbaycan' },
  { code: 'tr', native: 'Türkçe' },
  { code: 'uk', native: 'Українська' },
  { code: 'kk', native: 'Қазақша' },
] as const

export type Locale = typeof SUPPORTED_LOCALES[number]['code']
export const DEFAULT_LOCALE: Locale = 'en'
const LS_KEY = 'mise_lang'
const isLocale = (v: string): v is Locale => SUPPORTED_LOCALES.some(l => l.code === v)

// ── Detection ─────────────────────────────────────────────────────────────────
function detect(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE
  const saved = localStorage.getItem(LS_KEY)
  if (saved && isLocale(saved)) return saved
  // navigator.languages в WKWebView отражает язык системы iPhone
  for (const tag of navigator.languages || [navigator.language]) {
    const code = tag.slice(0, 2).toLowerCase()
    if (isLocale(code)) return code
  }
  return DEFAULT_LOCALE
}

// ── External store (общий для всех компонентов, без провайдера) ────────────────
let current: Locale | null = null
const listeners = new Set<() => void>()
function getSnapshot(): Locale {
  if (current === null) current = detect()
  return current
}
function getServerSnapshot(): Locale { return DEFAULT_LOCALE }
function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } }

export function setLocale(l: Locale) {
  current = l
  try { localStorage.setItem(LS_KEY, l) } catch {}
  listeners.forEach(fn => fn())
}

// ── Hook ────────────────────────────────────────────────────────────────────────
export function useI18n() {
  const locale = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const t = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars)
  return { locale, setLocale, t }
}

function translate(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const row = STRINGS[key]
  let s = row?.[locale] ?? row?.[DEFAULT_LOCALE] ?? key
  if (vars) for (const k in vars) s = s.replaceAll(`{${k}}`, String(vars[k]))
  return s
}

// Перевод по текущей локали вне React-хука (для модульных функций-форматтеров).
// Безопасно: компонент-вызыватель подписан на useI18n и ререндерится при смене языка,
// а current обновляется синхронно в setLocale до уведомления слушателей.
export function tCurrent(key: string, vars?: Record<string, string | number>): string {
  return translate(getSnapshot(), key, vars)
}

// ── Language switcher (глобус) ───────────────────────────────────────────────────
import { useState, useRef, useEffect } from 'react'

export function LanguageSwitcher({ color = '#6d6d72' }: { color?: string }) {
  const { locale, setLocale } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} aria-label="Language" style={{
        display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
        cursor: 'pointer', color, fontFamily: 'inherit', fontSize: '.82rem', fontWeight: 600, padding: '6px 8px',
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18" />
        </svg>
        {SUPPORTED_LOCALES.find(l => l.code === locale)?.code.toUpperCase()}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 50, minWidth: 160,
          background: 'var(--surface,#fff)', borderRadius: 14, padding: 6,
          boxShadow: '0 8px 30px rgba(0,0,0,.16)', border: '1px solid rgba(60,60,67,.1)',
        }}>
          {SUPPORTED_LOCALES.map(l => (
            <button key={l.code} onClick={() => { setLocale(l.code); setOpen(false) }} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
              padding: '9px 12px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: '.86rem', fontWeight: locale === l.code ? 700 : 500, textAlign: 'left',
              background: locale === l.code ? 'rgba(0,122,255,.08)' : 'transparent',
              color: locale === l.code ? '#007aff' : 'var(--tx,#1c1c1e)',
            }}>
              {l.native}
              {locale === l.code && <svg width="13" height="11" fill="none" stroke="#007aff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 13 11"><path d="M1 6l3.5 3.5L12 1" /></svg>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Dictionary ────────────────────────────────────────────────────────────────────
// Ключ → переводы. Отсутствующий перевод фолбэчит на en. Источник правды — en/ru.
type Row = Partial<Record<Locale, string>>
const STRINGS: Record<string, Row> = {
  // ── Mise Manager ──
  'mg.statusOpen':   { en: 'Open', ru: 'Открыта', it: 'Aperto', fr: 'Ouvert', az: 'Açıq', tr: 'Açık', uk: 'Відкрита', kk: 'Ашық' },
  'mg.statusClosed': { en: 'Closed', ru: 'Закрыта', it: 'Chiuso', fr: 'Fermé', az: 'Bağlı', tr: 'Kapalı', uk: 'Закрита', kk: 'Жабық' },
  'mg.dayOf':        { en: 'Day {n} of {m}', ru: 'День {n} из {m}', it: 'Giorno {n} di {m}', fr: 'Jour {n} sur {m}', az: '{m} gündən {n}-ci', tr: '{m} günün {n}. günü', uk: 'День {n} з {m}', kk: '{m} күннің {n}-і' },
  'mg.emptyTitle':   { en: 'Shift not open', ru: 'Смена не открыта', it: 'Turno non aperto', fr: 'Service non ouvert', az: 'Növbə açıq deyil', tr: 'Vardiya açık değil', uk: 'Зміна не відкрита', kk: 'Ауысым ашылмаған' },
  'mg.emptySub':     { en: 'Tap to start the day', ru: 'Нажмите чтобы начать рабочий день', it: 'Tocca per iniziare la giornata', fr: 'Appuyez pour commencer la journée', az: 'Günü başlamaq üçün toxunun', tr: 'Günü başlatmak için dokunun', uk: 'Натисніть, щоб почати робочий день', kk: 'Жұмыс күнін бастау үшін басыңыз' },
  'mg.openShift':    { en: 'Open shift', ru: 'Открыть смену', it: 'Apri turno', fr: 'Ouvrir le service', az: 'Növbəni aç', tr: 'Vardiyayı aç', uk: 'Відкрити зміну', kk: 'Ауысымды ашу' },
  'mg.shiftOpened':  { en: 'Shift opened', ru: 'Смена открыта', it: 'Turno aperto', fr: 'Service ouvert', az: 'Növbə açıldı', tr: 'Vardiya açıldı', uk: 'Зміну відкрито', kk: 'Ауысым ашылды' },
  'mg.shiftSaved':   { en: 'Shift saved', ru: 'Смена сохранена', it: 'Turno salvato', fr: 'Service enregistré', az: 'Növbə yadda saxlanıldı', tr: 'Vardiya kaydedildi', uk: 'Зміну збережено', kk: 'Ауысым сақталды' },
  'mg.err':          { en: 'Error', ru: 'Ошибка', it: 'Errore', fr: 'Erreur', az: 'Xəta', tr: 'Hata', uk: 'Помилка', kk: 'Қате' },
  'mg.notSaved':     { en: 'not saved', ru: 'не сохранилось', it: 'non salvato', fr: 'non enregistré', az: 'yadda saxlanılmadı', tr: 'kaydedilmedi', uk: 'не збереглося', kk: 'сақталмады' },
  'mg.autosaveErr':  { en: 'Autosave error', ru: 'Ошибка автосохранения', it: 'Errore di salvataggio automatico', fr: 'Erreur de sauvegarde auto', az: 'Avtosaxlama xətası', tr: 'Otomatik kaydetme hatası', uk: 'Помилка автозбереження', kk: 'Автосақтау қатесі' },
  'mg.secStaff':     { en: 'Staff', ru: 'Сотрудники', it: 'Personale', fr: 'Personnel', az: 'İşçilər', tr: 'Personel', uk: 'Працівники', kk: 'Қызметкерлер' },
  'mg.secExpenses':  { en: "Day's expenses", ru: 'Расходы дня', it: 'Spese del giorno', fr: 'Dépenses du jour', az: 'Günün xərcləri', tr: 'Günün giderleri', uk: 'Витрати дня', kk: 'Күн шығыстары' },
  'mg.secCollection':{ en: 'Cash collection', ru: 'Инкассация', it: 'Versamento', fr: 'Encaissement', az: 'İnkassasiya', tr: 'Kasa devri', uk: 'Інкасація', kk: 'Инкассация' },
  'mg.secRegister':  { en: 'Register', ru: 'Касса', it: 'Cassa', fr: 'Caisse', az: 'Kassa', tr: 'Kasa', uk: 'Каса', kk: 'Касса' },
  'mg.auto':         { en: 'auto', ru: 'авто', it: 'auto', fr: 'auto', az: 'avto', tr: 'oto', uk: 'авто', kk: 'авто' },
  'mg.autoTitle':    { en: 'Auto no-show by geo-check. Review and save the shift.', ru: 'Авто-прогул по геоконтролю. Проверьте и сохраните смену.', it: 'Assenza automatica via geo-controllo. Controlla e salva il turno.', fr: 'Absence auto par géo-contrôle. Vérifiez et enregistrez le service.', az: 'Geo-nəzarətlə avtomatik qayıblıq. Yoxlayıb növbəni yadda saxlayın.', tr: 'Geo-kontrol ile otomatik devamsızlık. Vardiyayı kontrol edip kaydedin.', uk: 'Авто-прогул за геоконтролем. Перевірте та збережіть зміну.', kk: 'Гео-бақылау бойынша авто-келмеу. Тексеріп, ауысымды сақтаңыз.' },
  'mg.phComment':    { en: 'Comment...', ru: 'Комментарий...', it: 'Commento...', fr: 'Commentaire...', az: 'Şərh...', tr: 'Yorum...', uk: 'Коментар...', kk: 'Пікір...' },
  'mg.phPurpose':    { en: 'Describe the purpose...', ru: 'Опишите назначение...', it: 'Descrivi lo scopo...', fr: "Décrivez l'objet...", az: 'Təyinatı təsvir edin...', tr: 'Amacı açıklayın...', uk: 'Опишіть призначення...', kk: 'Мақсатын сипаттаңыз...' },
  'mg.phPaidTo':     { en: 'Paid to...', ru: 'Кому выплачено...', it: 'Pagato a...', fr: 'Versé à...', az: 'Kimə ödənilib...', tr: 'Kime ödendi...', uk: 'Кому виплачено...', kk: 'Кімге төленді...' },
  'mg.inkSum':       { en: 'Amount', ru: 'Сумма', it: 'Importo', fr: 'Montant', az: 'Məbləğ', tr: 'Tutar', uk: 'Сума', kk: 'Сома' },
  'mg.expense':      { en: 'Expense', ru: 'Расход', it: 'Spesa', fr: 'Dépense', az: 'Xərc', tr: 'Gider', uk: 'Витрата', kk: 'Шығыс' },
  'mg.inkReason':    { en: 'Reason', ru: 'Причина', it: 'Motivo', fr: 'Motif', az: 'Səbəb', tr: 'Sebep', uk: 'Причина', kk: 'Себеп' },
  'mg.inkSalary':    { en: 'Salary payout', ru: 'Выплата зарплаты', it: 'Pagamento stipendio', fr: 'Versement de salaire', az: 'Maaş ödənişi', tr: 'Maaş ödemesi', uk: 'Виплата зарплати', kk: 'Жалақы төлемі' },
  'mg.inkSalaryHint':{ en: 'deducted from collection', ru: 'вычитается из инкассации', it: 'detratto dal versamento', fr: "déduit de l'encaissement", az: 'inkassasiyadan çıxılır', tr: 'kasa devrinden düşülür', uk: 'віднімається з інкасації', kk: 'инкассациядан шегеріледі' },
  'mg.inkNet':       { en: 'Collection total', ru: 'Итог инкассации', it: 'Totale versamento', fr: "Total de l'encaissement", az: 'İnkassasiya yekunu', tr: 'Kasa devri toplamı', uk: 'Підсумок інкасації', kk: 'Инкассация қорытындысы' },
  'mg.inkNetHint':   { en: 'after expense and salary', ru: 'после расхода и зарплаты', it: 'dopo spesa e stipendio', fr: 'après dépense et salaire', az: 'xərc və maaşdan sonra', tr: 'gider ve maaştan sonra', uk: 'після витрати та зарплати', kk: 'шығыс пен жалақыдан кейін' },
  'mg.cash':         { en: 'Cash', ru: 'Наличные', it: 'Contanti', fr: 'Espèces', az: 'Nağd', tr: 'Nakit', uk: 'Готівка', kk: 'Қолма-қол' },
  'mg.cardLine':     { en: 'Card · cashless', ru: 'Безнал · карта', it: 'Carta · cashless', fr: 'Carte · sans espèces', az: 'Kart · nağdsız', tr: 'Kart · nakitsiz', uk: 'Безгот · картка', kk: 'Картa · қолма-қолсыз' },
  'mg.cardHint':     { en: 'not part of the register', ru: 'в кассу не входит', it: 'non rientra in cassa', fr: 'hors caisse', az: 'kassaya daxil deyil', tr: 'kasaya dahil değil', uk: 'до каси не входить', kk: 'кассаға кірмейді' },
  'mg.totalIncome':  { en: 'Total income (cash + card)', ru: 'Общий доход (нал + безнал)', it: 'Incasso totale (contanti + carta)', fr: 'Revenu total (espèces + carte)', az: 'Ümumi gəlir (nağd + kart)', tr: 'Toplam gelir (nakit + kart)', uk: 'Загальний дохід (готівка + картка)', kk: 'Жалпы кіріс (қолма-қол + карта)' },
  'mg.cellIn':       { en: 'Opening', ru: 'Вход', it: 'Apertura', fr: 'Ouverture', az: 'Giriş', tr: 'Açılış', uk: 'Вхід', kk: 'Кіру' },
  'mg.cellBalance':  { en: 'Balance', ru: 'Остаток', it: 'Saldo', fr: 'Solde', az: 'Qalıq', tr: 'Bakiye', uk: 'Залишок', kk: 'Қалдық' },
  'mg.registerEnd':  { en: 'Register at shift end', ru: 'Касса на конец смены', it: 'Cassa a fine turno', fr: 'Caisse en fin de service', az: 'Növbə sonunda kassa', tr: 'Vardiya sonu kasa', uk: 'Каса на кінець зміни', kk: 'Ауысым соңындағы касса' },
  'mg.save':         { en: 'Save shift', ru: 'Сохранить смену', it: 'Salva turno', fr: 'Enregistrer le service', az: 'Növbəni yadda saxla', tr: 'Vardiyayı kaydet', uk: 'Зберегти зміну', kk: 'Ауысымды сақтау' },
  'mg.edit':         { en: 'Edit', ru: 'Редактировать', it: 'Modifica', fr: 'Modifier', az: 'Redaktə et', tr: 'Düzenle', uk: 'Редагувати', kk: 'Өңдеу' },
  'mg.sumTitle':     { en: 'Shift summary', ru: 'Сводка смены', it: 'Riepilogo turno', fr: 'Récapitulatif du service', az: 'Növbə xülasəsi', tr: 'Vardiya özeti', uk: 'Зведення зміни', kk: 'Ауысым қорытындысы' },
  'mg.sumDate':      { en: 'Date', ru: 'Дата', it: 'Data', fr: 'Date', az: 'Tarix', tr: 'Tarih', uk: 'Дата', kk: 'Күні' },
  'mg.sumCard':      { en: 'Card (cashless)', ru: 'Безнал (карта)', it: 'Carta (cashless)', fr: 'Carte (sans espèces)', az: 'Kart (nağdsız)', tr: 'Kart (nakitsiz)', uk: 'Безгот (картка)', kk: 'Картa (қолма-қолсыз)' },
  'mg.sumTotalIncome':{ en: 'Total income', ru: 'Общий доход', it: 'Incasso totale', fr: 'Revenu total', az: 'Ümumi gəlir', tr: 'Toplam gelir', uk: 'Загальний дохід', kk: 'Жалпы кіріс' },
  'mg.extra':        { en: 'extra', ru: 'экстра', it: 'extra', fr: 'extra', az: 'əlavə', tr: 'ekstra', uk: 'екстра', kk: 'қосымша' },
  'mg.inkExpenseShort':{ en: 'Expense from collection', ru: 'Расход из инкасс', it: 'Spesa dal versamento', fr: "Dépense de l'encaissement", az: 'İnkassasiyadan xərc', tr: 'Kasa devrinden gider', uk: 'Витрата з інкасації', kk: 'Инкассациядан шығыс' },
  'mg.salaryShort':  { en: 'Salary from collection', ru: 'Зарплата из инкасс', it: 'Stipendio dal versamento', fr: "Salaire de l'encaissement", az: 'İnkassasiyadan maaş', tr: 'Kasa devrinden maaş', uk: 'Зарплата з інкасації', kk: 'Инкассациядан жалақы' },
  'mg.sumTotalExpense':{ en: 'Total expense', ru: 'Итого расход', it: 'Spesa totale', fr: 'Dépense totale', az: 'Ümumi xərc', tr: 'Toplam gider', uk: 'Усього витрат', kk: 'Жиыны шығыс' },
  'mg.absent':       { en: 'Absent', ru: 'Отсутствовали', it: 'Assenti', fr: 'Absents', az: 'Olmayanlar', tr: 'Devamsızlar', uk: 'Були відсутні', kk: 'Болмағандар' },
  'mg.cancel':       { en: 'Cancel', ru: 'Отмена', it: 'Annulla', fr: 'Annuler', az: 'Ləğv et', tr: 'İptal', uk: 'Скасувати', kk: 'Бас тарту' },
  'mg.confirm':      { en: 'Confirm', ru: 'Подтвердить', it: 'Conferma', fr: 'Confirmer', az: 'Təsdiqlə', tr: 'Onayla', uk: 'Підтвердити', kk: 'Растау' },
  'mg.saving':       { en: 'Saving...', ru: 'Сохраняем...', it: 'Salvataggio...', fr: 'Enregistrement...', az: 'Saxlanılır...', tr: 'Kaydediliyor...', uk: 'Збереження...', kk: 'Сақталуда...' },

  // ── Mise Menu (editor) ──
  'me.themeLight':   { en: 'Light', ru: 'Светлая', it: 'Chiaro', fr: 'Clair', az: 'İşıqlı', tr: 'Açık', uk: 'Світла', kk: 'Ашық' },
  'me.themeDark':    { en: 'Dark', ru: 'Тёмная', it: 'Scuro', fr: 'Sombre', az: 'Qaranlıq', tr: 'Koyu', uk: 'Темна', kk: 'Қараңғы' },
  'me.themeAuto':    { en: 'Auto', ru: 'Авто', it: 'Auto', fr: 'Auto', az: 'Avto', tr: 'Oto', uk: 'Авто', kk: 'Авто' },
  'me.photoErr':     { en: 'Photo upload error', ru: 'Ошибка загрузки фото', it: 'Errore di caricamento foto', fr: 'Erreur de chargement photo', az: 'Foto yükləmə xətası', tr: 'Fotoğraf yükleme hatası', uk: 'Помилка завантаження фото', kk: 'Фото жүктеу қатесі' },
  'me.slugTaken':    { en: 'This address is taken', ru: 'Этот адрес уже занят', it: 'Questo indirizzo è occupato', fr: 'Cette adresse est prise', az: 'Bu ünvan tutulub', tr: 'Bu adres alınmış', uk: 'Ця адреса вже зайнята', kk: 'Бұл мекенжай бос емес' },
  'me.settingsSaved':{ en: 'Settings saved', ru: 'Настройки сохранены', it: 'Impostazioni salvate', fr: 'Réglages enregistrés', az: 'Tənzimləmələr yadda saxlanıldı', tr: 'Ayarlar kaydedildi', uk: 'Налаштування збережено', kk: 'Баптаулар сақталды' },
  'me.delCatConfirm':{ en: 'Delete the category and all items in it?', ru: 'Удалить категорию и все позиции в ней?', it: 'Eliminare la categoria e tutti i suoi articoli?', fr: 'Supprimer la catégorie et tous ses articles ?', az: 'Kateqoriyanı və içindəki bütün məhsulları silmək?', tr: 'Kategori ve içindeki tüm ürünler silinsin mi?', uk: 'Видалити категорію та всі позиції в ній?', kk: 'Санатты және ондағы барлық позицияны жою керек пе?' },
  'me.itemUpdated':  { en: 'Item updated', ru: 'Позиция обновлена', it: 'Articolo aggiornato', fr: 'Article mis à jour', az: 'Məhsul yeniləndi', tr: 'Ürün güncellendi', uk: 'Позицію оновлено', kk: 'Позиция жаңартылды' },
  'me.itemAdded':    { en: 'Item added', ru: 'Позиция добавлена', it: 'Articolo aggiunto', fr: 'Article ajouté', az: 'Məhsul əlavə edildi', tr: 'Ürün eklendi', uk: 'Позицію додано', kk: 'Позиция қосылды' },
  'me.deleted':      { en: 'Deleted', ru: 'Удалено', it: 'Eliminato', fr: 'Supprimé', az: 'Silindi', tr: 'Silindi', uk: 'Видалено', kk: 'Жойылды' },
  'me.copied':       { en: 'Copied', ru: 'Скопировано', it: 'Copiato', fr: 'Copié', az: 'Kopyalandı', tr: 'Kopyalandı', uk: 'Скопійовано', kk: 'Көшірілді' },
  'me.tabMenu':      { en: 'Menu', ru: 'Меню', it: 'Menu', fr: 'Menu', az: 'Menyu', tr: 'Menü', uk: 'Меню', kk: 'Мәзір' },
  'me.tabSettings':  { en: 'Settings', ru: 'Настройки', it: 'Impostazioni', fr: 'Réglages', az: 'Tənzimləmələr', tr: 'Ayarlar', uk: 'Налаштування', kk: 'Баптаулар' },
  'me.tabPreview':   { en: 'Preview', ru: 'Предпросмотр', it: 'Anteprima', fr: 'Aperçu', az: 'Önizləmə', tr: 'Önizleme', uk: 'Перегляд', kk: 'Алдын ала қарау' },
  'me.published':    { en: 'Published', ru: 'Опубликовано', it: 'Pubblicato', fr: 'Publié', az: 'Dərc edilib', tr: 'Yayında', uk: 'Опубліковано', kk: 'Жарияланды' },
  'me.draft':        { en: 'Draft', ru: 'Черновик', it: 'Bozza', fr: 'Brouillon', az: 'Qaralama', tr: 'Taslak', uk: 'Чернетка', kk: 'Жоба' },
  'me.category':     { en: 'Category', ru: 'Категория', it: 'Categoria', fr: 'Catégorie', az: 'Kateqoriya', tr: 'Kategori', uk: 'Категорія', kk: 'Санат' },
  'me.itemsCount':   { en: '{n} items', ru: '{n} позиций', it: '{n} articoli', fr: '{n} articles', az: '{n} məhsul', tr: '{n} ürün', uk: '{n} позицій', kk: '{n} позиция' },
  'me.visible':      { en: 'Visible', ru: 'Видна', it: 'Visibile', fr: 'Visible', az: 'Görünür', tr: 'Görünür', uk: 'Видима', kk: 'Көрінеді' },
  'me.hidden':       { en: 'Hidden', ru: 'Скрыта', it: 'Nascosta', fr: 'Masquée', az: 'Gizli', tr: 'Gizli', uk: 'Прихована', kk: 'Жасырын' },
  'me.catEmpty':     { en: 'Category is empty', ru: 'Категория пуста', it: 'Categoria vuota', fr: 'Catégorie vide', az: 'Kateqoriya boşdur', tr: 'Kategori boş', uk: 'Категорія порожня', kk: 'Санат бос' },
  'me.catEmptySub':  { en: 'Add the first item', ru: 'Добавьте первую позицию', it: 'Aggiungi il primo articolo', fr: 'Ajoutez le premier article', az: 'İlk məhsulu əlavə edin', tr: 'İlk ürünü ekleyin', uk: 'Додайте першу позицію', kk: 'Алғашқы позицияны қосыңыз' },
  'me.addItem':      { en: 'Add item', ru: 'Добавить позицию', it: 'Aggiungi articolo', fr: 'Ajouter un article', az: 'Məhsul əlavə et', tr: 'Ürün ekle', uk: 'Додати позицію', kk: 'Позиция қосу' },
  'me.outOfStock':   { en: 'Out of stock', ru: 'Нет в наличии', it: 'Esaurito', fr: 'Rupture', az: 'Stokda yoxdur', tr: 'Stokta yok', uk: 'Немає в наявності', kk: 'Қоймада жоқ' },
  'me.hiddenBadge':  { en: 'Hidden', ru: 'Скрыто', it: 'Nascosto', fr: 'Masqué', az: 'Gizli', tr: 'Gizli', uk: 'Приховано', kk: 'Жасырын' },
  'me.menuEmpty':    { en: 'Menu is empty', ru: 'Меню пустое', it: 'Menu vuoto', fr: 'Menu vide', az: 'Menyu boşdur', tr: 'Menü boş', uk: 'Меню порожнє', kk: 'Мәзір бос' },
  'me.menuEmptySub': { en: 'Start by creating the first category', ru: 'Начните с создания первой категории', it: 'Inizia creando la prima categoria', fr: 'Commencez par créer la première catégorie', az: 'İlk kateqoriyanı yaratmaqla başlayın', tr: 'İlk kategoriyi oluşturarak başlayın', uk: 'Почніть зі створення першої категорії', kk: 'Алғашқы санатты құрудан бастаңыз' },
  'me.createCat':    { en: 'Create category', ru: 'Создать категорию', it: 'Crea categoria', fr: 'Créer une catégorie', az: 'Kateqoriya yarat', tr: 'Kategori oluştur', uk: 'Створити категорію', kk: 'Санат құру' },
  'me.publish':      { en: 'Publish menu', ru: 'Опубликовать меню', it: 'Pubblica menu', fr: 'Publier le menu', az: 'Menyunu dərc et', tr: 'Menüyü yayınla', uk: 'Опублікувати меню', kk: 'Мәзірді жариялау' },
  'me.publishSub':   { en: 'Guests can open the menu via a link', ru: 'Гости смогут открыть меню по ссылке', it: 'Gli ospiti potranno aprire il menu da un link', fr: 'Les clients pourront ouvrir le menu via un lien', az: 'Qonaqlar menyunu link vasitəsilə aça biləcək', tr: 'Misafirler menüyü bağlantıdan açabilir', uk: 'Гості зможуть відкрити меню за посиланням', kk: 'Қонақтар мәзірді сілтеме арқылы аша алады' },
  'me.cover':        { en: 'Cover', ru: 'Обложка', it: 'Copertina', fr: 'Couverture', az: 'Üz qabığı', tr: 'Kapak', uk: 'Обкладинка', kk: 'Мұқаба' },
  'me.uploading':    { en: 'Uploading…', ru: 'Загрузка…', it: 'Caricamento…', fr: 'Chargement…', az: 'Yüklənir…', tr: 'Yükleniyor…', uk: 'Завантаження…', kk: 'Жүктелуде…' },
  'me.replaceCover': { en: 'Replace cover', ru: 'Заменить обложку', it: 'Sostituisci copertina', fr: 'Remplacer la couverture', az: 'Üz qabığını dəyiş', tr: 'Kapağı değiştir', uk: 'Замінити обкладинку', kk: 'Мұқабаны ауыстыру' },
  'me.uploadCover':  { en: 'Upload cover', ru: 'Загрузить обложку', it: 'Carica copertina', fr: 'Charger une couverture', az: 'Üz qabığı yüklə', tr: 'Kapak yükle', uk: 'Завантажити обкладинку', kk: 'Мұқаба жүктеу' },
  'me.remove':       { en: 'Remove', ru: 'Убрать', it: 'Rimuovi', fr: 'Retirer', az: 'Sil', tr: 'Kaldır', uk: 'Прибрати', kk: 'Алып тастау' },
  'me.coverHint':    { en: 'Don’t forget to “Save settings” below', ru: 'Не забудьте «Сохранить настройки» ниже', it: 'Non dimenticare di “Salvare le impostazioni” sotto', fr: 'N’oubliez pas d’« Enregistrer les réglages » ci-dessous', az: 'Aşağıda «Tənzimləmələri yadda saxla»nı unutmayın', tr: 'Aşağıda “Ayarları kaydet”i unutmayın', uk: 'Не забудьте «Зберегти налаштування» нижче', kk: 'Төмендегі «Баптауларды сақтау»ды ұмытпаңыз' },
  'me.addr':         { en: 'Menu address', ru: 'Адрес меню', it: 'Indirizzo del menu', fr: 'Adresse du menu', az: 'Menyu ünvanı', tr: 'Menü adresi', uk: 'Адреса меню', kk: 'Мәзір мекенжайы' },
  'me.slugPh':       { en: 'venue-name', ru: 'название-заведения', it: 'nome-locale', fr: 'nom-etablissement', az: 'müəssisə-adı', tr: 'isletme-adi', uk: 'назва-закладу', kk: 'мекеме-аты' },
  'me.theme':        { en: 'Theme', ru: 'Тема', it: 'Tema', fr: 'Thème', az: 'Tema', tr: 'Tema', uk: 'Тема', kk: 'Тақырып' },
  'me.layout':       { en: 'Layout', ru: 'Раскладка', it: 'Layout', fr: 'Disposition', az: 'Tərtibat', tr: 'Düzen', uk: 'Розкладка', kk: 'Орналасу' },
  'me.list':         { en: 'List', ru: 'Список', it: 'Elenco', fr: 'Liste', az: 'Siyahı', tr: 'Liste', uk: 'Список', kk: 'Тізім' },
  'me.grid':         { en: 'Grid', ru: 'Сетка', it: 'Griglia', fr: 'Grille', az: 'Şəbəkə', tr: 'Izgara', uk: 'Сітка', kk: 'Тор' },
  'me.accent':       { en: 'Accent color', ru: 'Акцентный цвет', it: 'Colore accento', fr: 'Couleur d’accent', az: 'Vurğu rəngi', tr: 'Vurgu rengi', uk: 'Акцентний колір', kk: 'Екпін түсі' },
  'me.customColor':  { en: 'Custom color', ru: 'Свой цвет', it: 'Colore personalizzato', fr: 'Couleur perso', az: 'Öz rəngin', tr: 'Özel renk', uk: 'Свій колір', kk: 'Өз түсі' },
  'me.display':      { en: 'Display', ru: 'Отображение', it: 'Visualizzazione', fr: 'Affichage', az: 'Göstərmə', tr: 'Görünüm', uk: 'Відображення', kk: 'Көрсету' },
  'me.optPhotos':    { en: 'Dish photos', ru: 'Фотографии блюд', it: 'Foto dei piatti', fr: 'Photos des plats', az: 'Yemək fotoları', tr: 'Yemek fotoğrafları', uk: 'Фото страв', kk: 'Тағам фотолары' },
  'me.optPhotosD':   { en: 'Show item images', ru: 'Показывать изображения позиций', it: 'Mostra le immagini degli articoli', fr: 'Afficher les images des articles', az: 'Məhsul şəkillərini göstər', tr: 'Ürün görsellerini göster', uk: 'Показувати зображення позицій', kk: 'Позиция суреттерін көрсету' },
  'me.optCalories':  { en: 'Calories', ru: 'Калорийность', it: 'Calorie', fr: 'Calories', az: 'Kalorilik', tr: 'Kalori', uk: 'Калорійність', kk: 'Калория' },
  'me.optCaloriesD': { en: 'Show nutrition if provided', ru: 'Показывать КБЖУ если указано', it: 'Mostra i valori nutrizionali se indicati', fr: 'Afficher les valeurs nutritionnelles si fournies', az: 'Göstərilibsə qida dəyərlərini göstər', tr: 'Belirtilmişse besin değerlerini göster', uk: 'Показувати БЖВ якщо вказано', kk: 'Көрсетілсе тағамдық құнын көрсету' },
  'me.optAllergens': { en: 'Allergens', ru: 'Аллергены', it: 'Allergeni', fr: 'Allergènes', az: 'Allergenlər', tr: 'Alerjenler', uk: 'Алергени', kk: 'Аллергендер' },
  'me.optAllergensD':{ en: 'Show composition and allergens', ru: 'Показывать состав и аллергены', it: 'Mostra composizione e allergeni', fr: 'Afficher composition et allergènes', az: 'Tərkib və allergenləri göstər', tr: 'İçerik ve alerjenleri göster', uk: 'Показувати склад і алергени', kk: 'Құрам мен аллергендерді көрсету' },
  'me.optOrders':    { en: 'Order at the table', ru: 'Заказ за столом', it: 'Ordine al tavolo', fr: 'Commande à table', az: 'Masada sifariş', tr: 'Masadan sipariş', uk: 'Замовлення за столом', kk: 'Үстелде тапсырыс' },
  'me.optOrdersD':   { en: 'Guests can build a cart and send an order', ru: 'Гость может собрать корзину и отправить заказ', it: 'Gli ospiti possono creare un carrello e inviare un ordine', fr: 'Les clients peuvent composer un panier et envoyer une commande', az: 'Qonaq səbət yığıb sifariş göndərə bilər', tr: 'Misafir sepet oluşturup sipariş gönderebilir', uk: 'Гість може зібрати кошик і надіслати замовлення', kk: 'Қонақ себет жинап тапсырыс жібере алады' },
  'me.optPay':       { en: 'Pay at the table', ru: 'Оплата за столом', it: 'Pagamento al tavolo', fr: 'Paiement à table', az: 'Masada ödəniş', tr: 'Masada ödeme', uk: 'Оплата за столом', kk: 'Үстелде төлем' },
  'me.optPayD':      { en: 'Available when order-at-table is on', ru: 'Доступно при включённом заказе за столом', it: 'Disponibile con l’ordine al tavolo attivo', fr: 'Disponible si la commande à table est activée', az: 'Masada sifariş aktiv olduqda mövcuddur', tr: 'Masadan sipariş açıkken kullanılabilir', uk: 'Доступно за увімкненого замовлення за столом', kk: 'Үстелде тапсырыс қосулы кезде қолжетімді' },
  'me.saving':       { en: 'Saving...', ru: 'Сохранение...', it: 'Salvataggio...', fr: 'Enregistrement...', az: 'Saxlanılır...', tr: 'Kaydediliyor...', uk: 'Збереження...', kk: 'Сақталуда...' },
  'me.saveSettings': { en: 'Save settings', ru: 'Сохранить настройки', it: 'Salva impostazioni', fr: 'Enregistrer les réglages', az: 'Tənzimləmələri yadda saxla', tr: 'Ayarları kaydet', uk: 'Зберегти налаштування', kk: 'Баптауларды сақтау' },
  'me.ready':        { en: 'Your menu is ready', ru: 'Ваше меню готово', it: 'Il tuo menu è pronto', fr: 'Votre menu est prêt', az: 'Menyunuz hazırdır', tr: 'Menünüz hazır', uk: 'Ваше меню готове', kk: 'Мәзіріңіз дайын' },
  'me.readySub':     { en: 'Share the link or print the QR code', ru: 'Поделитесь ссылкой или распечатайте QR-код', it: 'Condividi il link o stampa il QR code', fr: 'Partagez le lien ou imprimez le QR code', az: 'Linki paylaşın və ya QR kodu çap edin', tr: 'Bağlantıyı paylaşın veya QR kodu yazdırın', uk: 'Поділіться посиланням або роздрукуйте QR-код', kk: 'Сілтемені бөлісіңіз немесе QR кодын басып шығарыңыз' },
  'me.copy':         { en: 'Copy', ru: 'Копировать', it: 'Copia', fr: 'Copier', az: 'Kopyala', tr: 'Kopyala', uk: 'Копіювати', kk: 'Көшіру' },
  'me.notPublished': { en: 'Menu not published — go to Settings and enable publishing', ru: 'Меню не опубликовано — перейдите в Настройки и включите публикацию', it: 'Menu non pubblicato — vai in Impostazioni e attiva la pubblicazione', fr: 'Menu non publié — allez dans Réglages et activez la publication', az: 'Menyu dərc edilməyib — Tənzimləmələrə keçin və dərci aktivləşdirin', tr: 'Menü yayında değil — Ayarlar’a gidip yayını açın', uk: 'Меню не опубліковано — перейдіть у Налаштування та увімкніть публікацію', kk: 'Мәзір жарияланбаған — Баптауларға өтіп, жариялауды қосыңыз' },
  'me.openMenu':     { en: 'Open menu', ru: 'Открыть меню', it: 'Apri menu', fr: 'Ouvrir le menu', az: 'Menyunu aç', tr: 'Menüyü aç', uk: 'Відкрити меню', kk: 'Мәзірді ашу' },
  'me.setAddr':      { en: 'Set a menu address', ru: 'Задайте адрес меню', it: 'Imposta un indirizzo del menu', fr: 'Définissez une adresse de menu', az: 'Menyu ünvanı təyin edin', tr: 'Bir menü adresi belirleyin', uk: 'Задайте адресу меню', kk: 'Мәзір мекенжайын белгілеңіз' },
  'me.setAddrSub':   { en: 'Go to Settings and set the address', ru: 'Перейдите в Настройки и укажите адрес', it: 'Vai in Impostazioni e indica l’indirizzo', fr: 'Allez dans Réglages et indiquez l’adresse', az: 'Tənzimləmələrə keçin və ünvanı göstərin', tr: 'Ayarlar’a gidip adresi belirtin', uk: 'Перейдіть у Налаштування та вкажіть адресу', kk: 'Баптауларға өтіп, мекенжайды көрсетіңіз' },
  'me.newCat':       { en: 'New category', ru: 'Новая категория', it: 'Nuova categoria', fr: 'Nouvelle catégorie', az: 'Yeni kateqoriya', tr: 'Yeni kategori', uk: 'Нова категорія', kk: 'Жаңа санат' },
  'me.catNamePh':    { en: 'Category name', ru: 'Название категории', it: 'Nome categoria', fr: 'Nom de la catégorie', az: 'Kateqoriya adı', tr: 'Kategori adı', uk: 'Назва категорії', kk: 'Санат атауы' },
  'me.create':       { en: 'Create', ru: 'Создать', it: 'Crea', fr: 'Créer', az: 'Yarat', tr: 'Oluştur', uk: 'Створити', kk: 'Құру' },
  'me.edit':         { en: 'Edit', ru: 'Редактировать', it: 'Modifica', fr: 'Modifier', az: 'Redaktə et', tr: 'Düzenle', uk: 'Редагувати', kk: 'Өңдеу' },
  'me.newItem':      { en: 'New item', ru: 'Новая позиция', it: 'Nuovo articolo', fr: 'Nouvel article', az: 'Yeni məhsul', tr: 'Yeni ürün', uk: 'Нова позиція', kk: 'Жаңа позиция' },
  'me.replace':      { en: 'Replace', ru: 'Заменить', it: 'Sostituisci', fr: 'Remplacer', az: 'Dəyiş', tr: 'Değiştir', uk: 'Замінити', kk: 'Ауыстыру' },
  'me.uploadPhoto':  { en: 'Upload photo', ru: 'Загрузить фото', it: 'Carica foto', fr: 'Charger une photo', az: 'Foto yüklə', tr: 'Fotoğraf yükle', uk: 'Завантажити фото', kk: 'Фото жүктеу' },
  'me.fName':        { en: 'Name *', ru: 'Название *', it: 'Nome *', fr: 'Nom *', az: 'Ad *', tr: 'Ad *', uk: 'Назва *', kk: 'Атауы *' },
  'me.fDesc':        { en: 'Description', ru: 'Описание', it: 'Descrizione', fr: 'Description', az: 'Təsvir', tr: 'Açıklama', uk: 'Опис', kk: 'Сипаттама' },
  'me.fPrice':       { en: 'Price ({c})', ru: 'Цена ({c})', it: 'Prezzo ({c})', fr: 'Prix ({c})', az: 'Qiymət ({c})', tr: 'Fiyat ({c})', uk: 'Ціна ({c})', kk: 'Бағасы ({c})' },
  'me.fCalories':    { en: 'Calories (kcal)', ru: 'Калорийность (ккал)', it: 'Calorie (kcal)', fr: 'Calories (kcal)', az: 'Kalori (kkal)', tr: 'Kalori (kcal)', uk: 'Калорійність (ккал)', kk: 'Калория (ккал)' },
  'me.fAllergens':   { en: 'Allergens (comma-separated)', ru: 'Аллергены (через запятую)', it: 'Allergeni (separati da virgola)', fr: 'Allergènes (séparés par des virgules)', az: 'Allergenlər (vergüllə)', tr: 'Alerjenler (virgülle)', uk: 'Алергени (через кому)', kk: 'Аллергендер (үтір арқылы)' },
  'me.mods':         { en: 'Modifiers', ru: 'Модификаторы', it: 'Modificatori', fr: 'Options', az: 'Modifikatorlar', tr: 'Seçenekler', uk: 'Модифікатори', kk: 'Модификаторлар' },
  'me.modGroup':     { en: 'Group (Size, Add-ons...)', ru: 'Группа (Размер, Добавки...)', it: 'Gruppo (Taglia, Extra...)', fr: 'Groupe (Taille, Suppléments...)', az: 'Qrup (Ölçü, Əlavələr...)', tr: 'Grup (Boyut, Ekstralar...)', uk: 'Група (Розмір, Додатки...)', kk: 'Топ (Өлшем, Қоспалар...)' },
  'me.modOption':    { en: 'Option (S, M, cheese...)', ru: 'Опция (S, M, сыр...)', it: 'Opzione (S, M, formaggio...)', fr: 'Option (S, M, fromage...)', az: 'Seçim (S, M, pendir...)', tr: 'Seçenek (S, M, peynir...)', uk: 'Опція (S, M, сир...)', kk: 'Опция (S, M, ірімшік...)' },
  'me.addOption':    { en: '+ Option', ru: '+ Опция', it: '+ Opzione', fr: '+ Option', az: '+ Seçim', tr: '+ Seçenek', uk: '+ Опція', kk: '+ Опция' },
  'me.addModGroup':  { en: '+ Modifier group', ru: '+ Группа модификаторов', it: '+ Gruppo di modificatori', fr: '+ Groupe d’options', az: '+ Modifikator qrupu', tr: '+ Seçenek grubu', uk: '+ Група модифікаторів', kk: '+ Модификатор тобы' },
  'me.showItem':     { en: 'Show', ru: 'Показывать', it: 'Mostra', fr: 'Afficher', az: 'Göstər', tr: 'Göster', uk: 'Показувати', kk: 'Көрсету' },
  'me.inStock':      { en: 'In stock', ru: 'В наличии', it: 'Disponibile', fr: 'En stock', az: 'Stokda var', tr: 'Stokta', uk: 'В наявності', kk: 'Қоймада бар' },
  'me.save':         { en: 'Save', ru: 'Сохранить', it: 'Salva', fr: 'Enregistrer', az: 'Yadda saxla', tr: 'Kaydet', uk: 'Зберегти', kk: 'Сақтау' },
  'me.add':          { en: 'Add', ru: 'Добавить', it: 'Aggiungi', fr: 'Ajouter', az: 'Əlavə et', tr: 'Ekle', uk: 'Додати', kk: 'Қосу' },

  // ── Mise Stash ──
  'st.loading':      { en: 'Loading...', ru: 'Загрузка...', it: 'Caricamento...', fr: 'Chargement...', az: 'Yüklənir...', tr: 'Yükleniyor...', uk: 'Завантаження...', kk: 'Жүктелуде...' },
  'st.err':          { en: 'Error', ru: 'Ошибка', it: 'Errore', fr: 'Erreur', az: 'Xəta', tr: 'Hata', uk: 'Помилка', kk: 'Қате' },
  'st.typesEmpty':   { en: 'Hookah types not configured', ru: 'Виды кальянов не настроены', it: 'Tipi di narghilè non configurati', fr: 'Types de chicha non configurés', az: 'Qəlyan növləri tənzimlənməyib', tr: 'Nargile türleri ayarlanmamış', uk: 'Види кальянів не налаштовані', kk: 'Кальян түрлері бапталмаған' },
  'st.typesEmptySub':{ en: 'The owner adds them in the dashboard:<br />Settings → Hookah types', ru: 'Владелец добавляет их в дашборде:<br />Настройки → Виды кальянов', it: 'Il titolare li aggiunge nella dashboard:<br />Impostazioni → Tipi di narghilè', fr: 'Le gérant les ajoute dans le tableau de bord :<br />Réglages → Types de chicha', az: 'Sahib onları idarə panelində əlavə edir:<br />Tənzimləmələr → Qəlyan növləri', tr: 'Sahibi panelden ekler:<br />Ayarlar → Nargile türleri', uk: 'Власник додає їх у дашборді:<br />Налаштування → Види кальянів', kk: 'Иесі оларды басқару тақтасында қосады:<br />Баптаулар → Кальян түрлері' },
  'st.backToday':    { en: 'back to today', ru: 'вернуться к сегодня', it: 'torna a oggi', fr: 'revenir à aujourd’hui', az: 'bu günə qayıt', tr: 'bugüne dön', uk: 'повернутися до сьогодні', kk: 'бүгінге оралу' },
  'st.statSold':     { en: 'Sold', ru: 'Продано', it: 'Venduti', fr: 'Vendus', az: 'Satılıb', tr: 'Satıldı', uk: 'Продано', kk: 'Сатылды' },
  'st.statFree':     { en: 'Free', ru: 'Бесплатно', it: 'Gratis', fr: 'Gratuits', az: 'Pulsuz', tr: 'Ücretsiz', uk: 'Безкоштовно', kk: 'Тегін' },
  'st.statRevenue':  { en: 'Revenue', ru: 'Выручка', it: 'Incasso', fr: 'Recettes', az: 'Gəlir', tr: 'Ciro', uk: 'Виручка', kk: 'Түсім' },
  'st.statTobacco':  { en: 'Tobacco', ru: 'Табака', it: 'Tabacco', fr: 'Tabac', az: 'Tütün', tr: 'Tütün', uk: 'Тютюну', kk: 'Темекі' },
  'st.venueLeft':    { en: 'Tobacco on the floor', ru: 'Табака в заведении', it: 'Tabacco nel locale', fr: 'Tabac dans l’établissement', az: 'Müəssisədə tütün', tr: 'İşletmedeki tütün', uk: 'Тютюну в закладі', kk: 'Мекемедегі темекі' },
  'st.segPaid':      { en: 'Sale', ru: 'Продажа', it: 'Vendita', fr: 'Vente', az: 'Satış', tr: 'Satış', uk: 'Продаж', kk: 'Сату' },
  'st.forWhom':      { en: 'For whom', ru: 'Для кого', it: 'Per chi', fr: 'Pour qui', az: 'Kim üçün', tr: 'Kime', uk: 'Для кого', kk: 'Кімге' },
  'st.freeNote':     { en: 'Not counted in revenue; tobacco is written off', ru: 'Не входят в выручку, табак списывается', it: 'Non contano nell’incasso; il tabacco viene scaricato', fr: 'Non comptés dans les recettes ; le tabac est décompté', az: 'Gəlirə daxil deyil; tütün silinir', tr: 'Cироya dahil değil; tütün düşülür', uk: 'Не входять у виручку; тютюн списується', kk: 'Түсімге кірмейді; темекі есептен шығарылады' },
  'st.saveShift':    { en: 'Save shift', ru: 'Сохранить смену', it: 'Salva turno', fr: 'Enregistrer le service', az: 'Növbəni yadda saxla', tr: 'Vardiyayı kaydet', uk: 'Зберегти зміну', kk: 'Ауысымды сақтау' },
  'st.savingShort':  { en: 'Saving...', ru: 'Сохраняем...', it: 'Salvataggio...', fr: 'Enregistrement...', az: 'Saxlanılır...', tr: 'Kaydediliyor...', uk: 'Збереження...', kk: 'Сақталуда...' },
  'st.shiftSaved':   { en: 'Shift saved', ru: 'Смена сохранена', it: 'Turno salvato', fr: 'Service enregistré', az: 'Növbə yadda saxlanıldı', tr: 'Vardiya kaydedildi', uk: 'Зміну збережено', kk: 'Ауысым сақталды' },
  'st.soldWord':     { en: 'sold', ru: 'продано', it: 'venduti', fr: 'vendus', az: 'satılıb', tr: 'satıldı', uk: 'продано', kk: 'сатылды' },
  'st.freeWord':     { en: 'free', ru: 'бесплатно', it: 'gratis', fr: 'gratuits', az: 'pulsuz', tr: 'ücretsiz', uk: 'безкоштовно', kk: 'тегін' },
  'st.fcStaff':      { en: 'Staff', ru: 'Сотрудники', it: 'Personale', fr: 'Personnel', az: 'İşçilər', tr: 'Personel', uk: 'Працівники', kk: 'Қызметкерлер' },
  'st.fcOwner':      { en: 'Owner', ru: 'Владелец', it: 'Titolare', fr: 'Gérant', az: 'Sahib', tr: 'Sahip', uk: 'Власник', kk: 'Иесі' },
  'st.fcManager':    { en: 'Manager', ru: 'Менеджер', it: 'Manager', fr: 'Manager', az: 'Menecer', tr: 'Müdür', uk: 'Менеджер', kk: 'Менеджер' },
  'st.fcGuest':      { en: 'Guest', ru: 'Гость', it: 'Ospite', fr: 'Client', az: 'Qonaq', tr: 'Misafir', uk: 'Гість', kk: 'Қонақ' },
  'st.fcTasting':    { en: 'Tasting', ru: 'Дегустация', it: 'Degustazione', fr: 'Dégustation', az: 'Dequstasiya', tr: 'Tadım', uk: 'Дегустація', kk: 'Дегустация' },
  'st.navShift':     { en: 'Shift', ru: 'Смена', it: 'Turno', fr: 'Service', az: 'Növbə', tr: 'Vardiya', uk: 'Зміна', kk: 'Ауысым' },
  'st.navStock':     { en: 'Stock', ru: 'Наличие', it: 'Scorte', fr: 'Stock', az: 'Mövcudluq', tr: 'Mevcut', uk: 'Наявність', kk: 'Қолда бар' },
  'st.navMoves':     { en: 'Movements', ru: 'Движения', it: 'Movimenti', fr: 'Mouvements', az: 'Hərəkətlər', tr: 'Hareketler', uk: 'Рухи', kk: 'Қозғалыстар' },
  'st.navInv':       { en: 'Inventory', ru: 'Инвентарь', it: 'Inventario', fr: 'Inventaire', az: 'İnventar', tr: 'Envanter', uk: 'Інвентар', kk: 'Түгендеу' },
  'st.searchPh':     { en: 'Search brand or flavor...', ru: 'Поиск бренда или вкуса...', it: 'Cerca marca o gusto...', fr: 'Rechercher marque ou goût...', az: 'Brend və ya dad axtar...', tr: 'Marka veya aroma ara...', uk: 'Пошук бренду чи смаку...', kk: 'Бренд не дәм іздеу...' },
  'st.emptyCount':   { en: '{n} empty', ru: '{n} пусто', it: '{n} vuoti', fr: '{n} vides', az: '{n} boş', tr: '{n} boş', uk: '{n} порожніх', kk: '{n} бос' },
  'st.statPositions':{ en: 'Items', ru: 'Позиций', it: 'Articoli', fr: 'Articles', az: 'Mövqe', tr: 'Kalem', uk: 'Позицій', kk: 'Позиция' },
  'st.statInStock':  { en: 'In stock', ru: 'В наличии', it: 'Disponibili', fr: 'En stock', az: 'Stokda', tr: 'Stokta', uk: 'В наявності', kk: 'Қолда бар' },
  'st.statLow':      { en: 'Low', ru: 'Мало', it: 'Pochi', fr: 'Faible', az: 'Az', tr: 'Az', uk: 'Мало', kk: 'Аз' },
  'st.notFound':     { en: 'Nothing found', ru: 'Ничего не найдено', it: 'Niente trovato', fr: 'Rien trouvé', az: 'Heç nə tapılmadı', tr: 'Bir şey bulunamadı', uk: 'Нічого не знайдено', kk: 'Ештеңе табылмады' },
  'st.stockEmpty':   { en: 'Stock is empty', ru: 'Склад пуст', it: 'Magazzino vuoto', fr: 'Stock vide', az: 'Anbar boşdur', tr: 'Depo boş', uk: 'Склад порожній', kk: 'Қойма бос' },
  'st.tryAnother':   { en: 'Try another query', ru: 'Попробуйте другой запрос', it: 'Prova un’altra ricerca', fr: 'Essayez une autre recherche', az: 'Başqa sorğu yoxlayın', tr: 'Başka bir arama deneyin', uk: 'Спробуйте інший запит', kk: 'Басқа сұрау көріңіз' },
  'st.addFirstSupply':{ en: 'Add the first supply', ru: 'Добавьте первую поставку', it: 'Aggiungi la prima fornitura', fr: 'Ajoutez le premier approvisionnement', az: 'İlk təchizatı əlavə edin', tr: 'İlk tedariği ekleyin', uk: 'Додайте першу поставку', kk: 'Алғашқы жеткізілімді қосыңыз' },
  'st.outOfStockSec':{ en: 'Out of stock', ru: 'Нет в наличии', it: 'Esauriti', fr: 'En rupture', az: 'Stokda yoxdur', tr: 'Stokta yok', uk: 'Немає в наявності', kk: 'Қоймада жоқ' },
  'st.movIn':        { en: 'Supply', ru: 'Поставка', it: 'Fornitura', fr: 'Appro', az: 'Təchizat', tr: 'Tedarik', uk: 'Поставка', kk: 'Жеткізілім' },
  'st.movOut':       { en: 'Issue', ru: 'Выдача', it: 'Uscita', fr: 'Sortie', az: 'Buraxılış', tr: 'Çıkış', uk: 'Видача', kk: 'Беру' },
  'st.movWriteoff':  { en: 'Write-off', ru: 'Списание', it: 'Scarico', fr: 'Décompte', az: 'Silinmə', tr: 'Düşüm', uk: 'Списання', kk: 'Есептен шығару' },
  'st.movOutFull':   { en: 'Issue to floor', ru: 'Выдача в зал', it: 'Uscita in sala', fr: 'Sortie en salle', az: 'Zala buraxılış', tr: 'Salona çıkış', uk: 'Видача в зал', kk: 'Залға беру' },
  'st.suppliesEmpty':{ en: 'No supplies yet', ru: 'Поставок пока нет', it: 'Nessuna fornitura', fr: 'Aucun appro', az: 'Hələ təchizat yoxdur', tr: 'Henüz tedarik yok', uk: 'Поставок поки немає', kk: 'Әзірге жеткізілім жоқ' },
  'st.issuesEmpty':  { en: 'No issues yet', ru: 'Выдач пока нет', it: 'Nessuna uscita', fr: 'Aucune sortie', az: 'Hələ buraxılış yoxdur', tr: 'Henüz çıkış yok', uk: 'Видач поки немає', kk: 'Әзірге беру жоқ' },
  'st.writeoffsEmpty':{ en: 'No write-offs yet', ru: 'Списаний пока нет', it: 'Nessuno scarico', fr: 'Aucun décompte', az: 'Hələ silinmə yoxdur', tr: 'Henüz düşüm yok', uk: 'Списань поки немає', kk: 'Әзірге есептен шығару жоқ' },
  'st.itemsCount':   { en: '{n} items', ru: '{n} позиций', it: '{n} articoli', fr: '{n} articles', az: '{n} mövqe', tr: '{n} kalem', uk: '{n} позицій', kk: '{n} позиция' },
  'st.last':         { en: 'Latest', ru: 'Последняя', it: 'Ultima', fr: 'Dernière', az: 'Sonuncu', tr: 'Sonuncu', uk: 'Остання', kk: 'Соңғы' },
  'st.invWarehouse': { en: 'Warehouse', ru: 'Склад', it: 'Magazzino', fr: 'Stock', az: 'Anbar', tr: 'Depo', uk: 'Склад', kk: 'Қойма' },
  'st.invVenue':     { en: 'Floor', ru: 'Заведение', it: 'Locale', fr: 'Établissement', az: 'Müəssisə', tr: 'İşletme', uk: 'Заклад', kk: 'Мекеме' },
  'st.invEmpty':     { en: 'No stocktakes yet', ru: 'Инвентаризаций пока нет', it: 'Nessun inventario', fr: 'Aucun inventaire', az: 'Hələ inventarizasiya yoxdur', tr: 'Henüz sayım yok', uk: 'Інвентаризацій поки немає', kk: 'Әзірге түгендеу жоқ' },
  'st.venueInvTitle':{ en: 'Floor stocktake', ru: 'Инвентаризация заведения', it: 'Inventario del locale', fr: 'Inventaire de l’établissement', az: 'Müəssisə inventarizasiyası', tr: 'İşletme sayımı', uk: 'Інвентаризація закладу', kk: 'Мекеме түгендеуі' },
  'st.soon':         { en: 'Coming in future updates', ru: 'Будет доступно в следующих обновлениях', it: 'Disponibile nei prossimi aggiornamenti', fr: 'Disponible dans de futures mises à jour', az: 'Gələcək yeniləmələrdə əlçatan olacaq', tr: 'Gelecek güncellemelerde gelecek', uk: 'Буде доступно в наступних оновленнях', kk: 'Келесі жаңартуларда қолжетімді болады' },
  'st.issuedTotal':  { en: 'Issued to floor total', ru: 'Выдано в зал всего', it: 'Totale uscito in sala', fr: 'Total sorti en salle', az: 'Zala cəmi buraxılıb', tr: 'Salona toplam çıkış', uk: 'Видано в зал усього', kk: 'Залға барлығы берілді' },
  'st.newRecord':    { en: 'New record', ru: 'Новая запись', it: 'Nuovo record', fr: 'Nouvel enregistrement', az: 'Yeni qeyd', tr: 'Yeni kayıt', uk: 'Новий запис', kk: 'Жаңа жазба' },
  'st.edit':         { en: 'Edit', ru: 'Редактировать', it: 'Modifica', fr: 'Modifier', az: 'Redaktə et', tr: 'Düzenle', uk: 'Редагувати', kk: 'Өңдеу' },
  'st.writeoffReasonPh':{ en: 'Write-off reason (breakage, expiry, defect...)', ru: 'Причина списания (бой, просрочка, брак...)', it: 'Motivo scarico (rottura, scadenza, difetto...)', fr: 'Motif (casse, péremption, défaut...)', az: 'Silinmə səbəbi (sınıq, vaxt, qüsur...)', tr: 'Düşüm nedeni (kırılma, son kullanma, kusur...)', uk: 'Причина списання (бій, прострочення, брак...)', kk: 'Есептен шығару себебі (сынық, мерзім, ақау...)' },
  'st.brandPh':      { en: 'Brand', ru: 'Бренд', it: 'Marca', fr: 'Marque', az: 'Brend', tr: 'Marka', uk: 'Бренд', kk: 'Бренд' },
  'st.flavorPh':     { en: 'Flavor', ru: 'Вкус', it: 'Gusto', fr: 'Goût', az: 'Dad', tr: 'Aroma', uk: 'Смак', kk: 'Дәм' },
  'st.gramsPh':      { en: 'g', ru: 'г', it: 'g', fr: 'g', az: 'q', tr: 'g', uk: 'г', kk: 'г' },
  'st.available':    { en: 'Available', ru: 'Доступно', it: 'Disponibile', fr: 'Disponible', az: 'Mövcuddur', tr: 'Mevcut', uk: 'Доступно', kk: 'Қолжетімді' },
  'st.addPosition':  { en: '+ Add item', ru: '+ Добавить позицию', it: '+ Aggiungi articolo', fr: '+ Ajouter un article', az: '+ Mövqe əlavə et', tr: '+ Kalem ekle', uk: '+ Додати позицію', kk: '+ Позиция қосу' },
  'st.savingFull':   { en: 'Saving...', ru: 'Сохранение...', it: 'Salvataggio...', fr: 'Enregistrement...', az: 'Saxlanılır...', tr: 'Kaydediliyor...', uk: 'Збереження...', kk: 'Сақталуда...' },
  'st.saveChanges':  { en: 'Save changes', ru: 'Сохранить изменения', it: 'Salva modifiche', fr: 'Enregistrer les modifications', az: 'Dəyişiklikləri yadda saxla', tr: 'Değişiklikleri kaydet', uk: 'Зберегти зміни', kk: 'Өзгерістерді сақтау' },
  'st.saveSupply':   { en: 'Save supply', ru: 'Сохранить поставку', it: 'Salva fornitura', fr: 'Enregistrer l’appro', az: 'Təchizatı yadda saxla', tr: 'Tedariği kaydet', uk: 'Зберегти поставку', kk: 'Жеткізілімді сақтау' },
  'st.saveIssue':    { en: 'Save issue', ru: 'Сохранить выдачу', it: 'Salva uscita', fr: 'Enregistrer la sortie', az: 'Buraxılışı yadda saxla', tr: 'Çıkışı kaydet', uk: 'Зберегти видачу', kk: 'Беруді сақтау' },
  'st.writeoffBtn':  { en: 'Write off', ru: 'Списать', it: 'Scarica', fr: 'Décompter', az: 'Sil', tr: 'Düş', uk: 'Списати', kk: 'Есептен шығару' },
  'st.invStockTitle':{ en: 'Stock count', ru: 'Инвентаризация склада', it: 'Inventario magazzino', fr: 'Inventaire du stock', az: 'Anbar inventarizasiyası', tr: 'Depo sayımı', uk: 'Інвентаризація складу', kk: 'Қойма түгендеуі' },
  'st.enterActual':  { en: 'Enter the actual weight', ru: 'Введите фактический вес', it: 'Inserisci il peso effettivo', fr: 'Saisissez le poids réel', az: 'Faktiki çəkini daxil edin', tr: 'Gerçek ağırlığı girin', uk: 'Введіть фактичну вагу', kk: 'Нақты салмақты енгізіңіз' },
  'st.actualPh':     { en: 'Actual (g)', ru: 'Фактически (г)', it: 'Effettivo (g)', fr: 'Réel (g)', az: 'Faktiki (q)', tr: 'Gerçek (g)', uk: 'Фактично (г)', kk: 'Нақты (г)' },
  'st.saveInv':      { en: 'Save stocktake', ru: 'Сохранить инвентаризацию', it: 'Salva inventario', fr: 'Enregistrer l’inventaire', az: 'İnventarizasiyanı yadda saxla', tr: 'Sayımı kaydet', uk: 'Зберегти інвентаризацію', kk: 'Түгендеуді сақтау' },
  'st.noDiff':       { en: 'No discrepancies — everything matches', ru: 'Нет расхождений — всё совпадает', it: 'Nessuna discrepanza — tutto corrisponde', fr: 'Aucun écart — tout correspond', az: 'Fərq yoxdur — hər şey uyğundur', tr: 'Fark yok — her şey uyuşuyor', uk: 'Розбіжностей немає — все збігається', kk: 'Айырмашылық жоқ — бәрі сәйкес' },
  'st.addAtLeastOne':{ en: 'Add at least one item', ru: 'Добавьте хотя бы одну позицию', it: 'Aggiungi almeno un articolo', fr: 'Ajoutez au moins un article', az: 'Ən azı bir mövqe əlavə edin', tr: 'En az bir kalem ekleyin', uk: 'Додайте хоча б одну позицію', kk: 'Кемінде бір позиция қосыңыз' },
  'st.enterWriteoffReason':{ en: 'Specify the write-off reason', ru: 'Укажите причину списания', it: 'Indica il motivo dello scarico', fr: 'Indiquez le motif du décompte', az: 'Silinmə səbəbini göstərin', tr: 'Düşüm nedenini belirtin', uk: 'Вкажіть причину списання', kk: 'Есептен шығару себебін көрсетіңіз' },
  'st.addBtn':       { en: 'Add', ru: 'Добавить', it: 'Aggiungi', fr: 'Ajouter', az: 'Əlavə et', tr: 'Ekle', uk: 'Додати', kk: 'Қосу' },
  'st.kg':           { en: 'kg', ru: 'кг', it: 'kg', fr: 'kg', az: 'kq', tr: 'kg', uk: 'кг', kk: 'кг' },
  'st.lowCount':     { en: '{n} low', ru: '{n} мало', it: '{n} pochi', fr: '{n} faibles', az: '{n} az', tr: '{n} az', uk: '{n} мало', kk: '{n} аз' },
  'st.changeBtn':    { en: 'Edit', ru: 'Изменить', it: 'Modifica', fr: 'Modifier', az: 'Dəyiş', tr: 'Değiştir', uk: 'Змінити', kk: 'Өзгерту' },
  'st.startInv':     { en: 'Start stocktake', ru: 'Начать инвентаризацию', it: 'Avvia inventario', fr: 'Démarrer l’inventaire', az: 'İnventarizasiyaya başla', tr: 'Sayımı başlat', uk: 'Почати інвентаризацію', kk: 'Түгендеуді бастау' },
  'st.discrepCount': { en: '{n} discrepancies', ru: '{n} расхождений', it: '{n} discrepanze', fr: '{n} écarts', az: '{n} fərq', tr: '{n} fark', uk: '{n} розбіжностей', kk: '{n} айырмашылық' },
  'st.notFoundSuffix':{ en: 'not found', ru: 'не найден', it: 'non trovato', fr: 'introuvable', az: 'tapılmadı', tr: 'bulunamadı', uk: 'не знайдено', kk: 'табылмады' },
  'st.onlyWord':     { en: 'only', ru: 'только', it: 'solo', fr: 'seulement', az: 'yalnız', tr: 'yalnızca', uk: 'лише', kk: 'тек' },
  'st.savedItems':   { en: 'Saved ({n} items)', ru: 'Сохранено ({n} поз.)', it: 'Salvato ({n} art.)', fr: 'Enregistré ({n} art.)', az: 'Saxlanıldı ({n} mövqe)', tr: 'Kaydedildi ({n} kalem)', uk: 'Збережено ({n} поз.)', kk: 'Сақталды ({n} позиция)' },
  'st.invSaved':     { en: 'Stocktake saved. Discrepancies: {n}', ru: 'Инвентаризация сохранена. Расхождений: {n}', it: 'Inventario salvato. Discrepanze: {n}', fr: 'Inventaire enregistré. Écarts : {n}', az: 'İnventarizasiya saxlanıldı. Fərqlər: {n}', tr: 'Sayım kaydedildi. Farklar: {n}', uk: 'Інвентаризацію збережено. Розбіжностей: {n}', kk: 'Түгендеу сақталды. Айырмашылықтар: {n}' },

  // ── common ──
  'common.or':      { en: 'or', ru: 'или', it: 'oppure', fr: 'ou', az: 'və ya', tr: 'veya', uk: 'або', kk: 'немесе' },
  'common.show':    { en: 'Show', ru: 'Показать', it: 'Mostra', fr: 'Afficher', az: 'Göstər', tr: 'Göster', uk: 'Показати', kk: 'Көрсету' },
  'common.hide':    { en: 'Hide', ru: 'Скрыть', it: 'Nascondi', fr: 'Masquer', az: 'Gizlət', tr: 'Gizle', uk: 'Сховати', kk: 'Жасыру' },
  'common.loading': { en: 'Loading…', ru: 'Загрузка…', it: 'Caricamento…', fr: 'Chargement…', az: 'Yüklənir…', tr: 'Yükleniyor…', uk: 'Завантаження…', kk: 'Жүктелуде…' },

  // ── cookie consent (GDPR) ──
  'cookie.text':   { en: 'We use cookies to keep you signed in and improve the product.', ru: 'Мы используем cookie, чтобы вы оставались в аккаунте и для улучшения продукта.', it: 'Usiamo i cookie per mantenerti connesso e migliorare il prodotto.', fr: 'Nous utilisons des cookies pour vous garder connecté et améliorer le produit.', az: 'Sizi hesabda saxlamaq və məhsulu yaxşılaşdırmaq üçün kukilərdən istifadə edirik.', tr: 'Oturumunuzu açık tutmak ve ürünü geliştirmek için çerez kullanıyoruz.', uk: 'Ми використовуємо cookie, щоб ви залишались в акаунті та для покращення продукту.', kk: 'Сізді аккаунтта сақтау және өнімді жақсарту үшін cookie қолданамыз.' },
  'cookie.accept': { en: 'Accept', ru: 'Принять', it: 'Accetta', fr: 'Accepter', az: 'Qəbul et', tr: 'Kabul et', uk: 'Прийняти', kk: 'Қабылдау' },
  'cookie.decline':{ en: 'Essential only', ru: 'Только необходимые', it: 'Solo essenziali', fr: 'Essentiels uniquement', az: 'Yalnız zəruri', tr: 'Yalnızca gerekli', uk: 'Лише необхідні', kk: 'Тек қажеттілер' },
  'cookie.privacy':{ en: 'Privacy', ru: 'Конфиденциальность', it: 'Privacy', fr: 'Confidentialité', az: 'Məxfilik', tr: 'Gizlilik', uk: 'Конфіденційність', kk: 'Құпиялылық' },

  // ── auth: login ──
  'auth.login.subtitle':      { en: 'Sign in to your account', ru: 'Войдите в свой аккаунт', it: 'Accedi al tuo account', fr: 'Connectez-vous à votre compte', az: 'Hesabınıza daxil olun', tr: 'Hesabınıza giriş yapın', uk: 'Увійдіть у свій акаунт', kk: 'Аккаунтыңызға кіріңіз' },
  'auth.login.google':        { en: 'Sign in with Google', ru: 'Войти через Google', it: 'Accedi con Google', fr: 'Se connecter avec Google', az: 'Google ilə daxil ol', tr: 'Google ile giriş yap', uk: 'Увійти через Google', kk: 'Google арқылы кіру' },
  'auth.login.googleLoading': { en: 'Redirecting…', ru: 'Перенаправление…', it: 'Reindirizzamento…', fr: 'Redirection…', az: 'Yönləndirilir…', tr: 'Yönlendiriliyor…', uk: 'Перенаправлення…', kk: 'Бағыттау…' },
  'auth.login.appleSoon':     { en: 'Sign in with Apple — soon', ru: 'Войти через Apple — скоро', it: 'Accedi con Apple — presto', fr: 'Se connecter avec Apple — bientôt', az: 'Apple ilə daxil ol — tezliklə', tr: 'Apple ile giriş — yakında', uk: 'Увійти через Apple — скоро', kk: 'Apple арқылы кіру — жақында' },
  'auth.login.password':      { en: 'Password', ru: 'Пароль', it: 'Password', fr: 'Mot de passe', az: 'Şifrə', tr: 'Şifre', uk: 'Пароль', kk: 'Құпиясөз' },
  'auth.login.forgot':        { en: 'Forgot password?', ru: 'Забыли пароль?', it: 'Password dimenticata?', fr: 'Mot de passe oublié ?', az: 'Şifrəni unutmusunuz?', tr: 'Şifrenizi mi unuttunuz?', uk: 'Забули пароль?', kk: 'Құпиясөзді ұмыттыңыз ба?' },
  'auth.login.submit':        { en: 'Sign in', ru: 'Войти', it: 'Accedi', fr: 'Se connecter', az: 'Daxil ol', tr: 'Giriş yap', uk: 'Увійти', kk: 'Кіру' },
  'auth.login.submitting':    { en: 'Signing in…', ru: 'Входим…', it: 'Accesso…', fr: 'Connexion…', az: 'Daxil olunur…', tr: 'Giriş yapılıyor…', uk: 'Вхід…', kk: 'Кіруде…' },
  'auth.login.noAccount':     { en: 'No account?', ru: 'Нет аккаунта?', it: 'Non hai un account?', fr: 'Pas de compte ?', az: 'Hesabınız yoxdur?', tr: 'Hesabınız yok mu?', uk: 'Немає акаунта?', kk: 'Аккаунтыңыз жоқ па?' },
  'auth.login.register':      { en: 'Sign up', ru: 'Зарегистрироваться', it: 'Registrati', fr: "S'inscrire", az: 'Qeydiyyatdan keç', tr: 'Kayıt ol', uk: 'Зареєструватися', kk: 'Тіркелу' },
  'auth.login.errFill':       { en: 'Fill in all fields', ru: 'Заполните все поля', it: 'Compila tutti i campi', fr: 'Remplissez tous les champs', az: 'Bütün sahələri doldurun', tr: 'Tüm alanları doldurun', uk: 'Заповніть усі поля', kk: 'Барлық өрістерді толтырыңыз' },
  'auth.login.errInvalid':    { en: 'Invalid email or password', ru: 'Неверный email или пароль', it: 'Email o password non validi', fr: 'E-mail ou mot de passe incorrect', az: 'Yanlış e-poçt və ya şifrə', tr: 'Geçersiz e-posta veya şifre', uk: 'Невірний email або пароль', kk: 'Қате email немесе құпиясөз' },

  // ── auth: register ──
  'auth.register.subtitle':    { en: 'Create your account', ru: 'Создайте аккаунт', it: 'Crea il tuo account', fr: 'Créez votre compte', az: 'Hesabınızı yaradın', tr: 'Hesabınızı oluşturun', uk: 'Створіть акаунт', kk: 'Аккаунт жасаңыз' },
  'auth.register.google':      { en: 'Sign up with Google', ru: 'Зарегистрироваться через Google', it: 'Registrati con Google', fr: "S'inscrire avec Google", az: 'Google ilə qeydiyyat', tr: 'Google ile kayıt ol', uk: 'Зареєструватися через Google', kk: 'Google арқылы тіркелу' },
  'auth.register.name':        { en: 'Your name', ru: 'Ваше имя', it: 'Il tuo nome', fr: 'Votre nom', az: 'Adınız', tr: 'Adınız', uk: "Ваше ім'я", kk: 'Атыңыз' },
  'auth.register.restaurant':  { en: 'Restaurant name', ru: 'Название заведения', it: 'Nome del locale', fr: "Nom de l'établissement", az: 'Müəssisənin adı', tr: 'İşletme adı', uk: 'Назва закладу', kk: 'Мекеме атауы' },
  'auth.register.email':       { en: 'Email', ru: 'Email', it: 'Email', fr: 'E-mail', az: 'E-poçt', tr: 'E-posta', uk: 'Email', kk: 'Email' },
  'auth.register.password':    { en: 'Password', ru: 'Пароль', it: 'Password', fr: 'Mot de passe', az: 'Şifrə', tr: 'Şifre', uk: 'Пароль', kk: 'Құпиясөз' },
  'auth.register.submit':      { en: 'Create account', ru: 'Создать аккаунт', it: 'Crea account', fr: 'Créer un compte', az: 'Hesab yarat', tr: 'Hesap oluştur', uk: 'Створити акаунт', kk: 'Аккаунт жасау' },
  'auth.register.submitting':  { en: 'Creating…', ru: 'Создаём…', it: 'Creazione…', fr: 'Création…', az: 'Yaradılır…', tr: 'Oluşturuluyor…', uk: 'Створення…', kk: 'Жасалуда…' },
  'auth.register.haveAccount': { en: 'Already have an account?', ru: 'Уже есть аккаунт?', it: 'Hai già un account?', fr: 'Vous avez déjà un compte ?', az: 'Artıq hesabınız var?', tr: 'Zaten hesabınız var mı?', uk: 'Вже маєте акаунт?', kk: 'Аккаунтыңыз бар ма?' },
  'auth.register.login':       { en: 'Sign in', ru: 'Войти', it: 'Accedi', fr: 'Se connecter', az: 'Daxil ol', tr: 'Giriş yap', uk: 'Увійти', kk: 'Кіру' },
  'auth.register.checkEmail':  { en: 'Check your email', ru: 'Проверьте email', it: 'Controlla la tua email', fr: 'Vérifiez votre e-mail', az: 'E-poçtunuzu yoxlayın', tr: 'E-postanızı kontrol edin', uk: 'Перевірте email', kk: 'Email-іңізді тексеріңіз' },
  'auth.register.sentLink':    { en: 'We sent a confirmation link to', ru: 'Мы отправили ссылку для подтверждения на', it: 'Abbiamo inviato un link di conferma a', fr: 'Nous avons envoyé un lien de confirmation à', az: 'Təsdiq linkini göndərdik:', tr: 'Onay bağlantısını gönderdik:', uk: 'Ми надіслали посилання для підтвердження на', kk: 'Растау сілтемесін жібердік:' },
  'auth.register.toLogin':     { en: 'Go to sign in', ru: 'Перейти к входу', it: "Vai all'accesso", fr: 'Aller à la connexion', az: 'Girişə keç', tr: 'Girişe git', uk: 'Перейти до входу', kk: 'Кіруге өту' },
  'auth.register.errName':       { en: 'Enter your name', ru: 'Введите ваше имя', it: 'Inserisci il tuo nome', fr: 'Entrez votre nom', az: 'Adınızı daxil edin', tr: 'Adınızı girin', uk: "Введіть ваше ім'я", kk: 'Атыңызды енгізіңіз' },
  'auth.register.errRestaurant': { en: 'Enter restaurant name', ru: 'Введите название заведения', it: 'Inserisci il nome del locale', fr: "Entrez le nom de l'établissement", az: 'Müəssisənin adını daxil edin', tr: 'İşletme adını girin', uk: 'Введіть назву закладу', kk: 'Мекеме атауын енгізіңіз' },
  'auth.register.errEmail':      { en: 'Enter email', ru: 'Введите email', it: "Inserisci l'email", fr: "Entrez l'e-mail", az: 'E-poçtu daxil edin', tr: 'E-postayı girin', uk: 'Введіть email', kk: 'Email енгізіңіз' },
  'auth.register.errPassword':   { en: "Password doesn't meet requirements", ru: 'Пароль не соответствует требованиям', it: 'La password non soddisfa i requisiti', fr: 'Le mot de passe ne respecte pas les exigences', az: 'Şifrə tələblərə uyğun deyil', tr: 'Şifre gereksinimleri karşılamıyor', uk: 'Пароль не відповідає вимогам', kk: 'Құпиясөз талаптарға сәйкес келмейді' },
  'auth.register.ruleLength':    { en: 'At least 8 characters', ru: 'Минимум 8 символов', it: 'Almeno 8 caratteri', fr: 'Au moins 8 caractères', az: 'Ən azı 8 simvol', tr: 'En az 8 karakter', uk: 'Щонайменше 8 символів', kk: 'Кемінде 8 таңба' },
  'auth.register.ruleUpper':     { en: 'One uppercase letter', ru: 'Заглавная буква', it: 'Una lettera maiuscola', fr: 'Une lettre majuscule', az: 'Bir böyük hərf', tr: 'Bir büyük harf', uk: 'Велика літера', kk: 'Бір бас әріп' },
  'auth.register.ruleNumber':    { en: 'One number', ru: 'Цифра', it: 'Un numero', fr: 'Un chiffre', az: 'Bir rəqəm', tr: 'Bir rakam', uk: 'Одна цифра', kk: 'Бір сан' },

  // ── auth: forgot password ──
  'auth.forgot.subtitle':   { en: 'Password recovery', ru: 'Восстановление пароля', it: 'Recupero password', fr: 'Récupération du mot de passe', az: 'Şifrənin bərpası', tr: 'Şifre kurtarma', uk: 'Відновлення пароля', kk: 'Құпиясөзді қалпына келтіру' },
  'auth.forgot.submit':     { en: 'Send link', ru: 'Отправить ссылку', it: 'Invia link', fr: 'Envoyer le lien', az: 'Link göndər', tr: 'Bağlantı gönder', uk: 'Надіслати посилання', kk: 'Сілтеме жіберу' },
  'auth.forgot.submitting': { en: 'Sending…', ru: 'Отправляем…', it: 'Invio…', fr: 'Envoi…', az: 'Göndərilir…', tr: 'Gönderiliyor…', uk: 'Надсилання…', kk: 'Жіберілуде…' },
  'auth.forgot.remembered': { en: 'Remembered your password?', ru: 'Вспомнили пароль?', it: 'Ricordi la password?', fr: 'Vous vous souvenez du mot de passe ?', az: 'Şifrəni xatırladınız?', tr: 'Şifrenizi hatırladınız mı?', uk: "Згадали пароль?", kk: 'Құпиясөзді есіңізге түсірдіңіз бе?' },
  'auth.forgot.sentBody':   { en: 'We sent a password reset link to', ru: 'Мы отправили ссылку для сброса пароля на', it: 'Abbiamo inviato un link per reimpostare la password a', fr: 'Nous avons envoyé un lien de réinitialisation à', az: 'Şifrə sıfırlama linkini göndərdik:', tr: 'Şifre sıfırlama bağlantısını gönderdik:', uk: 'Ми надіслали посилання для скидання пароля на', kk: 'Құпиясөзді қалпына келтіру сілтемесін жібердік:' },
  'auth.forgot.backToLogin':{ en: 'Back to sign in', ru: 'Вернуться ко входу', it: "Torna all'accesso", fr: 'Retour à la connexion', az: 'Girişə qayıt', tr: 'Girişe dön', uk: 'Повернутися до входу', kk: 'Кіруге оралу' },

  // ── auth: reset password ──
  'auth.reset.subtitle':     { en: 'New password', ru: 'Новый пароль', it: 'Nuova password', fr: 'Nouveau mot de passe', az: 'Yeni şifrə', tr: 'Yeni şifre', uk: 'Новий пароль', kk: 'Жаңа құпиясөз' },
  'auth.reset.openFromEmail':{ en: 'Open this page from the password reset link in your email.', ru: 'Откройте эту страницу по ссылке из письма для сброса пароля.', it: "Apri questa pagina dal link di reimpostazione nella tua email.", fr: "Ouvrez cette page via le lien de réinitialisation reçu par e-mail.", az: 'Bu səhifəni e-poçtdakı sıfırlama linki ilə açın.', tr: "Bu sayfayı e-postanızdaki sıfırlama bağlantısından açın.", uk: 'Відкрийте цю сторінку за посиланням зі скидання пароля в листі.', kk: 'Бұл бетті email-дегі қалпына келтіру сілтемесі арқылы ашыңыз.' },
  'auth.reset.submit':       { en: 'Save password', ru: 'Сохранить пароль', it: 'Salva password', fr: 'Enregistrer le mot de passe', az: 'Şifrəni yadda saxla', tr: 'Şifreyi kaydet', uk: 'Зберегти пароль', kk: 'Құпиясөзді сақтау' },
  'auth.reset.submitting':   { en: 'Saving…', ru: 'Сохраняем…', it: 'Salvataggio…', fr: 'Enregistrement…', az: 'Yadda saxlanılır…', tr: 'Kaydediliyor…', uk: 'Збереження…', kk: 'Сақталуда…' },
  'auth.reset.doneTitle':    { en: 'Password changed', ru: 'Пароль изменён', it: 'Password modificata', fr: 'Mot de passe modifié', az: 'Şifrə dəyişdirildi', tr: 'Şifre değiştirildi', uk: 'Пароль змінено', kk: 'Құпиясөз өзгертілді' },
  'auth.reset.toDashboard':  { en: 'Go to dashboard', ru: 'В личный кабинет', it: 'Vai alla dashboard', fr: 'Aller au tableau de bord', az: 'İdarə panelinə keç', tr: "Panele git", uk: 'До кабінету', kk: 'Басқару тақтасына өту' },

  // ── guest menu (язык телефона гостя; контент блюд — как ввёл владелец) ──
  'menu.notFound':     { en: 'Menu not found', ru: 'Меню не найдено', it: 'Menu non trovato', fr: 'Menu introuvable', az: 'Menyu tapılmadı', tr: 'Menü bulunamadı', uk: 'Меню не знайдено', kk: 'Мәзір табылмады' },
  'menu.notFoundHint': { en: 'Check the link or ask the staff', ru: 'Проверьте ссылку или обратитесь к персоналу', it: 'Controlla il link o chiedi al personale', fr: 'Vérifiez le lien ou demandez au personnel', az: 'Linki yoxlayın və ya işçilərə müraciət edin', tr: 'Bağlantıyı kontrol edin veya personele sorun', uk: 'Перевірте посилання або зверніться до персоналу', kk: 'Сілтемені тексеріңіз немесе қызметкерге хабарласыңыз' },
  'menu.search':       { en: 'Search the menu…', ru: 'Поиск по меню…', it: 'Cerca nel menu…', fr: 'Rechercher dans le menu…', az: 'Menyuda axtar…', tr: 'Menüde ara…', uk: 'Пошук у меню…', kk: 'Мәзірден іздеу…' },
  'menu.kcal':         { en: 'kcal', ru: 'ккал', it: 'kcal', fr: 'kcal', az: 'kkal', tr: 'kcal', uk: 'ккал', kk: 'ккал' },
  'menu.unavailable':  { en: 'Out of stock', ru: 'Нет в наличии', it: 'Non disponibile', fr: 'Indisponible', az: 'Mövcud deyil', tr: 'Mevcut değil', uk: 'Немає в наявності', kk: 'Қоймада жоқ' },
  'menu.nothingFound': { en: 'Nothing found', ru: 'Ничего не найдено', it: 'Nessun risultato', fr: 'Aucun résultat', az: 'Heç nə tapılmadı', tr: 'Hiçbir şey bulunamadı', uk: 'Нічого не знайдено', kk: 'Ештеңе табылмады' },
  'menu.tryAnother':   { en: 'Try another search', ru: 'Попробуйте другой запрос', it: 'Prova un’altra ricerca', fr: 'Essayez une autre recherche', az: 'Başqa axtarış sınayın', tr: 'Başka bir arama deneyin', uk: 'Спробуйте інший запит', kk: 'Басқа сұраныс байқап көріңіз' },
  'menu.add':          { en: 'Add', ru: 'Добавить', it: 'Aggiungi', fr: 'Ajouter', az: 'Əlavə et', tr: 'Ekle', uk: 'Додати', kk: 'Қосу' },
  'menu.yourBill':     { en: 'Your bill', ru: 'Ваш счёт', it: 'Il tuo conto', fr: 'Votre addition', az: 'Hesabınız', tr: 'Hesabınız', uk: 'Ваш рахунок', kk: 'Шотыңыз' },
  'menu.table':        { en: 'table', ru: 'стол', it: 'tavolo', fr: 'table', az: 'masa', tr: 'masa', uk: 'стіл', kk: 'үстел' },
  'menu.tableCap':     { en: 'Table', ru: 'Стол', it: 'Tavolo', fr: 'Table', az: 'Masa', tr: 'Masa', uk: 'Стіл', kk: 'Үстел' },
  'menu.order':        { en: 'Order', ru: 'Заказ', it: 'Ordine', fr: 'Commande', az: 'Sifariş', tr: 'Sipariş', uk: 'Замовлення', kk: 'Тапсырыс' },
  'menu.totalTable':   { en: 'Table total', ru: 'Итого за стол', it: 'Totale tavolo', fr: 'Total table', az: 'Masa cəmi', tr: 'Masa toplamı', uk: 'Разом за стіл', kk: 'Үстел бойынша жиыны' },
  'menu.callWaiter':   { en: 'Call the waiter', ru: 'Позвать официанта', it: 'Chiama il cameriere', fr: 'Appeler le serveur', az: 'Ofisiantı çağır', tr: 'Garsonu çağır', uk: 'Покликати офіціанта', kk: 'Даяшыны шақыру' },
  'menu.waiterComing': { en: '✓ The waiter is on the way', ru: '✓ Официант скоро подойдёт', it: '✓ Il cameriere sta arrivando', fr: '✓ Le serveur arrive', az: '✓ Ofisiant gəlir', tr: '✓ Garson geliyor', uk: '✓ Офіціант уже йде', kk: '✓ Даяшы келе жатыр' },
  'menu.cart':         { en: 'Cart', ru: 'Корзина', it: 'Carrello', fr: 'Panier', az: 'Səbət', tr: 'Sepet', uk: 'Кошик', kk: 'Себет' },
  'menu.yourOrder':    { en: 'Your order', ru: 'Ваш заказ', it: 'Il tuo ordine', fr: 'Votre commande', az: 'Sifarişiniz', tr: 'Siparişiniz', uk: 'Ваше замовлення', kk: 'Тапсырысыңыз' },
  'menu.total':        { en: 'Total', ru: 'Итого', it: 'Totale', fr: 'Total', az: 'Cəmi', tr: 'Toplam', uk: 'Разом', kk: 'Жиыны' },
  'menu.payAtTable':   { en: 'Pay at the table — the waiter takes payment on serving', ru: 'Оплата за столом — официант примет оплату при подаче', it: 'Pagamento al tavolo — il cameriere incassa alla consegna', fr: 'Paiement à table — le serveur encaisse au service', az: 'Masada ödəniş — ofisiant verərkən ödənişi alır', tr: 'Masada ödeme — garson servis sırasında alır', uk: 'Оплата за столом — офіціант прийме оплату при подачі', kk: 'Үстелде төлеу — даяшы әкелгенде төлемді қабылдайды' },
  'menu.sendOrder':    { en: 'Send order', ru: 'Отправить заказ', it: 'Invia ordine', fr: 'Envoyer la commande', az: 'Sifarişi göndər', tr: 'Siparişi gönder', uk: 'Надіслати замовлення', kk: 'Тапсырысты жіберу' },
  'menu.orderSent':    { en: '✓ Order sent', ru: '✓ Заказ отправлен', it: '✓ Ordine inviato', fr: '✓ Commande envoyée', az: '✓ Sifariş göndərildi', tr: '✓ Sipariş gönderildi', uk: '✓ Замовлення надіслано', kk: '✓ Тапсырыс жіберілді' },
}
