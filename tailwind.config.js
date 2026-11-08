/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './views/partials/book-slider.ejs',
    './views/pages/home.ejs',
    './public/js/book-slider.js'
  ],
  corePlugins: {
    preflight: false
  },
  important: '#artspace-book-slider',
  theme: {
    extend: {
      colors: {
        ink: '#171717',
        panel: '#202020',
        card: '#262626',
        paper: '#f7f1e6',
        paperlight: '#fffdf8',
        cream: '#f5f2eb',
        muted: '#aaa69f',
        brass: '#b89a72',
        rust: '#c88b6d',
        line: '#414141'
      },
      fontFamily: {
        sans: ['Inter', '"Kantumruy Pro"', 'sans-serif'],
        display: ['"Playfair Display"', 'Georgia', 'serif'],
        hand: ['Caveat', 'cursive'],
        khmer: ['"Kantumruy Pro"', 'sans-serif']
      }
    }
  },
  plugins: []
};
