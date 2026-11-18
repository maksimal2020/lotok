/**
 * Дизайн-токены «Лоток». Общие для web, admin и mobile.
 * Основной цвет — глубокий бирюзовый (доверие, спокойствие), акцент — тёплый янтарный (действие, цена).
 */
export const colors = {
  brand: {
    50: '#E8F7F4',
    100: '#C6EBE3',
    200: '#8FD6C7',
    300: '#55BFAA',
    400: '#22A68E',
    500: '#0E8C76',
    600: '#0A7362',
    700: '#085B4E',
    800: '#06443B',
    900: '#042E28',
  },
  accent: {
    50: '#FFF6E5',
    100: '#FFE7B8',
    300: '#FFC45C',
    500: '#F59E0B',
    600: '#D97F06',
    700: '#B45F09',
  },
  ink: {
    900: '#121619',
    700: '#3A4148',
    500: '#66707A',
    400: '#8C959E',
    300: '#B9C0C7',
    200: '#DDE2E6',
    100: '#EEF1F3',
    50: '#F6F8F9',
  },
  danger: '#D93636',
  success: '#1F9D55',
  warning: '#D98E04',
  info: '#2F6FDB',
  highlight: '#FFF4D6',
  white: '#FFFFFF',
} as const;

export const radii = { sm: 6, md: 10, lg: 14, xl: 20, full: 9999 } as const;
export const spacing = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 } as const;
export const typography = {
  fontFamily: "'Manrope', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  sizes: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, '2xl': 28, '3xl': 36 },
  weights: { regular: '400', medium: '500', semibold: '600', bold: '700', extrabold: '800' },
} as const;
export const breakpoints = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1440 } as const;
