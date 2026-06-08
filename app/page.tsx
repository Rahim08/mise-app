export default function Home() {
  return (
    <main style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
      background: '#fff',
      color: '#1d1d1f',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      padding: '0 24px'
    }}>
      <h1 style={{fontSize: '4rem', fontWeight: 700, letterSpacing: '-.04em'}}>
        Mise
      </h1>
      <p style={{fontSize: '1.2rem', color: '#6e6e73', marginTop: 16, maxWidth: 500}}>
        Система управления рестораном нового поколения
      </p>
      <a href="/auth/login" style={{
        marginTop: 40,
        background: '#0071e3',
        color: '#fff',
        padding: '14px 32px',
        borderRadius: 980,
        textDecoration: 'none',
        fontSize: '1rem'
      }}>
        Начать →
      </a>
    </main>
  )
}
