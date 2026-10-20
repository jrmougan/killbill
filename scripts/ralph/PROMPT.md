# Ralph · iteración de UX/UI (Kill Bill · EQUIL)

Eres una iteración de un bucle Ralph. No recuerdas iteraciones anteriores: tu memoria son
`scripts/ralph/prd.json`, `scripts/ralph/progress.md`, `scripts/ralph/findings/` y el historial
de git. Haz **una sola historia** por iteración, déjala verificada y commiteada, y termina.

## 0. Contexto (lee antes de tocar nada)

1. `scripts/ralph/progress.md` — empieza por **Patrones del código**; luego las últimas entradas.
2. `scripts/ralph/prd.json` — el backlog.
3. `docs/design/README.md` — **decisiones de producto que mandan sobre el mockup**
   (sin códigos cortos de invitación, confirmación en dos pasos al liquidar, pasillos en las
   listas, el presupuesto pide importe, sin "Desconectar" MCP…).
4. `AGENTS.md` — convenciones del repo (importes en céntimos, colores inline por `hex`,
   mensajes de error de la API como contrato, nada de `getSession` en rutas…).

El diseño elegido es **"Mezcla · base 1a + espacios de 1b + ticket de 1c"** (opción 2a) y el
resto de pantallas en su estilo (3a). Fuente: `docs/design/EQUIL Rediseño.dc.html`
(HTML con estilos inline: úsalo para valores exactos de color, tamaño, radio y copy) y sus
renders `scripts/ralph/design/<id>.png`. Las rondas 1a/1b/1c y la app antigua (0a) están
descartadas: no las uses como referencia.

## 1. Elige la historia

La de menor `priority` con `"passes": false`. Si no queda ninguna, responde exactamente
`<promise>COMPLETE</promise>` y termina.

## 2. Captura el estado actual

```bash
SCREENS=<ids de la historia, separados por coma> mise run ux:capture
```

- Arranca su propio servidor Next y **resetea la BD de test**: no lances `mise run dev` a la vez.
- Para historias transversales (`"screens": ["*"]`) captura todo (`mise run ux:capture`).
- Si falla porque no hay BD: `mise run services:up && mise run db:migrate && mise run db:seed`
  (con `CONTAINER_ENGINE=podman` si no hay docker).

Por cada pantalla mira (Read sobre las imágenes):
`scripts/ralph/shots/<id>.png` (primer pantallazo), `<id>.full.png` (página entera),
`<id>.aria.yml` (árbol accesible) y `<id>.json` (errores de consola, desbordamientos,
`smallTargets` < 44px). Compáralo con `scripts/ralph/design/<design>.png`.

## 3. Detecta problemas

Revisa los `criteria` de la historia y además, siempre:

- **Fidelidad**: jerarquía, tipografía (Schibsted Grotesk), colores (#F6F6F3 fondo, #1B1C1A
  texto, verde #2F7D5B, rojo de deuda), radios, espaciado, iconos frente al mockup.
- **Usabilidad**: ¿se entiende qué hacer? ¿la acción principal es evidente? ¿hay estados de
  carga, error y vacío? ¿algo queda bajo la barra inferior o fuera de pantalla a 360×760?
- **Accesibilidad**: zonas táctiles ≥44px, contraste ≥4.5:1, `aria-label` en botones de solo
  icono, `<button>`/`<a>` reales, foco visible, encabezados con sentido.
- **Copy**: español natural, frases con nombre ("Lucía te debe…"), sin jerga técnica.

Escribe `scripts/ralph/findings/<ID>.md` (créalo o amplíalo) con una tabla:

| # | Severidad | Categoría | Pantalla | Problema | Evidencia | Estado |

Severidad: `alta` (bloquea o confunde la tarea, error visible, inaccesible), `media`
(se desvía claramente del diseño o molesta), `baja` (pulido). Estado: `corregido`,
`pendiente` o `fuera de alcance (motivo)`.

Los datos de captura vienen del escenario `ux-showcase` de `src/app/api/test/seed/route.ts`;
si un problema solo se ve con otros datos, puedes ampliar el escenario (solo esa ruta de test).

## 4. Corrige

- Corrige todas las `alta` y las `media` razonables de la historia. Las `baja`, si son baratas.
- **Solo UI**: componentes, estilos, copy y accesibilidad. No cambies el modelo de datos, las
  migraciones, los contratos de la API (formas de error, estados, mensajes) ni la lógica de
  `finance.ts`/`splits.ts`. Si arreglarlo lo exige, o contradice `docs/design/README.md`,
  márcalo `fuera de alcance` con el motivo y sigue.
- Sigue el estilo del código que tocas; reutiliza componentes de `src/components/ui/`.
  Colores dinámicos inline (nunca clases tailwind construidas en runtime). Sin dependencias nuevas.
- Si cambias un `data-testid` o un texto que usan los e2e (`grep -rn` en `e2e/`), actualiza el spec.

## 5. Verifica (obligatorio antes de commitear)

1. Vuelve a capturar las mismas pantallas y confirma visualmente cada corrección.
2. `mise run check` debe pasar (lint + typecheck + unit).
3. Si tocaste algo cubierto por e2e, ejecuta esos specs:
   `mise run e2e -- e2e/<carpeta>/<spec> --project=mobile-chrome`.
   Para cambios de layout ejecuta también `e2e/mobile/overflow.spec.ts`.

Si algo no pasa y no sabes arreglarlo en esta iteración, revierte lo que lo rompe, deja la
historia en `"passes": false` con la explicación en `notes` y documenta el bloqueo en
`progress.md`.

## 6. Cierra la iteración

1. En `prd.json`: `"passes": true` y en `notes` un resumen de una línea (qué se corrigió, qué
   queda pendiente).
2. Añade al final de `progress.md`:

   ```
   ## <fecha> · <ID> <título>
   - Corregido: …
   - Pendiente / fuera de alcance: …
   - Ficheros: …
   - Aprendizajes: … (trucos del repo útiles para las siguientes iteraciones)
   ```

   Si descubres un patrón general del código, añádelo a **Patrones del código** arriba.
3. Commit único con todo (código, findings, prd.json, progress.md):
   `fix(ux): <ID> <resumen corto en español>`. No hagas push.
4. Termina. Si era la última historia, responde `<promise>COMPLETE</promise>`.
