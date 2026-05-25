'use client';

import { Crown, Shield, UserCheck, Headphones, Briefcase, Star, Users, Check, X, BookOpen } from 'lucide-react';
import {
  ROLE_DEFINITIONS,
  ROLE_COLOR_MAP,
  ROLE_ORDER,
  type StructureRole,
  type RoleDefinition,
} from '@/lib/role-capabilities';

const ROLE_ICONS: Record<StructureRole, React.ComponentType<{ size?: number; style?: React.CSSProperties }>> = {
  fondateur: Crown,
  co_fondateur: Crown,
  responsable: Briefcase,
  coach_structure: Headphones,
  manager_equipe: Shield,
  coach_equipe: UserCheck,
  capitaine: Star,
};

// Panneau qui affiche les capacités d'UN rôle précis (utilisé dans le modal
// de promotion + dans la page d'aide complète). Listes ✅ / ❌ groupées.
export function RoleInfoCard({ role, compact = false }: { role: RoleDefinition; compact?: boolean }) {
  const Icon = ROLE_ICONS[role.key];
  const colors = ROLE_COLOR_MAP[role.color];

  // Regroupe les capacités par catégorie pour lisibilité
  const groupByCategory = (caps: typeof role.can) => {
    const map = new Map<string, string[]>();
    for (const c of caps) {
      if (!map.has(c.category)) map.set(c.category, []);
      map.get(c.category)!.push(c.label);
    }
    return Array.from(map.entries());
  };

  const canGroups = groupByCategory(role.can);
  const cantGroups = groupByCategory(role.cant);

  return (
    <div className="bevel-sm overflow-hidden" style={{ background: 'var(--s-surface)', border: `1px solid ${colors.border}` }}>
      {/* Header avec icône et nom */}
      <div className="px-4 py-3 flex items-center gap-3" style={{ background: colors.bg, borderBottom: `1px solid ${colors.border}` }}>
        <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center bevel-sm" style={{ background: colors.bg, border: `1px solid ${colors.border}` }}>
          <Icon size={18} style={{ color: colors.fg }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-lg tracking-wider" style={{ color: colors.fg }}>{role.name.toUpperCase()}</h3>
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--s-text-dim)' }}>{role.tagline}</p>
        </div>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Scope */}
        <div className="flex items-start gap-2 text-xs">
          <Users size={12} style={{ color: 'var(--s-text-muted)', marginTop: 2 }} className="flex-shrink-0" />
          <div>
            <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>Périmètre : </span>
            <span style={{ color: 'var(--s-text)' }}>{role.scope}</span>
          </div>
        </div>

        {/* Peut faire */}
        {canGroups.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Check size={12} style={{ color: '#33ff66' }} />
              <span className="t-label" style={{ color: '#33ff66' }}>Peut faire</span>
            </div>
            <div className="space-y-2 pl-4">
              {canGroups.map(([cat, labels]) => (
                <div key={cat}>
                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--s-text-muted)' }}>{cat}</p>
                  <ul className="space-y-0.5">
                    {labels.map((label, i) => (
                      <li key={i} className="text-xs flex items-start gap-1.5" style={{ color: 'var(--s-text)' }}>
                        <span style={{ color: '#33ff66', marginTop: 1 }}>•</span>
                        <span>{label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Ne peut pas faire */}
        {!compact && cantGroups.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <X size={12} style={{ color: '#ff8a8a' }} />
              <span className="t-label" style={{ color: '#ff8a8a' }}>Ne peut pas faire</span>
            </div>
            <div className="space-y-2 pl-4">
              {cantGroups.map(([cat, labels]) => (
                <div key={cat}>
                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--s-text-muted)' }}>{cat}</p>
                  <ul className="space-y-0.5">
                    {labels.map((label, i) => (
                      <li key={i} className="text-xs flex items-start gap-1.5" style={{ color: 'var(--s-text-dim)' }}>
                        <span style={{ color: '#ff8a8a', marginTop: 1 }}>•</span>
                        <span>{label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Liste complète de tous les rôles — pour la page d'aide.
export function AllRolesPanel() {
  return (
    <div className="space-y-4">
      <div className="p-4 bevel-sm" style={{ background: 'rgba(255,184,0,0.06)', border: '1px solid rgba(255,184,0,0.2)' }}>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--s-text-dim)' }}>
          Récapitulatif des 7 rôles structure / équipe et de leurs permissions. Utile avant de promouvoir
          quelqu'un pour comprendre exactement ce qu'il va débloquer.
        </p>
      </div>
      <div className="space-y-3">
        {ROLE_ORDER.map(roleKey => (
          <RoleInfoCard key={roleKey} role={ROLE_DEFINITIONS[roleKey]} />
        ))}
      </div>
    </div>
  );
}

// Modal d'aide : affiche la matrice complète de tous les rôles. Accessible
// depuis le general-tab pour les dirigeants. Le contenu scrolle si nécessaire.
export function RolesHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col bevel"
        style={{ background: 'var(--s-bg)', border: '1px solid var(--s-border)' }}
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--s-border)' }}>
          <div className="flex items-center gap-2">
            <BookOpen size={18} style={{ color: 'var(--s-gold)' }} />
            <h2 className="font-display text-xl tracking-wider">RÔLES & PERMISSIONS</h2>
          </div>
          <button type="button" onClick={onClose}
            className="w-7 h-7 flex items-center justify-center transition-colors duration-150"
            style={{ background: 'transparent', border: '1px solid var(--s-border)', color: 'var(--s-text-dim)' }}
            aria-label="Fermer">
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <AllRolesPanel />
        </div>
      </div>
    </div>
  );
}

// Modal de confirmation de promotion : affiche l'info du rôle + boutons confirmer/annuler.
export function PromoteRoleModal({
  role,
  targetName,
  onConfirm,
  onCancel,
  busy,
}: {
  role: StructureRole;
  targetName: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const def = ROLE_DEFINITIONS[role];

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={onCancel}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto bevel"
        style={{ background: 'var(--s-bg)', border: '1px solid var(--s-border)' }}
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--s-border)' }}>
          <h2 className="font-display text-xl tracking-wider">PROMOUVOIR {def.name.toUpperCase()}</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--s-text-dim)' }}>
            Tu vas promouvoir <strong style={{ color: 'var(--s-text)' }}>{targetName}</strong> au rôle de <strong style={{ color: 'var(--s-gold)' }}>{def.name}</strong>.
            Voici ce qu'il pourra faire :
          </p>
        </div>

        <div className="px-5 py-4">
          <RoleInfoCard role={def} />
        </div>

        <div className="px-5 py-4 border-t flex items-center justify-end gap-2" style={{ borderColor: 'var(--s-border)' }}>
          <button type="button" onClick={onCancel} disabled={busy}
            className="btn-springs btn-secondary bevel-sm">
            Annuler
          </button>
          <button type="button" onClick={onConfirm} disabled={busy}
            className="btn-springs btn-primary bevel-sm">
            {busy ? 'Promotion…' : `Confirmer la promotion`}
          </button>
        </div>
      </div>
    </div>
  );
}
