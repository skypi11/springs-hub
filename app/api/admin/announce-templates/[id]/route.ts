// PATCH (édition) + DELETE (suppression) d'une template d'annonce.

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { captureApiError } from '@/lib/sentry';
import { clampString } from '@/lib/validation';

async function requireAdmin(req: NextRequest): Promise<string | NextResponse> {
  const uid = await verifyAuth(req);
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = getAdminDb();
  const adminSnap = await db.collection('aedral_admins').doc(uid).get();
  if (!adminSnap.exists) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return uid;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, auth));
  if (blocked) return blocked;

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  try {
    const body = await req.json();
    const updates: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (typeof body.label === 'string') updates.label = clampString(body.label, 100).trim();
    if (typeof body.title === 'string') updates.title = clampString(body.title, 256);
    if (typeof body.description === 'string') updates.description = clampString(body.description, 4000);
    if (typeof body.color === 'number' && body.color >= 0 && body.color <= 0xFFFFFF) {
      updates.color = Math.floor(body.color);
    }
    if (typeof body.defaultChannelHint === 'string' || body.defaultChannelHint === null) {
      updates.defaultChannelHint = body.defaultChannelHint
        ? clampString(body.defaultChannelHint, 60).trim()
        : null;
    }
    // Marqueur d'utilisation — utile pour tri "récent"
    if (body.markUsed === true) {
      updates.lastUsedAt = FieldValue.serverTimestamp();
    }

    const db = getAdminDb();
    await db.collection('announce_templates').doc(id).update(updates);

    return NextResponse.json({ ok: true });
  } catch (err) {
    captureApiError('AnnounceTemplates PATCH error', err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, auth));
  if (blocked) return blocked;

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  try {
    const db = getAdminDb();
    await db.collection('announce_templates').doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    captureApiError('AnnounceTemplates DELETE error', err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
