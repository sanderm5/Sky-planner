/**
 * Polarnatt — Sky Planner's shared color palette.
 *
 * Single source of truth. Used by:
 *   - apps/web/tailwind.config.js (Tailwind theme)
 *   - apps/web/src/styles/global.css (CSS variables via polarnatt.css)
 *   - apps/app/public/style.css (CSS variables via polarnatt.css)
 *
 * Naming convention:
 *   bg.*      — background colors (darkest to lightest)
 *   accent.*  — primary accent (interactive elements, links, buttons)
 *   border.*  — border / divider colors
 *   text.*    — text colors (brightest to dimmest)
 *   nordic.*  — special Nordic palette colors (frost, aurora, etc.)
 */

export const polarnatt = {
  // Backgrounds (dark → light)
  bg: {
    primary:   '#0A0E16',
    secondary: '#10161E',
    tertiary:  '#182028',
    elevated:  '#1E2832',
    hover:     '#263440',
  },

  // Accent
  accent: {
    base:  '#5E81AC',
    hover: '#7A9BBF',
    dark:  '#4A6D8C',
    deep:  '#3D5A7E',
  },

  // Borders
  border: {
    base:  '#202E3E',
    light: '#304258',
  },

  // Text (bright → dim)
  text: {
    primary:   '#D8E2EC',
    secondary: '#8898AC',
    muted:     '#5E7088',
  },

  // Nordic special colors
  nordic: {
    frost:  '#88C0D0',
    purple: '#B48EAD',
    green:  '#5EB48C',
    aurora: '#4ADE80',
  },
};

/**
 * Tailwind primary color scale derived from Polarnatt accent.
 * Use in tailwind.config.js: colors.primary
 */
export const primaryScale = {
  50:  '#F0F4FA',
  100: '#DDE6F2',
  200: '#B8CCE0',
  300: '#90AECE',
  // 400-600 are CSS-variable driven in tailwind for DEV override support
  700: '#3D5A7E',
  800: '#304868',
  900: '#283C56',
  950: '#1A2840',
};

/**
 * RGB string values (space-separated) for Tailwind CSS variable pattern:
 *   rgb(var(--tw-primary-500) / <alpha-value>)
 */
export const rgb = {
  bgPrimary:   '10 14 22',
  bgSecondary: '16 22 30',
  bgTertiary:  '24 32 40',
  bgElevated:  '30 40 50',
  bgHover:     '38 52 64',
  borderBase:  '32 46 62',
  borderLight: '48 66 88',
  textPrimary: '216 226 236',
  textSecondary: '136 152 172',
  textMuted:   '94 112 136',
  accent:      '94 129 172',
  accentLight: '132 156 185',
  accentMuted: '168 182 200',
};
