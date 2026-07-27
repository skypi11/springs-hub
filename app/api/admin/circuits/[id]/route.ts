import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import { validateCircuitPayload } from '@/lib/competitions/validate';

// Édition/suppression d'un circuit — admins Aedral complets uniquement (la
// configuration des compétitions n'est pas dans le périmètre du rôle scopé).

// PATCH /api/admin/circuits/[id] — édition, verrouillée après draft
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id } = await params;
    const body = await req.json();

    const db = getAdminDb();
    const ref = db.collection('circuits').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'Circuit introuvable' }, { status: 404 });
    const current = snap.data()!;
    const currentStatus = (current.status as string) ?? 'draft';

    // ── Publication / retour en brouillon ────────────────────────────────────
    // Un circuit naît en brouillon et reste invisible du public (isCircuitHidden).
    // Sans cette action, il n'existait AUCUN moyen de le rendre public : la page
    // du circuit était condamnée au 404 pour tout le monde.
    if (body?.action === 'publish' || body?.action === 'unpublish') {
      const wantPublic = body.action === 'publish';
      if (currentStatus === 'finished' || currentStatus === 'archived') {
        return NextResponse.json(
          { error: 'Ce circuit est terminé : sa visibilité ne se change plus.' },
          { status: 409 },
        );
      }
      // Idempotent : un double-clic ne doit pas produire une erreur.
      if (wantPublic === (currentStatus === 'active')) {
        return NextResponse.json({ success: true, status: currentStatus });
      }
      if (!wantPublic) {
        // Retirer du public un circuit dont une étape est déjà jouée effacerait
        // un classement que les équipes ont sous les yeux.
        const compIds = (current.competitionIds as string[] | undefined) ?? [];
        const played = await Promise.all(compIds.map(async cid => {
          const c = await db.collection('competitions').doc(cid).get();
          const s = c.data()?.status as string | undefined;
          return s === 'finished' || s === 'archived';
        }));
        if (played.some(Boolean)) {
          return NextResponse.json(
            { error: 'Une étape de ce circuit est déjà terminée : son classement est public, le circuit ne peut plus repasser en brouillon.' },
            { status: 409 },
          );
        }
      }
      const nextStatus = wantPublic ? 'active' : 'draft';
      await ref.update({ status: nextStatus, updatedAt: FieldValue.serverTimestamp() });
      await writeAdminAuditLog(db, {
        action: wantPublic ? 'circuit_published' : 'circuit_unpublished',
        adminUid: uid,
        targetType: 'circuit',
        targetId: id,
        targetLabel: (current.name as string) ?? id,
      });
      return NextResponse.json({ success: true, status: nextStatus });
    }

    // ── Édition ──────────────────────────────────────────────────────────────
    const validated = validateCircuitPayload(body);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    const { name, game, pointsScale, bestResultsCount, lanTeamCount, prizePool, organizer, tieBreakers } = validated.value;

    // Une fois le circuit public, tout n'est plus égal : le barème et les règles
    // de classement ont été annoncés aux équipes et des points sont peut-être
    // déjà écrits — les changer réécrirait l'histoire. Le reste (nom, dotation,
    // organisateur, places en LAN) reste corrigeable : interdire TOUTE édition
    // obligeait à dépublier pour rectifier une faute de frappe.
    if (currentStatus !== 'draft') {
      // Comparaison insensible à l'ordre des clés : le barème est un objet
      // ("1".."N"), et un simple JSON.stringify aurait pu signaler un
      // changement fantôme qui aurait interdit de corriger un simple nom.
      const stable = (v: unknown): string => {
        if (v === null || v === undefined) return 'null';
        if (Array.isArray(v)) return JSON.stringify(v);
        if (typeof v === 'object') {
          return JSON.stringify(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
        }
        return JSON.stringify(v);
      };
      const frozen: Array<[string, unknown, unknown]> = [
        ['le jeu', game, current.game],
        ['le barème de points', pointsScale, current.pointsScale],
        ['le nombre de résultats retenus', bestResultsCount, current.bestResultsCount],
        ['les départages', tieBreakers, current.tieBreakers],
      ];
      const changed = frozen.find(([, next, prev]) => stable(next) !== stable(prev));
      if (changed) {
        return NextResponse.json(
          { error: `Circuit publié : ${changed[0]} ne peut plus changer (le classement en dépend). Nom, dotation, organisateur et places en LAN restent modifiables.` },
          { status: 409 },
        );
      }
    }

    // Le statut ne passe pas par cette édition (action dédiée ci-dessus) et
    // competitionIds est maintenu par le CRUD compétitions (arrayUnion/Remove).
    await ref.update({
      name, game, pointsScale, bestResultsCount, lanTeamCount, prizePool, organizer, tieBreakers,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await writeAdminAuditLog(db, {
      action: 'circuit_edited',
      adminUid: uid,
      targetType: 'circuit',
      targetId: id,
      targetLabel: validated.value.name,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Admin/Circuits PATCH error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// DELETE /api/admin/circuits/[id] — uniquement draft ET sans compétition rattachée
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id } = await params;
    const db = getAdminDb();
    const ref = db.collection('circuits').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'Circuit introuvable' }, { status: 404 });

    const data = snap.data() ?? {};
    if (data.status !== 'draft') {
      return NextResponse.json({ error: 'Seul un circuit en brouillon peut être supprimé.' }, { status: 409 });
    }
    const attached = (data.competitionIds ?? []) as string[];
    if (attached.length > 0) {
      return NextResponse.json(
        { error: `Ce circuit a ${attached.length} compétition(s) rattachée(s) : détache-les ou supprime-les d'abord.` },
        { status: 409 },
      );
    }

    await ref.delete();

    await writeAdminAuditLog(db, {
      action: 'circuit_deleted',
      adminUid: uid,
      targetType: 'circuit',
      targetId: id,
      targetLabel: (data.name as string) ?? null,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Admin/Circuits DELETE error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
