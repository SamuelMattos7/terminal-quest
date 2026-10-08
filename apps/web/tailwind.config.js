/** @type {import('tailwindcss').Config} */
// Color names mirror the plan.md §9.1 design tokens 1:1. Note: green, amber,
// red, cyan and purple intentionally replace Tailwind's default palettes of
// the same name — use the bare token names (e.g. `text-green`, `bg-panel`).
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        panel: 'var(--panel)',
        'panel-2': 'var(--panel-2)',
        border: 'var(--border)',
        text: 'var(--text)',
        muted: 'var(--muted)',
        green: 'var(--green)',
        amber: 'var(--amber)',
        red: 'var(--red)',
        cyan: 'var(--cyan)',
        purple: 'var(--purple)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ["'JetBrains Mono'", 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
