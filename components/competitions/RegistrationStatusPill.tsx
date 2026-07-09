// Pastille de statut d'inscription unifiée pour tout le module (fiche Qualif,
// suivi structure, panel admin). Marqueur carré + libellé, couleur par état.
// JAMAIS de vert brut #33ff66 comme « statut système » (vert = Trackmania) :
// « validée » = near-white, l'absence d'alerte suffit comme signal positif.
const MAP: Record<string, { label: string; color: string }> = {
  pending: { label: 'En attente', color: 'var(--s-text-dim)' },
  waitlisted: { label: "Liste d'attente", color: '#ffb46b' },
  approved: { label: 'Validée', color: 'var(--s-text)' },
  rejected: { label: 'Refusée', color: '#ff8a8a' },
  withdrawn: { label: 'Retirée', color: 'var(--s-text-muted)' },
};

export default function RegistrationStatusPill({ status }: { status: string }) {
  const s = MAP[status] ?? { label: status, color: 'var(--s-text-dim)' };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: s.color }}>
      <span style={{ width: 6, height: 6, background: s.color, display: 'inline-block' }} />
      {s.label}
    </span>
  );
}
