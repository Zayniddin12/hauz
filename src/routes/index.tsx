import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <main>
      <h1>HAUZ</h1>
      <p>Real estate marketplace for Uzbekistan.</p>
    </main>
  )
}
