css_content = '''

/* Mood System Styles */
.mood-panel {
  position: fixed;
  z-index: 1500;
  inset: 0;
  background: var(--mood-primary);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: var(--intro-ink);
  font-family: 'Kantumruy Pro', 'Noto Sans Khmer', sans-serif;
  display: none;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  opacity: 0;
  transition: opacity 0.3s ease, visibility 0.3s ease;
}
html.intro-pending .mood-panel { pointer-events: auto; }
.mood-panel.is-visible { opacity: 1; }
.mood-panel-close { position: absolute; top: 20px; right: 24px; background: none; border: none; color: var(--intro-ink); cursor: pointer; padding: 8px; z-index: 10; }
.mood-panel-close svg { width: 28px; height: 28px; }
.mood-panel-inner { max-width: 90%; max-height: 90%; text-align: center; padding: 2rem; background: var(--mood-secondary); border-radius: 12px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25); }
.mood-panel-title { margin: 0 0 1.5rem; font-size: 1.25rem; font-weight: 600; color: var(--intro-ink); }
.mood-options { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; margin: 0 0 2rem; }
.mood-option { background: none; border: none; padding: 1rem; border-radius: 8px; cursor: pointer; transition: background 0.2s, transform 0.1s; display: flex; align-items: center; justify-content: center; min-width: 80px; min-height: 80px; }
.mood-option:hover { background: rgba(255,255,255,0.1); }
.mood-option:focus-visible { outline: 2px solid var(--intro-accent); outline-offset: 2px; }
.mood-option--cool:hover { background: rgba(76,57,39,0.15); }
.mood-option--love:hover { background: rgba(255,107,107,0.15); }
.mood-option--romantic:hover { background: rgba(255,160,122,0.15); }
.mood-option--sad:hover { background: rgba(30,58,95,0.15); }
.mood-option .mood-icon { font-size: 2.5rem; display: block; margin-bottom: 0.25rem; }
.mood-option .mood-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--intro-muted); }
.mood-controls { margin-top: 1.5rem; display: flex; align-items: center; justify-content: center; gap: 0.5rem; }
.mood-volume-label { font-size: 0.75rem; margin-right: 0.5rem; color: var(--intro-muted); }
.mood-volume-slider { width: 120px; accent-color: var(--intro-accent); }
@media (prefers-reduced-motion: reduce) { .mood-particle { animation: none !important; transition: none !important; } }
'''

with open('D:\kong\me\public/css/intro.css', 'a', encoding='utf-8') as f:
    f.write(css_content)
print('CSS appended')