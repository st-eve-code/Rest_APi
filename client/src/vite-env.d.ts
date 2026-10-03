/// <reference types="vite/client" />

/**
 * Lets TypeScript understand the non-code imports Vite handles:
 *   - `import './styles.css'` inside main.tsx
 *   - `import.meta.env.*`
 *
 * The triple-slash reference is the idiomatic way; do not convert it to an
 * `import` statement.
 */