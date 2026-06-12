interface SegmentedTheme {
  fill: string
  surface: string
  text: string
  text3: string
  sh2: string
}

export function Segmented({ options, value, onChange, t }: {
  options: { id: string; label: string }[]
  value: string
  onChange: (v: string) => void
  t: SegmentedTheme
}) {
  return (
    <div style={{ display: 'flex', background: t.fill, borderRadius: 12, padding: 3, gap: 2 }}>
      {options.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)} style={{
          flex: 1, padding: '8px 0', borderRadius: 10, border: 'none',
          fontFamily: 'inherit', fontSize: 14, fontWeight: value === o.id ? 600 : 500,
          cursor: 'pointer',
          background: value === o.id ? t.surface : 'transparent',
          color: value === o.id ? t.text : t.text3,
          boxShadow: value === o.id ? t.sh2 : 'none',
          transition: 'all .18s',
        }}>{o.label}</button>
      ))}
    </div>
  )
}
