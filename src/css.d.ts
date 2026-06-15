// TypeScript 6 requires type declarations for side-effect imports of plain
// (non-module) CSS files. Next.js only ships types for `*.module.css`.
declare module "*.css";
