import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getActiveGroup, getMembership } from '@/lib/membership';
import { badRequest, forbidden, readJson, route, validate } from '@/lib/http';

/**
 * Optional `{ groupId }` — parsed defensively, as always: an empty, unparseable
 * or non-object body, or a non-string groupId, just falls back to the active group.
 */
const UnlinkBody = z
    .object({ groupId: z.string().optional().catch(undefined) })
    .nullish()
    .catch(undefined);

export const POST = route(
    {
        auth: 'user',
        errorMessage: 'No se pudo salir del espacio. Inténtalo de nuevo.',
        logLabel: 'Error unlinking couple:',
    },
    async ({ req, ctx }) => {
        const userId = ctx.userId;
        // F4 (multi-group): accept an optional { groupId } and leave THAT group.
        const raw = await readJson(req).catch(() => undefined);
        const bodyGroupId = validate(UnlinkBody, raw)?.groupId || null;

        // Resolve the target group. Explicit path: validate the caller has an
        // ACTIVE membership in it. Fallback path (no groupId): the active group,
        // whose resolver re-checks membership itself. Either way we never leave a
        // group the user isn't an ACTIVE member of.
        let coupleId: string | null;
        if (bodyGroupId) {
            const m = await getMembership(bodyGroupId, userId);
            if (!m || m.status !== 'ACTIVE') {
                throw forbidden('No perteneces a este grupo');
            }
            coupleId = bodyGroupId;
        } else {
            // Backward-compatible: resolve my group via the Membership layer.
            coupleId = await getActiveGroup(userId);
        }

        if (!coupleId) {
            throw badRequest('No estás en ningún grupo');
        }

        await prisma.$transaction(async (tx) => {
            // Phase 5 (WS1 write-stop): the soft-leave of the Membership is the sole
            // state change (User.coupleId is no longer written). Preserve history;
            // never hard-delete. If the couple is torn down below, its memberships
            // cascade-delete.
            await tx.membership.updateMany({
                where: { groupId: coupleId, userId },
                data: { status: 'LEFT', leftAt: new Date() }
            });

            // Count remaining ACTIVE members (post soft-leave, so the leaver is
            // already excluded) within the same transaction to avoid a race.
            const remainingMembers = await tx.membership.count({
                where: { groupId: coupleId, status: 'ACTIVE' }
            });

            if (remainingMembers === 0) {
                // Fase 1: the last member leaving no longer hard-deletes history.
                // If the space has any Expense/Settlement, ARCHIVE it (read-only
                // "recuerdo del viaje", indefinite retention). Only a completely
                // empty space is physically removed.
                const [expenseCount, settlementCount] = await Promise.all([
                    tx.expense.count({ where: { coupleId } }),
                    tx.settlement.count({ where: { coupleId } }),
                ]);
                const hasHistory = expenseCount > 0 || settlementCount > 0;

                if (hasHistory) {
                    await tx.couple.update({
                        where: { id: coupleId },
                        data: { status: 'ARCHIVED', archivedAt: new Date() },
                    });
                } else {
                    // Empty space: safe to remove entirely (in dependency order).
                    await tx.split.deleteMany({ where: { expense: { coupleId } } });
                    await tx.expense.deleteMany({ where: { coupleId } });
                    await tx.settlement.deleteMany({ where: { coupleId } });
                    await tx.couple.delete({ where: { id: coupleId } });
                }
            }
        });

        return NextResponse.json({ success: true });
    },
);
