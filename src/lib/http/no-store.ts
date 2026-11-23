import type { RouteContext } from "./route";

type Handler = (req: Request, context?: RouteContext) => Promise<Response>;

/**
 * Marks every answer of a handler `Cache-Control: no-store`. Applied around
 * route() so error responses are covered too.
 */
export const noStore =
    (handler: Handler): Handler =>
    async (req, context) => {
        const res = await handler(req, context);
        res.headers.set("Cache-Control", "no-store");
        return res;
    };
