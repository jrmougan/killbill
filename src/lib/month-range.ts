/**
 * Calendar-month bounds in the app timezone (Europe/Madrid), as UTC instants.
 * Every "este mes" total (Inicio, Espacios, Mes) must use the same half-open
 * range [start, end) — no open upper bound, so future-dated expenses never leak
 * into the current month.
 */
import { APP_TZ } from "@/lib/home-format";

function tzOffsetMs(date: Date, timeZone: string): number {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(date);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Midnight of the given local Y/M/D in `timeZone`, as a UTC Date. */
function zonedMidnight(year: number, monthIndex: number, day: number, timeZone: string): Date {
    const guess = new Date(Date.UTC(year, monthIndex, day));
    const offset = tzOffsetMs(guess, timeZone);
    const candidate = new Date(guess.getTime() - offset);
    // Re-check across a DST change.
    const offset2 = tzOffsetMs(candidate, timeZone);
    return offset2 === offset ? candidate : new Date(guess.getTime() - offset2);
}

/** Local year + monthIndex (0-11) of `now` in `timeZone`. */
export function zonedYearMonth(now: Date, timeZone: string = APP_TZ): { year: number; monthIndex: number } {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric" }).formatToParts(now);
    return {
        year: Number(parts.find((p) => p.type === "year")?.value),
        monthIndex: Number(parts.find((p) => p.type === "month")?.value) - 1,
    };
}

/**
 * [start, end) of the month containing `now`, shifted by `offset` months
 * (-1 = previous month). Use as `{ gte: start, lt: end }` in Prisma.
 */
export function monthRange(now: Date = new Date(), offset = 0, timeZone: string = APP_TZ): { start: Date; end: Date } {
    const { year, monthIndex } = zonedYearMonth(now, timeZone);
    const m = monthIndex + offset;
    const y = year + Math.floor(m / 12);
    const mi = ((m % 12) + 12) % 12;
    return {
        start: zonedMidnight(y, mi, 1, timeZone),
        end: zonedMidnight(mi === 11 ? y + 1 : y, (mi + 1) % 12, 1, timeZone),
    };
}

/** Whole days left in the month of `now`, counting today (5 Oct → 27). */
export function daysLeftInMonth(now: Date = new Date(), timeZone: string = APP_TZ): number {
    const { end } = monthRange(now, 0, timeZone);
    const todayStart = zonedMidnight(
        ...((): [number, number, number] => {
            const p = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now);
            const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
            return [g("year"), g("month") - 1, g("day")];
        })(),
        timeZone,
    );
    return Math.round((end.getTime() - todayStart.getTime()) / 86_400_000);
}
