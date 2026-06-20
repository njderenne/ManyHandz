/**
 * AppFactory design tokens (NativeWind / Tailwind v3).
 *
 * Semantic colors are driven by CSS variables (see global.css) so the same class names theme
 * both light and dark. The brand ramp is fixed (constant per app). To rebrand an app: change the
 * brand ramp here + the matching `--primary`/`--ring` values in global.css + the `palette` in
 * src/lib/config/theme.ts (icon colors). Dark is the default; see theme.ts for light/dark/system.
 *
 * @type {import('tailwindcss').Config}
 */
function withVar(name) {
  return `rgb(var(${name}) / <alpha-value>)`
}

module.exports = {
  darkMode: 'class',
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        background: withVar('--background'),
        foreground: withVar('--foreground'),
        card: withVar('--card'),
        'card-foreground': withVar('--card-foreground'),
        popover: withVar('--popover'),
        'popover-foreground': withVar('--popover-foreground'),
        muted: withVar('--muted'),
        'muted-foreground': withVar('--muted-foreground'),
        border: withVar('--border'),
        input: withVar('--input'),
        ring: withVar('--ring'),
        primary: withVar('--primary'),
        'primary-foreground': withVar('--primary-foreground'),
        secondary: withVar('--secondary'),
        'secondary-foreground': withVar('--secondary-foreground'),
        accent: withVar('--accent'),
        'accent-foreground': withVar('--accent-foreground'),
        destructive: withVar('--destructive'),
        'destructive-foreground': withVar('--destructive-foreground'),
        success: withVar('--success'),
        warning: withVar('--warning'),
        brand: {
          50: '#fff2ef',
          100: '#ffe5df',
          200: '#ffcec3',
          300: '#ffad9b',
          400: '#ff8a70',
          500: '#ff6b4a',
          600: '#ff4b23',
          700: '#fa2e00',
          800: '#cc2500',
          900: '#a91f00',
        },
      },
      borderRadius: {
        sm: '8px',
        md: '10px',
        lg: '12px',
        xl: '16px',
      },
    },
  },
  plugins: [],
}
