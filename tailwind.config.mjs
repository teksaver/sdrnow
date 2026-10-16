/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        primary: '#F26522',
        background: '#FFFFFF',
        surface: '#F9FAFB',
        text_main: '#111827',
        text_muted: '#4B5563',
        border: '#E5E7EB',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '4px',
      },
      spacing: {
        section: '80px',
      },
    },
  },
  plugins: [],
};
