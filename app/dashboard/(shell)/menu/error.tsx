'use client'

export default function ManagerError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1rem' }}>Something went wrong</h2>
      <p style={{ color: '#666', marginBottom: '1.5rem' }}>{error.message || 'An unexpected error occurred'}</p>
      <button onClick={reset} style={{ padding: '0.5rem 1.5rem', borderRadius: '8px', border: 'none', background: '#007aff', color: 'white', fontSize: '1rem', cursor: 'pointer' }}>Try again</button>
    </div>
  )
}
