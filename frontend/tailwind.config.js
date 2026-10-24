/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {
    colors: { ink: '#172c2b', muted: '#60736f', canvas: '#f5f4ef', forest: '#165e50', mint: '#dcece4', line: '#dce3df', coral: '#ba6c50' },
    fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui'], display: ['Georgia', 'Cambria', 'serif'] },
  } },
  plugins: [],
}
