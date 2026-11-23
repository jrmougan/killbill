-- Comprobación de la réplica anonimizada (scripts/replica/db-replica.sh). Cada
-- fila es una comprobación y el número de filas que la incumplen: todas deben
-- dar 0. Si alguna no da 0, el script vacía la BD y aborta sin guardar caché.

-- Las tablas de Prisma usan utf8mb4_unicode_ci; literales y variables, también.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET @dev_password = '$2b$10$EJD3v1vNJhjebAUKv5eUY.hoKEhP1dmTbCdJNX.MtOHiXTDllwou2';
SET @dev_pin      = '$2b$10$XM4DUzDvJnj1uJg6wXhGVudbSwu2fBFSOPXtho0gvKq9.DXenzhpq';

SELECT 'email_fuera_de_example_invalid', COUNT(*) FROM `User`
  WHERE email IS NOT NULL AND email NOT LIKE '%@example.invalid'
UNION ALL SELECT 'login_dev_ausente', 1 - COUNT(*) FROM `User`
  WHERE email = 'admin@example.invalid' AND isAdmin AND password = @dev_password
UNION ALL SELECT 'password_distinta_de_dev', COUNT(*) FROM `User`
  WHERE password IS NOT NULL AND password <> @dev_password
UNION ALL SELECT 'pin_distinto_de_dev', COUNT(*) FROM `User`
  WHERE pin IS NOT NULL AND pin <> @dev_pin
UNION ALL SELECT 'nombre_de_usuario_real', COUNT(*) FROM `User`
  WHERE name NOT REGEXP '^(Admin|Usuario [0-9]+|Invitado [0-9]+)$'
UNION ALL SELECT 'avatar_con_ruta', COUNT(*) FROM `User` WHERE avatar REGEXP '[/.:]'
UNION ALL SELECT 'nombre_de_espacio_real', COUNT(*) FROM `Couple`
  WHERE name IS NOT NULL AND name NOT REGEXP '^Espacio [0-9]+$'
UNION ALL SELECT 'codigo_de_espacio_real', COUNT(*) FROM `Couple`
  WHERE code <> UPPER(LEFT(SHA2(CONCAT('killbill-replica:', id), 256), 12))
UNION ALL SELECT 'invitaciones', (SELECT COUNT(*) FROM `GroupInvite`) + (SELECT COUNT(*) FROM `InviteCode`)
UNION ALL SELECT 'tokens_de_invitado', COUNT(*) FROM `Membership` WHERE guestTokenHash IS NOT NULL
UNION ALL SELECT 'api_keys_de_ia', COUNT(*) FROM `AiProviderConfig` WHERE encryptedApiKey IS NOT NULL
UNION ALL SELECT 'categoria_propia_real', COUNT(*) FROM `Category`
  WHERE isSystem = FALSE AND (label NOT REGEXP '^Categoría [0-9]+$' OR labelEn NOT REGEXP '^Category [0-9]+$')
UNION ALL SELECT 'etiqueta_real', COUNT(*) FROM `Tag` WHERE name NOT REGEXP '^Etiqueta [0-9]+$'
UNION ALL SELECT 'concepto_de_gasto_real', COUNT(*) FROM `Expense` e LEFT JOIN `Category` c ON c.id = e.categoryId
  WHERE e.description NOT LIKE CONCAT(COALESCE(c.label, 'Gasto'), ' %') OR e.description NOT REGEXP ' [0-9]+$'
UNION ALL SELECT 'nota_de_gasto_real', COUNT(*) FROM `Expense`
  WHERE notes IS NOT NULL AND notes NOT IN ('', 'Nota anonimizada')
UNION ALL SELECT 'ticket_o_huella', COUNT(*) FROM `Expense`
  WHERE receiptUrl IS NOT NULL OR importFingerprint IS NOT NULL
UNION ALL SELECT 'linea_de_ticket_real', COUNT(*) FROM `ReceiptLineItem`
  WHERE description NOT REGEXP '^Artículo -?[0-9]+$'
UNION ALL SELECT 'recurrente_real', COUNT(*) FROM `RecurringSeries` s LEFT JOIN `Category` c ON c.id = s.categoryId
  WHERE s.description NOT LIKE CONCAT(COALESCE(c.label, 'Recurrente'), ' %') OR s.description NOT REGEXP ' [0-9]+$'
     OR (s.notes IS NOT NULL AND s.notes NOT IN ('', 'Nota anonimizada'))
UNION ALL SELECT 'lista_real', COUNT(*) FROM `ShoppingList`
  WHERE name NOT REGEXP '^Lista [0-9]+$' OR (description IS NOT NULL AND description NOT IN ('', 'Nota anonimizada'))
UNION ALL SELECT 'producto_real', COUNT(*) FROM `ShoppingListItem`
  WHERE name NOT REGEXP '^Producto [0-9]+$' OR (note IS NOT NULL AND note NOT IN ('', 'Nota anonimizada'))
UNION ALL SELECT 'logs_de_migraciones', COUNT(*) FROM `_prisma_migrations` WHERE logs IS NOT NULL
-- Columnas de texto que esta anonimización no conoce: una migración nueva en
-- producción añadió una. Revísala, cúbrela en anonymize.sql y añádela aquí.
UNION ALL SELECT CONCAT('columna_sin_revisar:', COALESCE(GROUP_CONCAT(CONCAT(table_name, '.', column_name)), '')), COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND data_type IN ('char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext', 'json', 'blob', 'mediumblob', 'longblob', 'binary', 'varbinary', 'enum', 'set')
    AND column_name NOT IN ('id', 'scopeKey', 'currency')
    AND column_name NOT LIKE '%Id'
    AND CONCAT(table_name, '.', column_name) NOT IN (
      'AiProviderConfig.encryptedApiKey', 'AiProviderConfig.model', 'AiProviderConfig.provider',
      'Category.key', 'Category.label', 'Category.labelEn', 'Category.emoji', 'Category.icon',
      'Category.color', 'Category.bgColor', 'Category.hex',
      'Couple.name', 'Couple.code', 'Couple.type', 'Couple.status',
      'Expense.description', 'Expense.receiptUrl', 'Expense.notes', 'Expense.importFingerprint',
      'Expense.visibility', 'Expense.splitStrategy',
      'GroupInvite.tokenHash', 'GroupInvite.tokenPrefix', 'GroupInvite.kind', 'InviteCode.code',
      'LedgerTransaction.dedupeKey', 'LedgerTransaction.kind',
      'Membership.guestTokenHash', 'Membership.role', 'Membership.status',
      'ReceiptLineItem.description',
      'RecurringSeries.description', 'RecurringSeries.notes', 'RecurringSeries.visibility',
      'RecurringSeries.splitStrategy', 'RecurringSeries.interval',
      'Settlement.status', 'Settlement.method',
      'Budget.periodType',
      'ShoppingList.name', 'ShoppingList.description',
      'ShoppingListItem.name', 'ShoppingListItem.unit', 'ShoppingListItem.note', 'ShoppingListItem.aisle',
      'Tag.name', 'Tag.color',
      'User.name', 'User.email', 'User.pin', 'User.avatar', 'User.password',
      '_prisma_migrations.checksum', '_prisma_migrations.migration_name', '_prisma_migrations.logs'
    );
