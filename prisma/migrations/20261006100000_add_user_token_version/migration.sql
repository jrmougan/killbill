-- Session/MCP token revocation (H2). Every session and MCP JWT carries a `tv`
-- claim that must equal User.tokenVersion; bumping the column invalidates every
-- token issued before. Additive: existing rows start at 0, and tokens minted
-- before this deploy (no `tv` claim) are treated as tv=0, so nobody is logged out.
ALTER TABLE `User` ADD COLUMN `tokenVersion` INTEGER NOT NULL DEFAULT 0;
