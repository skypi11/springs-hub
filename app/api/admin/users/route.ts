import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { resolveEpicAccount } from '@/lib/tracker-gg';
import { safeUrl, clampString, LIMITS } from '@/lib/validation';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';

// Plafond dur sur le nombre d'utilisateurs renvoyés en une seule fois — protège
// la facture Firestore quand la base grossit. Au-delà, prévoir une vraie pagination + recherche.
const MAX_USERS = 500;

// GET /api/admin/users — lister tous les utilisateurs inscrits (admin only)
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const db = getAdminDb();

    // Charger users (plafonné) + admins + structure_members en parallèle
    const [usersSnap, adminsSnap, membersSnap] = await Promise.all([
      db.collection('users').limit(MAX_USERS).get(),
      db.collection('admins').get(),
      db.collection('structure_members').get(),
    ]);

    const adminSet = new Set(adminsSnap.docs.map(d => d.id));

    // Map structureId → structure name (lazy load)
    const structureNames: Record<string, string> = {};
    const membersByUser: Record<string, { structureId: string; game: string; role: string }[]> = {};
    for (const doc of membersSnap.docs) {
      const d = doc.data();
      if (!d.userId) continue;
      if (!membersByUser[d.userId]) membersByUser[d.userId] = [];
      membersByUser[d.userId].push({
        structureId: d.structureId,
        game: d.game,
        role: d.role,
      });
      if (d.structureId && !structureNames[d.structureId]) {
        structureNames[d.structureId] = ''; // placeholder
      }
    }

    // Fetch structure names
    const structureIds = Object.keys(structureNames);
    if (structureIds.length > 0) {
      // Firestore 'in' max 30 — batch
      for (let i = 0; i < structureIds.length; i += 30) {
        const batch = structureIds.slice(i, i + 30);
        const sSnap = await db.collection('structures').where('__name__', 'in', batch).get();
        for (const doc of sSnap.docs) {
          structureNames[doc.id] = doc.data().name || doc.id;
        }
      }
    }

    const users = usersSnap.docs.map(doc => {
      const data = doc.data();
      const memberships = (membersByUser[doc.id] || []).map(m => ({
        ...m,
        structureName: structureNames[m.structureId] || m.structureId,
      }));
      return {
        uid: doc.id,
        displayName: data.displayName || data.discordUsername || '',
        discordUsername: data.discordUsername || '',
        discordAvatar: data.discordAvatar || '',
        avatarUrl: data.avatarUrl || '',
        country: data.country || '',
        bio: data.bio || '',
        games: data.games || [],
        isAvailableForRecruitment: data.isAvailableForRecruitment || false,
        isBanned: data.isBanned || false,
        banReason: data.banReason || '',
        isAdmin: adminSet.has(doc.id),
        epicAccountId: data.epicAccountId || '',
        epicDisplayName: data.epicDisplayName || '',
        rlTrackerUrl: data.rlTrackerUrl || '',
        pseudoTM: data.pseudoTM || '',
        loginTM: data.loginTM || '',
        tmIoUrl: data.tmIoUrl || '',
        memberships,
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
      };
    });

    users.sort((a, b) => {
      if (!a.createdAt) return 1;
      if (!b.createdAt) return -1;
      return b.createdAt.localeCompare(a.createdAt);
    });

    return NextResponse.json({
      users,
      total: users.length,
      truncated: usersSnap.size >= MAX_USERS,
      max: MAX_USERS,
    });
  } catch (err) {
    captureApiError('API Admin/Users GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/admin/users — actions admin sur un utilisateur
export async function POST(req: NextRequest) {
  try {
    const adminUid = await verifyAuth(req);
    if (!adminUid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(adminUid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, adminUid));
    if (blocked) return blocked;

    const body = await req.json();
    const { userId, action, reason, editData, membershipStructureId } = body;

    if (!userId || !action) {
      return NextResponse.json({ error: 'userId et action requis' }, { status: 400 });
    }

    const db = getAdminDb();
    const authAdmin = getAdminAuth();
    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
    }

    switch (action) {
      // ─── Bannir ─────────────────────────────────────────────────────────
      case 'ban': {
        await userRef.update({
          isBanned: true,
          banReason: reason || '',
          bannedAt: FieldValue.serverTimestamp(),
          bannedBy: adminUid,
        });
        // Révoquer les tokens Firebase pour forcer la déconnexion
        try { await authAdmin.revokeRefreshTokens(userId); } catch { /* user might not exist in Auth */ }
        return NextResponse.json({ ok: true, message: 'Utilisateur banni' });
      }

      // ─── Débannir ───────────────────────────────────────────────────────
      case 'unban': {
        await userRef.update({
          isBanned: false,
          banReason: '',
          bannedAt: null,
          bannedBy: null,
        });
        return NextResponse.json({ ok: true, message: 'Utilisateur débanni' });
      }

      // ─── Forcer la déconnexion ──────────────────────────────────────────
      case 'force_disconnect': {
        try {
          await authAdmin.revokeRefreshTokens(userId);
        } catch {
          return NextResponse.json({ error: 'Impossible de révoquer les tokens' }, { status: 500 });
        }
        return NextResponse.json({ ok: true, message: 'Tokens révoqués — déconnexion forcée' });
      }

      // ─── Ajouter admin ─────────────────────────────────────────────────
      case 'add_admin': {
        if (userId === adminUid) {
          return NextResponse.json({ error: 'Tu ne peux pas te modifier toi-même' }, { status: 400 });
        }
        await db.collection('admins').doc(userId).set({
          addedBy: adminUid,
          addedAt: FieldValue.serverTimestamp(),
        });
        return NextResponse.json({ ok: true, message: 'Droits admin ajoutés' });
      }

      // ─── Retirer admin ─────────────────────────────────────────────────
      case 'remove_admin': {
        if (userId === adminUid) {
          return NextResponse.json({ error: 'Tu ne peux pas te retirer tes propres droits admin' }, { status: 400 });
        }
        await db.collection('admins').doc(userId).delete();
        return NextResponse.json({ ok: true, message: 'Droits admin retirés' });
      }

      // ─── Modifier les infos ────────────────────────────────────────────
      case 'edit': {
        if (!editData || typeof editData !== 'object') {
          return NextResponse.json({ error: 'editData requis' }, { status: 400 });
        }
        const editObj = editData as Record<string, unknown>;
        // Seuls certains champs sont modifiables par l'admin
        const allowed: Record<string, boolean> = {
          displayName: true, bio: true, country: true, games: true,
          isAvailableForRecruitment: true, recruitmentRole: true, recruitmentMessage: true,
          epicAccountId: true, rlTrackerUrl: true, pseudoTM: true, loginTM: true, tmIoUrl: true,
        };
        const updates: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(editObj)) {
          if (!allowed[key]) continue;
          // Sanitization par champ — URLs passent par safeUrl, textes par clampString
          if (key === 'displayName') updates[key] = clampString(val, LIMITS.displayName);
          else if (key === 'bio') updates[key] = clampString(val, LIMITS.bio);
          else if (key === 'recruitmentMessage') updates[key] = clampString(val, LIMITS.recruitmentMessage);
          else if (key === 'rlTrackerUrl' || key === 'tmIoUrl') updates[key] = safeUrl(val);
          else updates[key] = val;
        }
        if (Object.keys(updates).length === 0) {
          return NextResponse.json({ error: 'Aucun champ modifiable fourni' }, { status: 400 });
        }

        // Si l'admin a modifié le pseudo Epic, on retente la résolution
        if (typeof editObj.epicAccountId === 'string') {
          const typed = editObj.epicAccountId.trim();
          const existingData = userSnap.data() ?? {};
          if (typed && typed !== existingData.epicDisplayName) {
            const resolved = await resolveEpicAccount(typed);
            if (resolved) {
              updates.epicAccountId = resolved.id;
              updates.epicDisplayName = resolved.displayName;
            } else {
              updates.epicAccountId = typed;
              updates.epicDisplayName = typed;
            }
          } else if (!typed) {
            updates.epicAccountId = '';
            updates.epicDisplayName = '';
          }
        }

        await userRef.update(updates);
        return NextResponse.json({ ok: true, message: 'Profil mis à jour' });
      }

      // ─── Retirer d'une structure ────────────────────────────────────────
      case 'remove_from_structure': {
        if (!membershipStructureId) {
          return NextResponse.json({ error: 'membershipStructureId requis' }, { status: 400 });
        }
        // Vérifier que l'utilisateur n'est pas fondateur de la structure
        const structureSnap = await db.collection('structures').doc(membershipStructureId).get();
        if (structureSnap.exists && structureSnap.data()?.founderId === userId) {
          return NextResponse.json({ error: 'Impossible de retirer le fondateur de sa propre structure. Supprimer la structure depuis l\'onglet Structures.' }, { status: 400 });
        }
        // Trouver et supprimer le membership
        const memberSnap = await db.collection('structure_members')
          .where('userId', '==', userId)
          .where('structureId', '==', membershipStructureId)
          .get();
        if (memberSnap.empty) {
          return NextResponse.json({ error: 'Membre introuvable dans cette structure' }, { status: 404 });
        }
        const batch = db.batch();
        memberSnap.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        return NextResponse.json({ ok: true, message: 'Retiré de la structure' });
      }

      // ─── Supprimer le compte ────────────────────────────────────────────
      case 'delete': {
        // 1. Vérifier qu'il n'est pas fondateur d'une structure active
        const structuresSnap = await db.collection('structures')
          .where('founderId', '==', userId)
          .where('status', '==', 'active')
          .get();
        if (!structuresSnap.empty) {
          const names = structuresSnap.docs.map(d => d.data().name).join(', ');
          return NextResponse.json({
            error: `Impossible de supprimer : fondateur de structure(s) active(s) — ${names}. Supprimer ou transférer la structure d'abord.`
          }, { status: 400 });
        }

        // 2. Supprimer Firebase Auth EN PREMIER — si Firestore est supprimé d'abord
        // et que Auth échoue, on se retrouve avec un compte connectable sans profil.
        try {
          await authAdmin.deleteUser(userId);
        } catch (err) {
          const code = (err as { code?: string })?.code;
          if (code !== 'auth/user-not-found') {
            console.error('[API Admin/Users] deleteUser failed:', code, err);
            return NextResponse.json({ error: 'Impossible de supprimer le compte Auth' }, { status: 500 });
          }
        }

        // 3. Atomique : memberships + admin doc + profil Firestore
        const allMembers = await db.collection('structure_members').where('userId', '==', userId).get();
        const batch = db.batch();
        allMembers.docs.forEach(doc => batch.delete(doc.ref));
        batch.delete(db.collection('admins').doc(userId));
        batch.delete(userRef);
        await batch.commit();

        return NextResponse.json({ ok: true, message: 'Compte supprimé définitivement' });
      }

      default:
        return NextResponse.json({ error: `Action inconnue : ${action}` }, { status: 400 });
    }
  } catch (err) {
    captureApiError('API Admin/Users POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
