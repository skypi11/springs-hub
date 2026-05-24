// CRUD admin pour les templates d'annonces Discord.
// Collection Firestore : `announce_templates`
// Sécurité : verifyAuth + check `admins`, Admin SDK pour bypass rules.

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { captureApiError } from '@/lib/sentry';
import { clampString } from '@/lib/validation';
import type { AnnounceTemplate } from '@/types';

async function requireAdmin(req: NextRequest): Promise<string | NextResponse> {
  const uid = await verifyAuth(req);
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = getAdminDb();
  const adminSnap = await db.collection('aedral_admins').doc(uid).get();
  if (!adminSnap.exists) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return uid;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `template-${Date.now()}`;
}

// GET : liste toutes les templates
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const blocked = await checkRateLimit(limiters.read, rateLimitKey(req, auth));
  if (blocked) return blocked;

  try {
    const db = getAdminDb();
    // Hard cap 200 templates — un admin n'aura jamais besoin de plus, et ça
    // évite un scan runaway si quelqu'un spam la collection.
    const snap = await db.collection('announce_templates').orderBy('updatedAt', 'desc').limit(200).get();
    const templates: AnnounceTemplate[] = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        key: data.key ?? d.id,
        label: data.label ?? '(sans nom)',
        title: data.title ?? '',
        description: data.description ?? '',
        color: typeof data.color === 'number' ? data.color : 0xFFB800,
        defaultChannelHint: data.defaultChannelHint,
        createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? null,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? null,
        createdBy: data.createdBy ?? null,
        lastUsedAt: data.lastUsedAt?.toDate?.()?.toISOString?.() ?? null,
      };
    });
    return NextResponse.json({ templates });
  } catch (err) {
    captureApiError('AnnounceTemplates GET error', err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

// POST : crée une nouvelle template
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, auth));
  if (blocked) return blocked;

  try {
    const body = await req.json();
    const label = clampString(body.label ?? '', 100).trim();
    const title = clampString(body.title ?? '', 256);
    const description = clampString(body.description ?? '', 4000);
    const color = typeof body.color === 'number' && body.color >= 0 && body.color <= 0xFFFFFF
      ? Math.floor(body.color)
      : 0xFFB800;
    const defaultChannelHint = body.defaultChannelHint
      ? clampString(body.defaultChannelHint, 60).trim()
      : null;

    if (!label) return NextResponse.json({ error: 'label requis' }, { status: 400 });
    if (!description.trim()) return NextResponse.json({ error: 'description requise' }, { status: 400 });

    const key = body.key ? slugify(String(body.key)) : slugify(label);

    const db = getAdminDb();
    const docRef = await db.collection('announce_templates').add({
      key,
      label,
      title,
      description,
      color,
      defaultChannelHint,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: auth,
    });

    return NextResponse.json({ ok: true, id: docRef.id });
  } catch (err) {
    captureApiError('AnnounceTemplates POST error', err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
