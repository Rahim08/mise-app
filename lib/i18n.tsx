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
  // ── common ──
  'common.or':      { en: 'or', ru: 'или', it: 'oppure', fr: 'ou', az: 'və ya', tr: 'veya', uk: 'або', kk: 'немесе' },
  'common.show':    { en: 'Show', ru: 'Показать', it: 'Mostra', fr: 'Afficher', az: 'Göstər', tr: 'Göster', uk: 'Показати', kk: 'Көрсету' },
  'common.hide':    { en: 'Hide', ru: 'Скрыть', it: 'Nascondi', fr: 'Masquer', az: 'Gizlət', tr: 'Gizle', uk: 'Сховати', kk: 'Жасыру' },
  'common.loading': { en: 'Loading…', ru: 'Загрузка…', it: 'Caricamento…', fr: 'Chargement…', az: 'Yüklənir…', tr: 'Yükleniyor…', uk: 'Завантаження…', kk: 'Жүктелуде…' },

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
}
