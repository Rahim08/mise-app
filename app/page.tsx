import { redirect } from 'next/navigation'

export default function Home() {
  return (
    <main style={{fontFamily:'-apple-system,sans-serif',background:'#fff',minHeight:'100vh'}}>
      <iframe src="/landing.html" style={{width:'100%',height:'100vh',border:'none'}} />
    </main>
  )
}
