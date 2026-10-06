/**
 * `route()` — thin typed wrapper for App Router route handlers.
 *
 * It centralizes, in this order: session auth → params → query → body → your
 * handler → error mapping (toErrorResponse). Space-scoped authorization stays
 * EXPLICIT in the handler (`requireSpace` / `requireSpaceAccess`): the wrapper
 * only knows who the caller is, never which space a resource belongs to.
 *
 *   export const POST = route({ auth: 'user', body: CreateSchema, errorMessage: 'Error al crear X' },
 *       async ({ ctx, body, params }) => { ...; return NextResponse.json({ success: true }); });
 */
import type { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionCtx, type SessionCtx } from "@/lib/authz";
import { HttpError, toErrorResponse } from "./errors";
import { parseJson, parseQuery, validate } from "./parse";

/**
 * - `public`        no session required (ctx may be null).
 * - `user`          a registered session (browser or MCP token); guests → 403.
 * - `user-or-guest` any revalidated session, guests included (cage them yourself
 *                   with requireSpace(..., { allowGuest: true }) or ctx.groupId).
 * - `admin`         a regular browser session (not guest, not MCP) whose User row
 *                   has isAdmin=true (read from the DB, never from the JWT).
 */
export type AuthMode = "public" | "user" | "user-or-guest" | "admin";

type Schema = z.ZodType;
type Out<S> = S extends Schema ? z.output<S> : undefined;
type CtxFor<A extends AuthMode> = A extends "public" ? SessionCtx | null : SessionCtx;

export type RouteOptions<A extends AuthMode, B, Q, P> = {
    auth: A;
    /** JSON body schema. Parsed BEFORE the handler: keep it context-free (shape/type checks only). */
    body?: B;
    /** Query-string schema (values are strings). */
    query?: Q;
    /** Dynamic segment schema (e.g. z.object({ id: idSchema })). Without it params are untyped strings. */
    params?: P;
    /** Body message of an unexpected 500 (the route's historical one). */
    errorMessage?: string;
    /** console.error label of an unexpected 500. */
    logLabel?: string;
    /** 401 message (default "No autorizado"; some legacy routes say "Unauthorized"). */
    unauthorizedMessage?: string;
    /** 403 message for a guest hitting an `auth: 'user'` route (default "Acción no permitida para invitados"). */
    guestMessage?: string;
};

export type RouteArgs<A extends AuthMode, B, Q, P> = {
    req: Request;
    ctx: CtxFor<A>;
    body: Out<B>;
    query: Out<Q>;
    params: P extends Schema ? z.output<P> : Record<string, string>;
};

/** Next 16 route-handler context: `params` is a Promise (absent in direct unit-test calls). */
export type RouteContext = { params: Promise<Record<string, string | string[] | undefined>> };

export const GUEST_FORBIDDEN_MESSAGE = "Acción no permitida para invitados";

async function authenticate(mode: AuthMode, unauthorizedMessage: string, guestMessage: string): Promise<SessionCtx | null> {
    if (mode === "public") return getSessionCtx();
    const ctx = await getSessionCtx();
    if (!ctx?.userId) throw new HttpError(401, unauthorizedMessage);
    if (mode === "user" && ctx.kind === "guest") throw new HttpError(403, guestMessage);
    if (mode === "admin") {
        // Only a regular browser session administers: not a guest, not an MCP token.
        if (ctx.kind !== undefined) throw new HttpError(401, unauthorizedMessage);
        const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { isAdmin: true } });
        if (!user) throw new HttpError(401, unauthorizedMessage);
        if (!user.isAdmin) throw new HttpError(403, "Acceso denegado");
    }
    return ctx;
}

export function route<
    A extends AuthMode,
    B extends Schema | undefined = undefined,
    Q extends Schema | undefined = undefined,
    P extends Schema | undefined = undefined,
>(
    options: RouteOptions<A, B, Q, P>,
    handler: (args: RouteArgs<A, B, Q, P>) => Promise<Response> | Response,
) {
    return async function routeHandler(req: Request, context?: RouteContext): Promise<Response> {
        try {
            const ctx = await authenticate(
                options.auth,
                options.unauthorizedMessage ?? "No autorizado",
                options.guestMessage ?? GUEST_FORBIDDEN_MESSAGE,
            );
            const rawParams = (await context?.params) ?? {};
            const params = options.params ? validate(options.params, rawParams) : rawParams;
            const query = options.query ? parseQuery(req, options.query) : undefined;
            const body = options.body ? await parseJson(req, options.body) : undefined;
            return await handler({ req, ctx, body, query, params } as RouteArgs<A, B, Q, P>);
        } catch (e) {
            return toErrorResponse(e, { fallbackMessage: options.errorMessage, logLabel: options.logLabel });
        }
    };
}
