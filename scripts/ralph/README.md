# Ralph · bucle de correcciones UX/UI

Bucle [Ralph](https://ghuntley.com/ralph/) que audita la app contra el diseño elegido
— **Mezcla · base 1a + espacios de 1b + ticket de 1c** (2a) y el resto de pantallas en su
estilo (3a), en `docs/design/EQUIL Rediseño.dc.html` — y corrige los problemas de UX/UI de una
historia por iteración. Cada iteración es un agente nuevo con el mismo `PROMPT.md`; el estado
vive en ficheros y en git.

| Fichero | Para qué |
| --- | --- |
| `PROMPT.md` | Instrucciones de cada iteración (elegir → capturar → detectar → corregir → verificar → commit) |
| `prd.json` | Backlog: una historia por pantalla + dos transversales, con criterios y `passes` |
| `progress.md` | Patrones del código y registro de iteraciones (memoria entre agentes) |
| `findings/<ID>.md` | Problemas detectados por historia, con severidad y estado |
| `design/*.png` | Renders de los mockups elegidos (`mise run ux:design`) |
| `capture.spec.ts` | Capturas de la app a 360×760 + árbol accesible + informe de tacto/desbordes |
| `shots/`, `logs/` | Salida de capturas y de cada iteración (ignorados por git) |

## Uso

```bash
mise run setup && mise run services:up && mise run db:migrate && mise run db:seed
mise run ux:capture              # opcional: ver el estado actual (SCREENS=inicio,listas para filtrar)
mise run ralph -- 5              # hasta 5 iteraciones (una historia cada una)
```

- No ejecutes `mise run dev` mientras corre: las capturas arrancan su propio Next y resetean la BD.
- Otro agente: `RALPH_AGENT='codex exec --full-auto' mise run ralph -- 3`.
- Cada iteración deja un commit `fix(ux): <ID> …`; revisa con `git log` y `findings/`.
- Para reabrir una historia, pon su `passes` a `false` (y añade criterios si hace falta).
