/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    // keep existing
    './src/app/**/*.{js,ts,jsx,tsx}',
    './src/pages/**/*.{js,ts,jsx,tsx}',
    './src/components/**/*.{js,ts,jsx,tsx}',
    './src/providers/**/*.{js,ts,jsx,tsx}',
    // ensure app/ at project root is scanned (your login page lives here)
    './app/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: '1rem',
        sm: '2rem',
        lg: '4rem',
        xl: '5rem',
        '2xl': '6rem',
      },
    },
    extend: {
      colors: {
        // existing colors (unchanged)
        primary: {
          50: '#f5f9ff',
          100: '#e0edff',
          200: '#b8d6ff',
          300: '#8dbfff',
          400: '#61a8ff',
          500: '#408fff',
          600: '#2b6dd1',
          700: '#1d4e9c',
          800: '#113368',
          900: '#0a1d3f',
        },
        accent: {
          gold: '#D4AF37',
          maroon: '#7A3C3A',
          navy: '#1F2E4A',
        },
        neutral: {
          50: '#fafafa',
          100: '#f5f5f5',
          200: '#e5e5e5',
          300: '#d4d4d4',
          400: '#a3a3a3',
          500: '#737373',
          600: '#525252',
          700: '#404040',
          800: '#262626',
          900: '#171717',
        },

        // --- login/auth design tokens ---
        'deep-navy': '#0f2147',
        'deep-navy-pressed': '#0c1a39',
        'grey-border': '#E5E8EE',
        'grey-hover': '#F6F8FB',
      },

      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui'],
        serif: ['Merriweather', 'ui-serif', 'Georgia'],
        display: ['Oswald'],
        logo: ['"Cormorant Garamond"'],
      },

      spacing: {
        '9/16': '56.25%',
        '72': '18rem',
        '84': '21rem',
        '96': '24rem',
      },

      borderRadius: {
        '4xl': '2rem',
      },

      boxShadow: {
        'outline-primary': '0 0 0 3px rgba(64, 143, 255, 0.5)',
        'card': '0 4px 8px rgba(0,0,0,0.05)',
        // auth UI
        'auth-elev': '0 18px 54px rgba(22,32,64,.10)',
        'btn-navy': '0 8px 24px rgba(15,33,71,.12)',
        'btn-navy-hover': '0 10px 26px rgba(15,33,71,.18)',
        'btn-navy-active': '0 6px 18px rgba(15,33,71,.14)',
      },

      transitionTimingFunction: {
        'in-expo': 'cubic-bezier(0.95, 0.05, 0.795, 0.035)',
      },

      // animations for fast, premium feel
      keyframes: {
        fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
        popIn: {
          '0%': { opacity: 0, transform: 'translateY(4px) scale(.985)' },
          '100%': { opacity: 1, transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        'fade-in-fast': 'fadeIn .16s ease-out both',
        'pop-in-fast': 'popIn .16s ease-out both',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
    require('@tailwindcss/aspect-ratio'),
    require('@tailwindcss/line-clamp'),
    require('tailwind-scrollbar')({ nocompatible: true }),

    // --- lightweight component presets for login/auth ---
    function ({ addComponents, theme }) {
      const colors = theme('colors');
      addComponents({
        // Dimmed backdrop under centered modal
        '.backdrop-auth': {
          '@apply fixed inset-0 z-40 bg-black/35 backdrop-blur-[1px]': {},
          animation: theme('animation.fade-in-fast'),
          willChange: 'opacity',
        },

        // The centered auth card container
        '.auth-card': {
          '@apply relative w-full max-w-[540px] rounded-2xl bg-white': {},
          border: `1px solid ${colors['grey-border']}`,
          boxShadow: theme('boxShadow.auth-elev'),
          animation: theme('animation.pop-in-fast'),
        },

        // Quiet secondary button (outline)
        '.btn-quiet': {
          '@apply rounded-lg border px-3 py-2.5 text-sm font-medium bg-white text-deep-navy transition-colors': {},
          borderColor: colors['grey-border'],
          '&:hover': { '@apply bg-grey-hover': {} },
          '&:disabled': { '@apply opacity-60 cursor-not-allowed': {} },
        },

        // Premium deep‑navy primary button
        '.btn-primary-navy': {
          '@apply rounded-lg py-2.5 text-sm font-semibold text-white transition-[transform,box-shadow,background-color] will-change-transform': {},
          backgroundColor: colors['deep-navy'],
          boxShadow: theme('boxShadow.btn-navy'),
          letterSpacing: '.02em',
          '&:hover': {
            transform: 'translateY(-1px)',
            boxShadow: theme('boxShadow.btn-navy-hover'),
          },
          '&:active': {
            transform: 'translateY(0)',
            boxShadow: theme('boxShadow.btn-navy-active'),
            backgroundColor: colors['deep-navy-pressed'],
          },
          '&:disabled': { '@apply opacity-60 cursor-not-allowed': {} },
        },

        // Inputs
        '.field': {
          '@apply w-full rounded-lg px-3 py-2 text-[15px] outline-none bg-white': {},
          border: `1px solid ${colors['grey-border']}`,
          color: colors['deep-navy'],
          '&::placeholder': { color: '#8a93a6' },
          '&:focus': { '@apply ring-4': {}, ringColor: '#E9EEF8' },
        },

        // Segmented control surface
        '.segmented': {
          '@apply grid rounded-xl p-1 bg-grey-hover': {},
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        },
        '.segmented-btn': {
          '@apply py-2 text-sm rounded-lg transition-all text-[#6b7383]': {},
        },
        '.segmented-btn-active': {
          '@apply bg-white text-deep-navy shadow-sm': {},
          border: `1px solid ${colors['grey-border']}`,
          boxShadow: '0 1px 3px rgba(15,33,71,.06)',
        },
      });
    },
  ],
  safelist: [
    // keep your existing safelist
    'bg-primary-500',
    'hover:bg-primary-600',
    'text-accent-gold',
    'dark:bg-neutral-900',

    // auth specific utility classes that may be created dynamically
    'grid', 'place-items-center',
    'fixed', 'inset-0', 'z-40', 'z-50',
    'p-4', 'min-h-screen',
    'bg-black/35', 'backdrop-blur-[1px]',
    'max-w-[540px]',
  ],
};
