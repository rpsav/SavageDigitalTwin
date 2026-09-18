import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          red: '#DC2626',
          black: '#111111',
          white: '#FFFFFF',
        },
      },
    },
  },
  plugins: [],
};

export default config;
