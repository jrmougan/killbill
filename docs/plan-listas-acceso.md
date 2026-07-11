# Plan de implementación — Hacer las listas de la compra más accesibles en Kill Bill

## 1. Problema

Hoy la ruta `/lists` (Listas de la compra) está profundamente enterrada. Solo se alcanza por dos caminos, ambos de 3+ toques:

1. **Ajustes** (4º tab de la bottom-nav) → scroll hasta la sección **Herramientas** → fila **Listas de la compra**.
2. **Ajustes** → **Mis grupos** → **Gestionar →** un espacio (`/spaces/[id]`) → sección **Listas** → **Listas de la compra**.

No hay ningún acceso a `/lists` desde el **dashboard**, ni en el **header**, ni en el **FAB**, ni en la **bottom-nav**. El grep de `/lists` sobre `src/**/*.tsx` solo aparece en `settings-client.tsx`, `spaces/[id]/page.tsx` y los propios ficheros de la feature.

**Por qué importa:**
- El acceso principal (Ajustes → Herramientas) está **envuelto en `{groups.length > 0 && ...}`** (`settings-client.tsx` L343), así que un usuario **sin grupo NO ve la entrada en absoluto** — punto ciego real.
- Es la superficie menos visible de una app mobile-first: la home (`/dashboard`) no lleva a las listas pese a ser la pantalla de aterrizaje.
- La bottom-nav **no se renderiza dentro de `/lists`** (no es `TAB_ROUTE`, `bottom-nav.tsx` L27/L32), así que una vez dentro tampoco hay navegación coherente.

## 2. Opciones evaluadas

| # | Opción | Dónde | Pros | Cons | Esfuerzo |
|---|--------|-------|------|------|----------|
| 1 | **5º tab "Listas"** | `bottom-nav.tsx` (array `TABS`) | 1 toque siempre visible; descubribilidad máxima; ~3 líneas | Rompe grid de 4 → targets ~20% más estrechos; contradice el veto "no 5º tab"; sube planificación (no genera gasto) al nivel de Balance/Presupuestos/Análisis; agota el margen del tab bar | Bajo |
| 2 | **Swap de tab** (degradar Presupuestos, entra Listas; siguen 4 tabs) | `bottom-nav.tsx` + `settings-client.tsx` | 1 toque sin romper grid de 4; Presupuestos **ya tiene hogar** en Herramientas (L351) → quita redundancia | Reordena el énfasis del producto (planificación por delante de finanzas); coste de reaprendizaje; alertas de presupuesto deben seguir enlazando a `/budget` | Bajo |
| 3 | **Atajo en el dashboard** (fila quick-actions) | `dashboard/page.tsx` | 1 toque desde la home; `<Link>` estático en Server Component; puede mostrarse aunque `groups.length===0`; no toca nav/FAB/header | No persistente (se pierde al hacer scroll, no existe fuera de la home); añade densidad vertical | Bajo |
| 4 | **Híbrido** (icono en header + tarjeta en dashboard + entrada del espacio destacada) | `dashboard/page.tsx` + `spaces/[id]/page.tsx` | Cubre buscador y escaneador; arregla el punto ciego `groups.length===0`; sin FAB cliente | Dos entradas nuevas pueden leerse redundantes; el header aprieta el SpaceSwitcher en pantallas estrechas; más superficie que condicionar a `!isGuest` | Bajo |

### Mockups ASCII

**Opción 1 — 5º tab (antes/después):**
```
ANTES (4 tabs, 1/4)              DESPUES (5 tabs, 1/5 -> ~20% mas estrechos)
┌─────┬─────┬─────┬─────┐        ┌─────┬─────┬─────┬─────┬─────┐
│ 🏠  │ 🐷  │ 📊  │ ⚙️  │        │ 🏠  │ 🐷  │ 📊  │ 🛒  │ ⚙️  │
│Inic.│Pres.│Anál.│Ajus.│        │Inic.│Pres.│Anál.│List.│Ajus.│
└─────┴─────┴─────┴─────┘        └─────┴─────┴─────┴─────┴─────┘
```

**Opción 2 — swap (mantiene 4 tabs):**
```
ANTES                             DESPUES
│ 🏠   🐷    📊    ⚙️ │           │ 🏠   🛒    📊    ⚙️ │
│Inic Presu Anál Ajus│  ───►      │Inic List. Anál Ajus│
   (Presupuestos baja a Ajustes -> Herramientas, donde YA existe)
```

**Opción 3 — atajo en dashboard:**
```
┌──────────────────────────────┐
│ [🏠 Casa ▾]            (JR)   │  header sin cambios
│  ┌────────────────────────┐  │
│  │      Tu balance +38,50€│  │
│  └────────────────────────┘  │
│  [    Liquidar deuda    ]    │
│  ┌────────────────────────┐  │  <- NUEVO atajo (Link a /lists)
│  │ 🛒 Listas de la compra›│  │
│  └────────────────────────┘  │
│  Resumen del mes ...         │
│  Recientes ...               │
│                       ( + )  │  FAB sin cambios -> /expenses/new
├──────────────────────────────┤
│ Inicio Presup. Análisis Ajus │  bottom-nav 4 tabs sin cambios
└──────────────────────────────┘
```

**Opción 4 — híbrido:**
```
│ [Casa v]                [🛒]  (JR)│  <- icono nuevo en header
│  Accesos rapidos                  │
│  ┌──────────────────────────────┐ │  <- tarjeta atajo
│  │ 🛒 Listas de la compra     > │ │
│  └──────────────────────────────┘ │
   + /spaces/[id] seccion "Listas" solo destacada (0 codigo nuevo)
```

## 3. Recomendación

**Opción 3 (atajo en el dashboard) como primera iteración + destacar la entrada YA existente del menú del espacio (`/spaces/[id]`).** Es el subconjunto seguro del híbrido, sin su parte discutible (el icono en el header se deja para 2ª iteración).

**Por qué:** el objetivo es **descubribilidad**, no gastar chrome permanente. El dashboard es la pantalla de aterrizaje: un atajo allí lleva `/lists` de 3+ toques a **1 toque** y resuelve el punto ciego (hoy la entrada de Herramientas está oculta tras `groups.length > 0`). Frente a las opciones de barra: el 5º tab sacrifica ergonomía mobile-first y contradice el veto explícito; el swap abre un debate de producto (degradar Presupuestos, función nuclear) que excede un cambio de accesibilidad. La opción 3 es **un solo fichero**, Server Component sin `'use client'`, sin tocar nav/FAB/header/`TAB_ROUTES`, riesgo nulo sobre la lógica financiera.

**Mockup final:**
```
DASHBOARD (/dashboard)                        MENU DEL ESPACIO (/spaces/[id])
┌──────────────────────────────┐             ┌──────────────────────────────┐
│ [🏠 Casa ▾]            (JR)   │             │  LISTAS                      │
│  ┌────────────────────────┐  │             │  ┌────────────────────────┐  │
│  │   Tu balance  +38,50 € │  │             │  │ 🛒 Listas de la compra›│  │ <- subida de
│  └────────────────────────┘  │             │  └────────────────────────┘  │    orden + acento
│  [    Liquidar deuda    ]    │             └──────────────────────────────┘
│  Accesos rápidos             │  <- h3 discreto
│  ┌────────────────────────┐  │
│  │ 🛒 Listas de la compra›│  │  <- <Link href="/lists">, !isGuest
│  │    Planifica tu compra │  │
│  └────────────────────────┘  │
│  Resumen del mes ...         │
│  Recientes ...               │
│                       ( + )  │  FAB intacto
├──────────────────────────────┤
│ Inicio Presup. Análisis Ajus │  4 tabs intactos
└──────────────────────────────┘
```

## 4. Plan de implementación

### 4.1 Dashboard — atajo (cambio principal)

**Fichero:** `/Users/jeromo/Dev/killbill/src/app/dashboard/page.tsx` (React Server Component, sin `'use client'`).

- Añadir una nueva `<section>` **entre "Resumen del mes"** (`<h2>` en L361) **y el bloque "Recientes"** (`justify-between` en L457), reutilizando el patrón de tarjeta ya presente: `bg-card border border-[color:var(--line)] rounded-xl hover:bg-secondary`.
- Contenido: un `<Link href="/lists">` con icono `ShoppingCart` (de `lucide-react`, ya usado en `settings-client.tsx` y `spaces/[id]/page.tsx`) + `ChevronRight`. ~8-15 líneas JSX. No requiere estado ni imports nuevos más allá de los iconos.
- **Visibilidad / guest:** condicionar la sección a `!isGuest` (el flag ya existe, L45: `const isGuest = session.kind === "guest"`). El proxy veta `/budget`/`/analytics`/`/settings` a guest; las listas no deben aparecerle salvo decisión explícita.
- **Scope / espacio no operativo:** el dashboard ya calcula `scope` (L60) y `spaceOperative` (L91). Decisión de producto (ver §5): recomendado **mostrar el atajo siempre para no-guest** (incluida la lente `personal` y espacios no operativos) — las listas son planificación y no dependen de que el espacio tenga 2º miembro, a diferencia del FAB de gasto (L579). No heredar la lógica `spaceOperative || scope === "personal"` del FAB.

### 4.2 Menú del espacio — destacar entrada existente

**Fichero:** `/Users/jeromo/Dev/killbill/src/app/spaces/[id]/page.tsx`.

- La sección **"Listas"** ya existe (L92-102): `<h2>Listas</h2>` + `<Link href="/lists">` con `ShoppingCart` + `ChevronRight`. **~0 líneas de lógica nueva**: solo reordenar/estilar para darle acento (p. ej. subirla por encima de "Invitaciones", o añadir un fondo/acento primary). No romper nada.

### 4.3 Bottom-nav — NO se toca (en esta iteración)

**Fichero:** `/Users/jeromo/Dev/killbill/src/components/nav/bottom-nav.tsx`. Se mantienen los 4 tabs (`TABS`, L8-13) y `GUEST_TABS` (L19-22) intactos. Se respeta el veto "no 5º tab". Nota: al no promover `/lists` a tab route, la bottom-nav **seguirá sin mostrarse dentro de `/lists`** (`TAB_ROUTES`, L27) — comportamiento idéntico al de hoy; se asume conscientemente.

### 4.4 Opcional (limpieza, no bloqueante)

- La fila redundante `<Link href="/lists">` de **Ajustes → Herramientas** (`settings-client.tsx` ~L363-366) puede **mantenerse** como acceso secundario, o dejarse tal cual. No se elimina, porque el atajo del dashboard no la sustituye para usuarios que ya la conocen. (Solo se eliminaría en la opción 2, que no se implementa aquí.)

### 4.5 Variante guest y estados

- **Guest:** el atajo del dashboard va condicionado a `!isGuest`; `GUEST_TABS` no se toca. Guest no gana acceso a `/lists`.
- **Estados de espacio (SETTLING / ARCHIVED / no operativo):** las listas de la compra son planificación, **independientes del ciclo de liquidación de gastos**; el atajo se muestra igual. Si la feature `/lists` ya gestiona internamente el estado del espacio (p. ej. lista solo-lectura en espacios archivados), ese comportamiento vive dentro de la propia feature y queda fuera del alcance de este cambio de accesibilidad. No se añade lógica de estado en el atajo.

### Criterio de "hecho"

- Desde `/dashboard` (sesión normal, con o sin grupo) hay un atajo visible a `/lists` a **1 toque**, sin scroll a Ajustes.
- El atajo **no aparece** para sesiones guest.
- En `/spaces/[id]` la entrada "Listas" queda visualmente destacada.
- `npm run lint` y `npx vitest run` pasan (el cambio no toca `finance.ts`/`splits.ts` ni lógica financiera; no hay migraciones).
- Sin regresiones en bottom-nav (sigue con 4 tabs), FAB (`/expenses/new`) ni header.

## 5. Decisiones abiertas (para el dueño)

1. **¿5 tabs en la bottom-nav?** Asumir el coste ergonómico (~20% menos ancho por target) y revertir el veto "no 5º tab". Si es **no**, quedan descartadas las opciones de barra. *(Recomendación: no.)*
2. **¿Degradar Presupuestos (o Análisis) fuera de la barra** para meter Listas manteniendo 4 tabs (opción 2)? Cambia el énfasis del producto (planificación por delante de finanzas). *(Recomendación: no, por ahora.)*
3. **¿Las listas deben ser accesibles para usuarios SIN grupo (`groups.length === 0`) y en la lente `personal`?** *(Recomendación: sí — es precisamente el punto ciego que se quiere arreglar.)*
4. **¿Comportamiento en espacios no operativos** (couple esperando 2º miembro) y para **guest**? *(Recomendación: ocultar a guest; mostrar siempre a no-guest, sin heredar el `disabled` del FAB.)*
5. **¿Posición exacta del atajo:** bajo "Resumen del mes" o sobre "Recientes"? *(Recomendación: entre ambos, sobre "Recientes".)*
6. **¿Presencia persistente futura** en todas las pantallas? Si el atajo del dashboard no basta (según telemetría), elegir entre **icono en el header** (3ª pata del híbrido) o reabrir el debate de la barra. Conviene decidir el techo antes de invertir.
7. **¿Alertas/enlaces que hoy apuntan a Presupuestos** que habría que preservar si algún día se saca `/budget` de la nav? (Solo relevante si se toma la opción 2.)

---

**Ficheros a tocar (opción recomendada):**
- `/Users/jeromo/Dev/killbill/src/app/dashboard/page.tsx` — nueva `<section>` con `<Link href="/lists">` (~8-15 líneas, condicionada a `!isGuest`, entre L361 y L457).
- `/Users/jeromo/Dev/killbill/src/app/spaces/[id]/page.tsx` — reordenar/estilar la sección "Listas" ya existente (L92-102), ~0 líneas de lógica.

**No se tocan:** `src/components/nav/bottom-nav.tsx`, el FAB ni el header del dashboard, ni `TAB_ROUTES`. Sin migraciones, sin estado, sin `'use client'`.