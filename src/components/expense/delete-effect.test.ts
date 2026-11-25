import { describe, expect, it } from "vitest";
import { deleteEffectLines } from "./delete-effect";

const alvaro = { id: "a", name: "Álvaro" };
const lucia = { id: "l", name: "Lucía" };
const split = (userId: string, name: string, amount: number) => ({ userId, name, amount });

describe("deleteEffectLines", () => {
    it("personal expense only changes the owner's books", () => {
        expect(deleteEffectLines({ viewerId: "a", payer: alvaro, splits: [], personal: true }))
            .toEqual(["Es un gasto personal: solo cambia tus cuentas."]);
    });

    it("viewer paid: each debtor stops owing them", () => {
        const lines = deleteEffectLines({
            viewerId: "a", payer: alvaro, personal: false,
            splits: [split("a", "Álvaro", 3210), split("l", "Lucía", 3210)],
        });
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(/^Lucía dejará de deberte 32,10\s€$/);
    });

    it("someone else paid: the viewer stops owing them", () => {
        const lines = deleteEffectLines({
            viewerId: "a", payer: lucia, personal: false,
            splits: [split("a", "Álvaro", 1500), split("l", "Lucía", 1500)],
        });
        expect(lines[0]).toMatch(/^Dejarás de deber 15,00\s€ a Lucía$/);
    });

    it("viewer not involved: their balance does not change", () => {
        const lines = deleteEffectLines({
            viewerId: "x", payer: lucia, personal: false,
            splits: [split("a", "Álvaro", 1000), split("m", "Marta", 500), split("l", "Lucía", 0)],
        });
        expect(lines[0]).toMatch(/^Tu saldo no cambia\. Lucía dejará de cobrar 15,00\s€$/);
    });

    it("collapses long debtor lists", () => {
        const lines = deleteEffectLines({
            viewerId: "a", payer: alvaro, personal: false,
            splits: [split("b", "B", 100), split("c", "C", 100), split("d", "D", 100), split("e", "E", 200)],
        });
        expect(lines).toHaveLength(3);
        expect(lines[2]).toMatch(/^2 personas más dejarán de deberte 3,00\s€ en total$/);
    });
});
