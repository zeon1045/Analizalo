import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/main-player/songs/$songId/edit')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/main-player/songs/$songId/edit"!</div>
}
