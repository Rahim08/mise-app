export default function NotFound() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '4rem', fontWeight: 700, color: '#ccc', margin: 0 }}>404</h1>
        <p style={{ color: '#999', marginTop: '0.5rem' }}>Page not found</p>
        <a href="/" style={{ color: '#007aff', textDecoration: 'none', fontSize: '0.9rem', marginTop: '1rem', display: 'inline-block' }}>Go home</a>
      </div>
    </div>
  )
}
