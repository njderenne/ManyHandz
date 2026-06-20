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
          50: '#eef1ff',
          100: '#e0e5ff',
          200: '#c7cffe',
          300: '#a5affc',
          400: '#828df8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
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
