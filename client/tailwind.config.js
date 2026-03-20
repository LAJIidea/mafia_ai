/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        night: '#0f0e17',
        dawn: '#1a1a2e',
        blood: '#c0392b',
        wolf: '#8e44ad',
        village: '#27ae60',
        seer: '#2980b9',
        witch: '#16a085',
        hunter: '#d35400',
        guard: '#f39c12',
      },
      fontFamily: {
        game: ['Noto Sans SC', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
