import defaultTheme from 'tailwindcss/defaultTheme';

/** @type {import('tailwindcss').Config} */
const config = {
  darkMode: ['class'],
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{ts,tsx,js,jsx,md,mdx}',
    './src/renderer/src/**/*.{css,scss}',
    './src/common/**/*.{ts,js}',
    './src/main/**/*.{ts,js}'
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Poppins', ...defaultTheme.fontFamily.sans]
      },
      container: {
        center: true,
        padding: '1rem'
      },
      colors: {
        primary: {
          DEFAULT: '#7c3aed',
          light: '#a78bfa',
          dark: '#5b21b6'
        },
        accent: '#38bdf8'
      }
    }
  },
  plugins: []
};

export default config;
