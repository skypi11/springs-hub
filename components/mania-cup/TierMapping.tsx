'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, Plug, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { TICKET_KINDS, TICKET_LABELS, type TicketKind } from '@/lib/helloasso/types';

// Correspondance entre les tarifs réels de la billetterie et nos catégories.
//
// C'est elle qui permet au site de savoir qu'un billet à 30 € confirme une
// place, qu'un billet à 20 € rattache un accompagnant, et qu'une location de
// poste ne vaut jamais règlement de l'inscription.
//
// Deux choix qui comptent :
//
// La correspondance se fait sur l'IDENTIFIANT du tarif, pas sur son libellé.
// Renommer « Joueur » en « Joueur (early bird) » dans le back-office HelloAsso
// ne casse donc rien — alors qu'une correspondance par nom aurait cessé de
// reconnaître les paiements, en silence, ce qui est le pire cas.
//
// Les tarifs sont LUS chez HelloAsso plutôt que saisis à la main : recopier des
// identifiants numériques est exactement le genre de tâche où l'on se trompe
// d'un chiffre sans jamais s'en apercevoir.

type Tier = {
  id: number;
  label: string;
  priceCents: number;
  /** D'où vient ce tarif — la même correspondance couvre les deux formulaires. */
  formType?: 'Event' | 'Shop';
  formSlug?: string;
};

type Payload = {
  configured: boolean;
  error?: string;
  organizationSlug?: string;
  /** Les formulaires lus : la billetterie, et la boutique quand elle existe. */
  forms?: { type: 'Event' | 'Shop'; slug: string }[];
  tiers?: Tier[];
  tierMap?: string;
  codeField?: string;
};

const euros = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

/** Ce que la base a enregistré, ramené à ce que le formulaire manipule. */
function fromServer(data: Payload | undefined): Draft {
  let mapping: Record<string, TicketKind | ''> = {};
  try {
    mapping = JSON.parse(data?.tierMap || '{}') as Record<string, TicketKind>;
  } catch {
    // Correspondance illisible en base : on repart d'une page blanche plutôt
    // que de faire planter l'écran qui sert justement à la réparer.
    mapping = {};
  }
  return { mapping, codeField: data?.codeField ?? '' };
}

type Draft = { mapping: Record<string, TicketKind | ''>; codeField: string };

export default function TierMapping() {
  const qc = useQueryClient();
  // L'état vient du serveur tant que personne n'a rien touché. Recopier la
  // réponse dans un état par un effet demanderait de resynchroniser à chaque
  // relecture, et c'est ce qui produit les formulaires qui écrasent la saisie
  // en cours.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'mania-cup', 'tiers'] as const,
    queryFn: () => api<Payload>('/api/admin/mania-cup/helloasso?action=tiers'),
    // Un appel sortant vers HelloAsso : on ne le relance pas à chaque retour
    // sur l'onglet.
    staleTime: 5 * 60_000,
    retry: false,
  });

  const current = draft ?? fromServer(data);
  const { mapping, codeField } = current;
  const dirty = draft !== null;

  function edit(patch: Partial<Draft>) {
    setDraft({ ...current, ...patch });
    setMsg(null);
  }

  const save = useMutation({
    mutationFn: () => {
      // Seuls ces deux réglages partent : le serveur laisse intact tout champ
      // absent du corps, donc les tarifs et les liens ne bougent pas.
      const clean = Object.fromEntries(
        Object.entries(mapping).filter(([, v]) => v)
      );
      return api('/api/mania-cup/settings', {
        method: 'PUT',
        body: {
          helloAssoTierMap: Object.keys(clean).length > 0 ? JSON.stringify(clean) : '',
          helloAssoCodeField: codeField,
        },
      });
    },
    onSuccess: () => {
      setMsg('Correspondance enregistrée.');
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'mania-cup'] });
    },
    onError: (e) => setMsg(e instanceof ApiError ? e.message : 'Enregistrement refusé.'),
  });

  const tiers = data?.tiers ?? [];

  /** Une catégorie attribuée deux fois est presque sûrement une erreur de
   *  saisie : deux tarifs « joueur » feraient compter deux places pour un seul
   *  inscrit. */
  const duplicates = useMemo(() => {
    const seen = new Map<string, number>();
    for (const value of Object.values(mapping)) {
      if (!value) continue;
      seen.set(value, (seen.get(value) ?? 0) + 1);
    }
    return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k as TicketKind);
  }, [mapping]);

  if (isLoading) {
    return (
      <section className="mt-8 border border-white/10 bg-white/[0.02] p-6">
        <div className="flex items-center gap-3" style={{ color: 'var(--s-text-dim)' }}>
          <Loader2 className="animate-spin" size={18} /> Lecture des tarifs HelloAsso…
        </div>
      </section>
    );
  }

  return (
    <section className="mt-8 border border-white/10 bg-white/[0.02] p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Plug size={22} className="text-[#a364d9]" aria-hidden />
          <h2 className="font-display text-2xl">Correspondance des tarifs</h2>
        </div>
        <button
          onClick={() => void refetch()}
          disabled={isFetching}
          className="border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-50"
        >
          {isFetching ? 'Lecture…' : 'Relire les tarifs depuis HelloAsso'}
        </button>
      </div>

      {!data?.configured || isError ? (
        <div className="mt-5 flex gap-3 border border-[#FFB800]/40 bg-[#FFB800]/[0.08] p-4">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[#FFB800]" aria-hidden />
          <div className="text-sm text-[#f2e6c8]">
            <p>
              {data?.error ??
                'Impossible de joindre HelloAsso. Les clés d’API ne sont pas encore renseignées côté serveur.'}
            </p>
            <p className="mt-2" style={{ color: 'var(--s-text-muted)' }}>
              Tant qu’elles manquent, les règlements ne remontent pas tout seuls : ils se
              confirment à la main depuis l’onglet Inscriptions. Rien n’est perdu, mais
              rien n’est automatique.
            </p>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-4 text-sm" style={{ color: 'var(--s-text-dim)' }}>
            Association <code>{data.organizationSlug}</code> —{' '}
            {(data.forms ?? []).map((f) => f.slug).join(', ') || 'aucun formulaire'} ·{' '}
            {tiers.length} tarif{tiers.length > 1 ? 's' : ''}.
          </p>

          {tiers.length === 0 ? (
            <p className="mt-4 text-sm" style={{ color: 'var(--s-text-muted)' }}>
              Aucun tarif n’est encore publié sur ce formulaire.
            </p>
          ) : (
            <div className="mt-5 space-y-3">
              {tiers.map((t) => (
                <div
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-3 border border-white/10 bg-black/30 p-4"
                >
                  <div className="min-w-0">
                    <div className="font-semibold">{t.label || `Tarif ${t.id}`}</div>
                    <div className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                      {euros(t.priceCents)} · identifiant {t.id}
                      {t.formType === 'Shop' && ' · boutique'}
                    </div>
                  </div>
                  <select
                    value={mapping[String(t.id)] ?? ''}
                    onChange={(e) =>
                      edit({
                        mapping: { ...mapping, [String(t.id)]: e.target.value as TicketKind | '' },
                      })
                    }
                    className="border border-white/15 bg-black/40 px-3 py-2 text-white outline-none focus:border-[#00D936]"
                    aria-label={`Catégorie du tarif ${t.label}`}
                  >
                    <option value="">— ne pas traiter —</option>
                    {TICKET_KINDS.map((k) => (
                      <option key={k} value={k} className="bg-[#07050b]">
                        {TICKET_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}

          {duplicates.length > 0 && (
            <p className="mt-4 flex items-start gap-2 text-sm text-[#FFB800]">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
              {duplicates.map((d) => TICKET_LABELS[d]).join(', ')} —
              {duplicates.length > 1 ? ' ces catégories sont' : ' cette catégorie est'} attribuée
              à plusieurs tarifs. C’est possible, mais vérifiez que c’est voulu.
            </p>
          )}

          <div className="mt-6">
            <label htmlFor="codeField" className="block text-sm font-semibold">
              Libellé du champ « code d’inscription »
            </label>
            <input
              id="codeField"
              value={codeField}
              onChange={(e) => edit({ codeField: e.target.value })}
              className="mt-2 w-full max-w-md border border-white/15 bg-black/40 px-3 py-2 text-white outline-none focus:border-[#00D936]"
            />
            <p className="mt-1.5 text-xs" style={{ color: 'var(--s-text-muted)' }}>
              Tel qu’il est écrit sur le formulaire HelloAsso. Une différence de casse ou
              d’apostrophe n’a pas d’importance : tout champ dont le nom contient « code »
              est reconnu en secours.
            </p>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending || !dirty}
              className="inline-flex items-center gap-2 bg-[#00D936] px-5 py-2.5 font-bold text-[#07050b] disabled:opacity-40"
            >
              {save.isPending ? (
                <Loader2 className="animate-spin" size={16} aria-hidden />
              ) : (
                <Save size={16} aria-hidden />
              )}
              Enregistrer
            </button>
            {msg && (
              <span
                className="inline-flex items-center gap-1.5 text-sm"
                style={{ color: save.isError ? '#ef4444' : '#22c55e' }}
              >
                {!save.isError && <CheckCircle2 size={15} aria-hidden />}
                {msg}
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
