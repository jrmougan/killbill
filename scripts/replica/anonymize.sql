-- Anonimización de la réplica local de producción (scripts/replica/db-replica.sh).
-- Se aplica a la BD local recién cargada, NUNCA a producción. Idempotente y
-- determinista: los números salen de ROW_NUMBER() sobre (createdAt, id), que no
-- cambian al repetirla. Conserva importes, fechas, repartos y ledger (la réplica
-- sirve para eso); sustituye todo texto que pueda identificar a personas,
-- comercios o lugares. verify.sql comprueba el resultado y aborta si queda algo.
--
-- Login de desarrollo: admin@example.invalid / password (PIN 1234). El resto de
-- cuentas: user-<id>@example.invalid / password.
-- Hashes bcrypt (coste 10) fijos de 'password' y '1234'; verify.sql los compara.

-- Las tablas de Prisma usan utf8mb4_unicode_ci; literales y variables, también.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET @dev_password = '$2b$10$EJD3v1vNJhjebAUKv5eUY.hoKEhP1dmTbCdJNX.MtOHiXTDllwou2';
SET @dev_pin      = '$2b$10$XM4DUzDvJnj1uJg6wXhGVudbSwu2fBFSOPXtho0gvKq9.DXenzhpq';

-- Usuarios. El primer admin (o el primer usuario, si no hay admin) es el login de
-- desarrollo. Invitados: email/password siguen NULL (modelo de invitado sombra).
-- tokenVersion se pone a 0: los JWT se firman con el JWT_SECRET local, distinto.
UPDATE `User` u
JOIN (
  SELECT id, ROW_NUMBER() OVER (ORDER BY isAdmin DESC, createdAt, id) AS dev_rank,
             ROW_NUMBER() OVER (ORDER BY createdAt, id) AS n
  FROM `User`
) r ON r.id = u.id
SET u.name     = IF(r.dev_rank = 1, 'Admin', CONCAT(IF(u.isGuest, 'Invitado ', 'Usuario '), r.n)),
    u.email    = CASE WHEN r.dev_rank = 1 THEN 'admin@example.invalid'
                      WHEN u.email IS NULL THEN NULL
                      ELSE CONCAT('user-', u.id, '@example.invalid') END,
    u.password = IF(u.password IS NULL AND r.dev_rank <> 1, NULL, @dev_password),
    u.pin      = IF(u.pin IS NULL AND r.dev_rank <> 1, NULL, @dev_pin),
    -- El avatar es un emoji; una ruta o URL apuntaría a una subida real.
    u.avatar   = IF(u.avatar REGEXP '[/.:]', NULL, u.avatar),
    u.isAdmin  = IF(r.dev_rank = 1, TRUE, u.isAdmin),
    u.tokenVersion = 0;

-- Espacios: nombre y código de invitación.
UPDATE `Couple` c
JOIN (SELECT id, ROW_NUMBER() OVER (ORDER BY createdAt, id) AS n FROM `Couple`) r ON r.id = c.id
SET c.name = IF(c.name IS NULL, NULL, CONCAT('Espacio ', r.n)),
    c.code = UPPER(LEFT(SHA2(CONCAT('killbill-replica:', c.id), 256), 12));

-- Invitaciones y enlaces de recuperación de invitados: son credenciales.
DELETE FROM `GroupInvite`;
DELETE FROM `InviteCode`;
UPDATE `Membership` SET guestTokenHash = NULL WHERE guestTokenHash IS NOT NULL;

-- Claves de API de los proveedores de IA (precedencia BD > env): fuera.
UPDATE `AiProviderConfig` SET encryptedApiKey = NULL WHERE encryptedApiKey IS NOT NULL;

-- Categorías propias (las de sistema son el catálogo del seed y no tienen datos).
UPDATE `Category` c
JOIN (SELECT id, ROW_NUMBER() OVER (ORDER BY createdAt, id) AS n FROM `Category` WHERE isSystem = FALSE) r ON r.id = c.id
SET c.label = CONCAT('Categoría ', r.n), c.labelEn = CONCAT('Category ', r.n), c.key = CONCAT('custom-', r.n);

UPDATE `Tag` t
JOIN (SELECT id, ROW_NUMBER() OVER (ORDER BY createdAt, id) AS n FROM `Tag`) r ON r.id = t.id
SET t.name = CONCAT('Etiqueta ', r.n);

-- Gastos: el concepto pasa a "<categoría> <n>"; las notas, a un texto fijo. El
-- ticket (receiptUrl) apunta a una subida que no existe en local. La huella de
-- importación es un sha256 del concepto real: fuera.
UPDATE `Expense` e
JOIN (SELECT id, ROW_NUMBER() OVER (ORDER BY createdAt, id) AS n FROM `Expense`) r ON r.id = e.id
LEFT JOIN `Category` c ON c.id = e.categoryId
SET e.description = CONCAT(COALESCE(c.label, 'Gasto'), ' ', r.n),
    e.notes = IF(e.notes IS NULL OR e.notes = '', e.notes, 'Nota anonimizada'),
    e.receiptUrl = NULL,
    e.importFingerprint = NULL;

UPDATE `ReceiptLineItem` SET description = CONCAT('Artículo ', position + 1);

UPDATE `RecurringSeries` s
JOIN (SELECT id, ROW_NUMBER() OVER (ORDER BY createdAt, id) AS n FROM `RecurringSeries`) r ON r.id = s.id
LEFT JOIN `Category` c ON c.id = s.categoryId
SET s.description = CONCAT(COALESCE(c.label, 'Recurrente'), ' ', r.n),
    s.notes = IF(s.notes IS NULL OR s.notes = '', s.notes, 'Nota anonimizada');

-- Listas de la compra (el pasillo es vocabulario fijo de src/lib/aisles.ts).
UPDATE `ShoppingList` l
JOIN (SELECT id, ROW_NUMBER() OVER (ORDER BY createdAt, id) AS n FROM `ShoppingList`) r ON r.id = l.id
SET l.name = CONCAT('Lista ', r.n),
    l.description = IF(l.description IS NULL OR l.description = '', l.description, 'Nota anonimizada');

UPDATE `ShoppingListItem` i
JOIN (SELECT id, ROW_NUMBER() OVER (ORDER BY createdAt, id) AS n FROM `ShoppingListItem`) r ON r.id = i.id
SET i.name = CONCAT('Producto ', r.n),
    i.note = IF(i.note IS NULL OR i.note = '', i.note, 'Nota anonimizada');

-- Registro de migraciones: los logs pueden llevar SQL o errores con datos.
UPDATE `_prisma_migrations` SET logs = NULL WHERE logs IS NOT NULL;
