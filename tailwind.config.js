/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        serif: ['Fraunces', 'ui-serif', 'Georgia', 'serif'],
      },
      colors: {
        bg: {
          DEFAULT: 'hsl(var(--bg) / <alpha-value>)',
          subtle: 'hsl(var(--bg-subtle) / <alpha-value>)',
          muted: 'hsl(var(--bg-muted) / <alpha-value>)',
        },
        fg: {
          DEFAULT: 'hsl(var(--fg) / <alpha-value>)',
          muted: 'hsl(var(--fg-muted) / <alpha-value>)',
          subtle: 'hsl(var(--fg-subtle) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'hsl(var(--border) / <alpha-value>)',
          subtle: 'hsl(var(--border-subtle) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          fg: 'hsl(var(--accent-fg) / <alpha-value>)',
        },
        brand: {
          orange: '#FF6B1A',
          'orange-pressed': '#E85A0A',
          black: '#0E0E0E',
        },
        ring: 'hsl(var(--ring) / <alpha-value>)',
        success: 'hsl(var(--success) / <alpha-value>)',
        warning: 'hsl(var(--warning) / <alpha-value>)',
        danger: 'hsl(var(--danger) / <alpha-value>)',
        // Agent accents
        mentor: 'hsl(var(--agent-mentor) / <alpha-value>)',
        cto: 'hsl(var(--agent-cto) / <alpha-value>)',
        cmo: 'hsl(var(--agent-cmo) / <alpha-value>)',
        cfo: 'hsl(var(--agent-cfo) / <alpha-value>)',
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
        '3xl': '1.5rem',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'morph-in': {
          '0%': { opacity: '0', transform: 'translateY(6px) scale(0.96)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'blink': {
          '0%, 50%': { opacity: '1' },
          '51%, 100%': { opacity: '0' },
        },
        'think-pulse': {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.7' },
          '50%': { transform: 'scale(1.06)', opacity: '1' },
        },
        'scan-line': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        'progress-indeterminate': {
          '0%': { transform: 'translateX(-100%) scaleX(0.5)' },
          '50%': { transform: 'translateX(0%) scaleX(0.7)' },
          '100%': { transform: 'translateX(100%) scaleX(0.5)' },
        },
        'orb-breathe': {
          '0%, 100%': { transform: 'scale(1)', boxShadow: '0 0 24px hsl(35 92% 60% / 0.20)' },
          '50%':       { transform: 'scale(1.07)', boxShadow: '0 0 44px hsl(35 92% 60% / 0.36)' },
        },
        'done-glow': {
          '0%':   { boxShadow: '0 0 0 0 hsl(35 92% 60% / 0)' },
          '25%':  { boxShadow: '0 0 0 4px hsl(35 92% 60% / 0.20)' },
          '100%': { boxShadow: '0 0 0 0 hsl(35 92% 60% / 0)' },
        },
        'check-pop': {
          '0%':  { transform: 'scale(0) rotate(-20deg)', opacity: '0' },
          '60%': { transform: 'scale(1.25) rotate(6deg)', opacity: '1' },
          '100%':{ transform: 'scale(1) rotate(0deg)', opacity: '1' },
        },
        'chip-up': {
          '0%':   { opacity: '0', transform: 'translateY(6px) scale(0.95)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out',
        'fade-up': 'fade-up 250ms cubic-bezier(0.16, 1, 0.3, 1)',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
        'shimmer': 'shimmer 2.4s linear infinite',
        'morph-in': 'morph-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        'blink': 'blink 1s steps(1) infinite',
        'think-pulse': 'think-pulse 1.6s ease-in-out infinite',
        'scan-line': 'scan-line 1.8s ease-in-out infinite',
        'progress-indeterminate': 'progress-indeterminate 1.4s ease-in-out infinite',
        'orb-breathe': 'orb-breathe 2.8s ease-in-out infinite',
        'done-glow': 'done-glow 1.1s ease-out forwards',
        'check-pop': 'check-pop 320ms cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'chip-up': 'chip-up 260ms cubic-bezier(0.16, 1, 0.3, 1) forwards',
      },
      backgroundImage: {
        'shimmer-gradient': 'linear-gradient(90deg, transparent, hsl(var(--fg-subtle) / 0.08), transparent)',
        'dot-grid': 'radial-gradient(hsl(var(--border) / 0.4) 1px, transparent 1px)',
        'radial-fade': 'radial-gradient(circle at top, hsl(var(--accent) / 0.08), transparent 60%)',
      },
      backgroundSize: {
        'dot-grid': '24px 24px',
      },
      boxShadow: {
        'soft': '0 1px 2px hsl(var(--fg) / 0.04), 0 4px 12px hsl(var(--fg) / 0.04)',
        'glow': '0 0 0 1px hsl(var(--accent) / 0.2), 0 8px 24px hsl(var(--accent) / 0.12)',
      },
    },
  },
  plugins: [],
}
