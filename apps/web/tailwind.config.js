import { primaryScale } from '@skyplanner/theme/colors';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50: primaryScale[50],
          100: primaryScale[100],
          200: primaryScale[200],
          300: primaryScale[300],
          400: 'rgb(var(--tw-primary-400) / <alpha-value>)',
          500: 'rgb(var(--tw-primary-500) / <alpha-value>)',
          600: 'rgb(var(--tw-primary-600) / <alpha-value>)',
          700: primaryScale[700],
          800: primaryScale[800],
          900: primaryScale[900],
          950: primaryScale[950],
        },
        secondary: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
        },
        dark: {
          50: 'rgb(var(--tw-dark-50) / <alpha-value>)',
          100: 'rgb(var(--tw-dark-100) / <alpha-value>)',
          200: 'rgb(var(--tw-dark-200) / <alpha-value>)',
          300: 'rgb(var(--tw-dark-300) / <alpha-value>)',
          400: 'rgb(var(--tw-dark-400) / <alpha-value>)',
          500: 'rgb(var(--tw-dark-500) / <alpha-value>)',
          600: 'rgb(var(--tw-dark-600) / <alpha-value>)',
          700: 'rgb(var(--tw-dark-700) / <alpha-value>)',
          800: 'rgb(var(--tw-dark-800) / <alpha-value>)',
          900: 'rgb(var(--tw-dark-900) / <alpha-value>)',
          950: 'rgb(var(--tw-dark-950) / <alpha-value>)',
        },
        accent: {
          cyan: '#22d3ee',
          purple: '#a855f7',
          pink: '#ec4899',
          blue: '#5E81AC',
          frost: '#88C0D0',
        },
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        serif: ['Fraunces', 'Georgia', 'serif'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
        'hero-gradient': 'linear-gradient(135deg, #0A0E16 0%, #10161E 50%, #0A0E16 100%)',
        'card-gradient': 'linear-gradient(135deg, rgba(var(--accent-rgb), 0.1) 0%, rgba(var(--accent-secondary-rgb), 0.1) 100%)',
        'glow-gradient': 'linear-gradient(135deg, rgb(var(--accent-rgb)) 0%, rgb(var(--accent-secondary-rgb)) 50%, rgb(var(--accent-tertiary-rgb)) 100%)',
      },
      boxShadow: {
        'glow': '0 0 20px rgba(var(--accent-rgb), 0.3)',
        'glow-lg': '0 0 40px rgba(var(--accent-rgb), 0.4)',
        'glow-orange': '0 0 30px rgba(var(--accent-rgb), 0.3)',
        'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
      },
      backdropBlur: {
        xs: '2px',
      },
      animation: {
        'float': 'float 6s ease-in-out infinite',
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'gradient': 'gradient 8s ease infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'slide-up': 'slideUp 0.5s ease-out',
        'slide-down': 'slideDown 0.5s ease-out',
        'fade-in': 'fadeIn 0.5s ease-out',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-20px)' },
        },
        gradient: {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        glow: {
          '0%': { boxShadow: '0 0 20px rgba(var(--accent-rgb), 0.3)' },
          '100%': { boxShadow: '0 0 40px rgba(var(--accent-rgb), 0.6)' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
