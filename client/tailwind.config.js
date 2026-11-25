/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#f3efe4',
        ink: '#1c1915',
        pine: '#1e3a32',
        moss: '#3d6b56',
        clay: '#8c3d2b',
        sand: '#e6dfd0',
        card: '#fbf8f2',
      },
      fontFamily: {
        sans: ['"Source Sans 3"', 'Segoe UI', 'sans-serif'],
        serif: ['"Source Serif 4"', 'Palatino', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};
