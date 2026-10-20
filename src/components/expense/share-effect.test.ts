import { describe, expect, it } from "vitest";
import { editEffectLine, promoteEffectLines } from "./share-effect";

const a = { id: "a", name: "Álvaro" };
const l = { id: "l", name: "Lucía" };

describe("promoteEffectLines", () => {
    it("viewer paid: the partner will owe their default share", () => {
        const lines = promoteEffectLines({ viewerId: "a", payerId: "a", members: [a, l], shares: { a: 2500, l: 2500 } });
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(/^Lucía pasará a deberte 25,00\s€$/);
    });

    it("collapses long groups after two names", () => {
        const members = [a, l, { id: "m", name: "Marta" }, { id: "s", name: "Sergio" }, { id: "p", name: "Pablo" }];
        const shares = Object.fromEntries(members.map((m) => [m.id, 1000]));
        const lines = promoteEffectLines({ viewerId: "a", payerId: "a", members, shares });
        expect(lines).toHaveLength(3);
        expect(lines[2]).toMatch(/^2 personas más pasarán a deberte 20,00\s€ en total$/);
    });

    it("someone else paid: the viewer will owe them", () => {
        const lines = promoteEffectLines({ viewerId: "a", payerId: "l", members: [a, l], shares: { a: 1500, l: 1500 } });
        expect(lines[0]).toMatch(/^Pasarás a deber 15,00\s€ a Lucía$/);
    });

    it("no debt when the payer keeps the whole share", () => {
        expect(promoteEffectLines({ viewerId: "a", payerId: "a", members: [a, l], shares: { a: 3000, l: 0 } }))
            .toEqual(["No cambia ningún saldo: el gasto entero es de quien lo pagó."]);
    });
});

describe("editEffectLine", () => {
    it("is null when the viewer's balance does not move", () => {
        expect(editEffectLine({ beforeCents: 1000, afterCents: 1000, partnerName: "Lucía" })).toBeNull();
    });

    it("names the partner and the direction", () => {
        expect(editEffectLine({ beforeCents: 1000, afterCents: 1500, partnerName: "Lucía" }))
            .toMatch(/^Al guardar, el saldo con Lucía cambia en 5,00\s€ a tu favor\. Si ya saldasteis, puede volver a quedar deuda\.$/);
        expect(editEffectLine({ beforeCents: 1000, afterCents: -500, partnerName: null }))
            .toMatch(/^Al guardar, el saldo con el grupo cambia en 15,00\s€ en tu contra\./);
    });
});
