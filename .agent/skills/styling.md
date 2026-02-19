---
name: UI & Styling (Tailwind v4)
description: Design principles and TailwindCSS v4 configurations for Kill Bill.
---
# UI & Styling

- **Glassmorphism Aesthetic**: Use translucent backgrounds (`bg-white/10`, `bg-opacity-20`, `backdrop-blur-md`), subtle borders (`border-white/20`), and shadows to maintain the premium, modern aesthetic of the app.
- **Tailwind v4**: The project uses Tailwind v4. Rely on the updated `@tailwindcss/postcss` setup.
- **Animations**: Use `framer-motion` for page transitions and micro-interactions (e.g., modal popups, list item entries).
- **Responsive Design**: Ensure mobile layouts are perfect. Always check for horizontal overflow `overflow-x-hidden` on `body` or specific containers.
