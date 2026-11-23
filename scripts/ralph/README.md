# Ralph · bucle de correcciones UX/UI

**Estado: terminado (48/48, 2026-10-20, PR #43).** `mise run ralph` sale sin hacer nada hasta que haya
historias con `passes: false`. `ux:capture` y `ux:design` siguen siendo útiles por separado. Lo no
corregido está en `findings/` (estado `pendiente`). Pantallas posteriores al bucle, como `/admin/ai`, no
están auditadas ni en `capture.spec.ts`.

Bucle [Ralph](https://ghuntley.com/ralph/) que audita la app contra el diseño elegido
— **Mezcla · base 1a + espacios de 1b + ticket de 1c** (2a) y el resto de pantallas en su
estilo (3a), en `docs/design/EQUIL Rediseño.dc.html` — y corrige los problemas de UX/UI de una
historia por iteración. Cada iteración es un agente nuevo con el mismo `PROMPT.md`; el estado
vive en ficheros y en git.

| Fichero | Para qué |
| --- | --- |
| `PROMPT.md` | Instrucciones de cada iteración (elegir → capturar → detectar → corregir → verificar → commit) |
| `prd.json` | Backlog: UX-* (auditoría por pantalla), CF-* (acciones críticas y vocabulario, ver `docs/ux/plan-acciones-criticas.md`) y RV-* (hallazgos de revisión), con criterios y `passes` |
| `progress.md` | Patrones del código y registro de iteraciones (memoria entre agentes) |
| `findings/<ID>.md` | Problemas detectados por historia, con severidad y estado |
| `design/*.png` | Renders de los mockups elegidos (`mise run ux:design`) |
| `capture.spec.ts` | Capturas de la app a 360×760 + árbol accesible + informe de tacto/desbordes |
| `render-design.mjs` | Renderiza los mockups a `design/*.png` (lo usa `mise run ux:design`) |
| `playwright.ux.config.ts` | Configuración de Playwright de `mise run ux:capture` |
| `shots/`, `logs/` | Salida de capturas y de cada iteración (ignorados por git) |

## Uso

```bash
mise run setup && mise run services:up && mise run db:migrate && mise run db:seed
mise run ux:capture              # opcional: ver el estado actual (SCREENS=inicio,listas para filtrar)
mise run ralph -- 5              # hasta 5 iteraciones (una historia cada una)
```

- No ejecutes `mise run dev` mientras corre: las capturas arrancan su propio Next y **borran la BD
  configurada en `.env`** (no hay BD de test aparte).
- Otro agente: se elige con `RALPH_AGENT`. El ejemplo con `codex exec --full-auto` del comentario de
  `ralph.sh` ya no sirve: esa opción no existe en codex-cli 0.166.0, y `ralph.sh` traga el error
  (`|| true`), así que cada iteración fallaría sin hacer nada. Si se reabre el bucle con Codex, prueba
  antes una iteración con `--sandbox workspace-write`: el bucle debe commitear, llegar a MySQL y abrir
  un puerto.
- Cada iteración deja un commit `fix(ux): <ID> …`; revisa con `git log` y `findings/`.
- Para reabrir una historia, pon su `passes` a `false` (y añade criterios si hace falta).
