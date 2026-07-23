import { redirect } from 'next/navigation';

// /admin/competitions/[id] n'a pas de fiche propre : la page admin d'une
// compétition EST sa console. URL devinable à la main (retour Matt : 404 sur
// /admin/competitions/demo-swiss) → on redirige au lieu de casser.
export default async function AdminCompetitionIndex({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/competitions/${id}/console`);
}
