(() => {
  'use strict';

  if (window.ArtSpaceImageEditor) return;

  const CROPPER_JS = '/vendor/cropper.min.js';
  const CROPPER_CSS = '/vendor/cropper.min.css';
  const EDITOR_CSS = '/css/image-editor.css';
  const MAX_WORK_SIZE = 2400;
  const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
  const HISTORY_LIMIT = 25;
  const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const ACCEPTED_EXTENSION = /\.(jpe?g|png|webp)$/i;

  let cropperPromise = null;

  const ensureStyle = (href, id) => {
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.id = id;
    document.head.appendChild(link);
  };

  const ensureEditorStyle = () => ensureStyle(EDITOR_CSS, 'artspace-image-editor-css');

  const loadCropper = () => {
    ensureEditorStyle();
    if (window.Cropper) return Promise.resolve();
    if (cropperPromise) return cropperPromise;

    ensureStyle(CROPPER_CSS, 'artspace-cropper-css');
    const loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = CROPPER_JS;
      script.async = true;
      script.onload = () => (window.Cropper ? resolve() : reject(new Error('The image tools could not load.')));
      script.onerror = () => reject(new Error('The image tools could not load.'));
      document.head.appendChild(script);
    });
    cropperPromise = loading.catch((error) => {
      cropperPromise = null;
      throw error;
    });
    return cropperPromise;
  };

  const formatBytes = (bytes) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDimensions = (width, height) => `${Math.round(width)} × ${Math.round(height)} px`;

  const hasExtension = (name) => ACCEPTED_EXTENSION.test(String(name || ''));

  const validateFile = (file, maxBytes) => {
    if (!file) return 'Choose an image to edit.';
    if (!ACCEPTED_TYPES.includes(file.type) && !hasExtension(file.name)) {
      return 'That file type is not supported. Use JPG, PNG, or WebP.';
    }
    if (!file.size) return 'That image appears to be empty. Choose another file.';
    if (file.size > maxBytes) {
      return `That image is larger than ${Math.round(maxBytes / (1024 * 1024))} MB. Choose a smaller file.`;
    }
    return '';
  };

  const loadImageElement = (file) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That image could not be read. It may be corrupted.'));
    };
    image.src = url;
  });

  const canvasToBlob = (canvas, type, quality) => new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error('The image could not be prepared.'));
      }, type, quality);
    } catch (error) {
      reject(error);
    }
  });

  const dataUrlToBlob = (dataUrl) => {
    const parts = String(dataUrl).split(',');
    const mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/png';
    const binary = atob(parts[1] || '');
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: mime });
  };

  const contextSupportsFilter = (() => {
    try {
      const ctx = document.createElement('canvas').getContext('2d');
      return Boolean(ctx && 'filter' in ctx);
    } catch (error) {
      return false;
    }
  })();

  const clampByte = (value) => (value < 0 ? 0 : value > 255 ? 255 : value);

  const applyPixelFilters = (ctx, width, height, filters) => {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const brightness = filters.brightness / 100;
    const contrast = filters.contrast / 100;
    const saturation = filters.saturation / 100;

    for (let index = 0; index < data.length; index += 4) {
      let r = data[index] * brightness;
      let g = data[index + 1] * brightness;
      let b = data[index + 2] * brightness;

      r = (r - 128) * contrast + 128;
      g = (g - 128) * contrast + 128;
      b = (b - 128) * contrast + 128;

      const gray = r * 0.2126 + g * 0.7152 + b * 0.0722;
      r = gray + (r - gray) * saturation;
      g = gray + (g - gray) * saturation;
      b = gray + (b - gray) * saturation;

      data[index] = clampByte(r);
      data[index + 1] = clampByte(g);
      data[index + 2] = clampByte(b);
    }

    ctx.putImageData(imageData, 0, 0);
  };

  const applySharpen = (ctx, width, height, amount) => {
    const strength = (amount / 100) * 0.85;
    if (strength <= 0.01 || width < 3 || height < 3) return;

    const source = ctx.getImageData(0, 0, width, height);
    const src = source.data;
    const output = ctx.createImageData(width, height);
    const out = output.data;
    const center = 1 + 4 * strength;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;

        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
          out[index] = src[index];
          out[index + 1] = src[index + 1];
          out[index + 2] = src[index + 2];
          out[index + 3] = src[index + 3];
          continue;
        }

        for (let channel = 0; channel < 3; channel += 1) {
          out[index + channel] = clampByte(
            src[index + channel] * center
            - strength * src[index - 4 + channel]
            - strength * src[index + 4 + channel]
            - strength * src[index - width * 4 + channel]
            - strength * src[index + width * 4 + channel]
          );
        }
        out[index + 3] = src[index + 3];
      }
    }

    ctx.putImageData(output, 0, 0);
  };

  const cssFilter = (filters) => `brightness(${filters.brightness}%) contrast(${filters.contrast}%) saturate(${filters.saturation}%)`;

  const defaultFilters = () => ({ brightness: 100, contrast: 100, saturation: 100, sharpness: 0 });

  const buildMarkup = (mode) => {
    const isAvatar = mode === 'avatar';
    const isCover = mode === 'cover';
    const isArtwork = !isAvatar && !isCover;
    const kicker = isAvatar ? 'Portrait studio' : isCover ? 'Cover studio' : 'Artwork studio';
    const title = isAvatar ? 'Edit your profile picture' : isCover ? 'Edit your cover image' : 'Edit your artwork';
    const applyLabel = isAvatar ? 'Apply portrait' : isCover ? 'Apply cover' : 'Apply edits';
    const previewLabel = isAvatar ? 'Preview portrait' : isCover ? 'Preview cover' : 'Preview edited';
    const ratioOptions = isCover
      ? [['free', 'Free'], ['16:5', '16:5'], ['16:9', '16:9'], ['4:3', '4:3']]
      : [['free', 'Free'], ['1', '1:1'], ['4:3', '4:3'], ['16:9', '16:9']];
    const defaultRatio = isAvatar ? '1' : isCover ? '16:5' : 'free';
    const ratioMarkup = ratioOptions.map(([value, label]) => (
      `<button type="button" class="ie-ratio${value === defaultRatio ? ' is-active' : ''}" data-ie-ratio="${value}">${label}</button>`
    )).join('');
    return `
      <div class="ie-overlay" data-ie-overlay data-native-cursor>
        <div class="ie-dialog" role="dialog" aria-modal="true" aria-labelledby="ie-title">
          <header class="ie-head">
            <div class="ie-head-copy">
              <span class="ie-kicker">${kicker}</span>
              <h2 id="ie-title">${title}</h2>
              <p class="ie-meta" data-ie-meta>Preparing your canvas…</p>
            </div>
            <button class="ie-close" type="button" data-ie-close aria-label="Close editor">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </header>

          <div class="ie-body">
            <aside class="ie-tools" aria-label="Transform tools">
              <div class="ie-tool-group">
                <span class="ie-group-label">Rotate</span>
                <button type="button" class="ie-tool" data-ie-action="rotate-left" aria-label="Rotate left 90 degrees" title="Rotate left">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11a8 8 0 1 1 2.4 5.7" /><path d="M4 4v7h7" /></svg>
                  <span>Left</span>
                </button>
                <button type="button" class="ie-tool" data-ie-action="rotate-right" aria-label="Rotate right 90 degrees" title="Rotate right">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.4 5.7" /><path d="M20 4v7h-7" /></svg>
                  <span>Right</span>
                </button>
              </div>

              <div class="ie-tool-group">
                <span class="ie-group-label">Flip</span>
                <button type="button" class="ie-tool" data-ie-action="flip-h" aria-label="Flip horizontally" title="Flip horizontally">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18" /><path d="M8 7 3 12l5 5V7ZM16 7l5 5-5 5V7Z" /></svg>
                  <span>Across</span>
                </button>
                <button type="button" class="ie-tool" data-ie-action="flip-v" aria-label="Flip vertically" title="Flip vertically">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h18" /><path d="M7 8 12 3l5 5H7ZM7 16l5 5 5-5H7Z" /></svg>
                  <span>Down</span>
                </button>
              </div>

              <div class="ie-tool-group">
                <span class="ie-group-label">Zoom</span>
                <button type="button" class="ie-tool" data-ie-action="zoom-in" aria-label="Zoom in" title="Zoom in">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.4" /><path d="m15.6 15.6 4.4 4.4M10.8 7.8v6M7.8 10.8h6" /></svg>
                  <span>In</span>
                </button>
                <button type="button" class="ie-tool" data-ie-action="zoom-out" aria-label="Zoom out" title="Zoom out">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.4" /><path d="m15.6 15.6 4.4 4.4M7.8 10.8h6" /></svg>
                  <span>Out</span>
                </button>
              </div>

              <div class="ie-tool-group">
                <span class="ie-group-label">View</span>
                <button type="button" class="ie-tool" data-ie-view="fit" aria-label="Fit the whole image in the view" title="Fit to view">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" /></svg>
                  <span>Fit</span>
                </button>
                <button type="button" class="ie-tool" data-ie-view="fill" aria-label="Fill the frame with the image" title="Fill frame">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /><path d="m9 12 2-2m4 4-2 2" /></svg>
                  <span>Fill</span>
                </button>
              </div>

              <div class="ie-tool-group">
                <span class="ie-group-label">History</span>
                <button type="button" class="ie-tool" data-ie-action="undo" aria-label="Undo" title="Undo (Ctrl+Z)" disabled>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4 12l5 5" /><path d="M4 12h9a6 6 0 0 1 6 6v1" /></svg>
                  <span>Undo</span>
                </button>
                <button type="button" class="ie-tool" data-ie-action="redo" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 7 5 5-5 5" /><path d="M20 12h-9a6 6 0 0 0-6 6v1" /></svg>
                  <span>Redo</span>
                </button>
              </div>

              <div class="ie-tool-group">
                <span class="ie-group-label">Image</span>
                <button type="button" class="ie-tool" data-ie-action="compare" aria-label="Hold to see the original image" title="Hold to compare">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="1.6" /><path d="M12 4.5v15M8.5 8.5h1M14.5 15.5h1" /></svg>
                  <span>Compare</span>
                </button>
                <button type="button" class="ie-tool" data-ie-action="reset" aria-label="Reset all edits" title="Reset image">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.6" /><path d="M4 4v5h5" /></svg>
                  <span>Reset</span>
                </button>
              </div>
            </aside>

            <section class="ie-stage-wrap" aria-label="Image editing canvas">
              <div class="ie-stage" data-ie-stage>
                <div class="ie-cropper" data-ie-cropper></div>
                <div class="ie-compare-layer" data-ie-compare-layer hidden aria-hidden="true">
                  <img data-ie-compare-image alt="Original image" />
                  <span>Original</span>
                </div>
              </div>
              <p class="ie-hint">Drag to reposition · pull the corners to crop</p>
              <div class="ie-loading" data-ie-loading>
                <span class="ie-spinner" aria-hidden="true"></span>
                <strong>Preparing your canvas…</strong>
                <small>Large drawings may take a moment.</small>
              </div>
            </section>

            <aside class="ie-panel" aria-label="Image adjustments">
              <section class="ie-card">
                <h3>View</h3>
                <div class="ie-view-grid" role="group" aria-label="View mode">
                  <button type="button" class="ie-view-btn" data-ie-view="fit">Fit</button>
                  <button type="button" class="ie-view-btn" data-ie-view="fill">Fill</button>
                  <button type="button" class="ie-view-btn" data-ie-view="original">Original</button>
                  <button type="button" class="ie-view-btn" data-ie-view="actual">100%</button>
                  <button type="button" class="ie-view-btn" data-ie-view="center">Center</button>
                </div>
                <div class="ie-position-row">
                  <button type="button" class="ie-position-btn" data-ie-position="h">Center H</button>
                  <button type="button" class="ie-position-btn" data-ie-position="v">Center V</button>
                  <button type="button" class="ie-position-btn" data-ie-position="reset">Reset position</button>
                </div>
              </section>

              <section class="ie-card">
                <h3>Crop shape</h3>
                <div class="ie-ratios" role="group" aria-label="Crop aspect ratio">
                  ${ratioMarkup}
                </div>
              </section>

              <section class="ie-card">
                <h3>Adjustments</h3>
                <label class="ie-control">
                  <span>Brightness <em data-ie-value="brightness">100%</em></span>
                  <input type="range" min="50" max="150" step="1" value="100" data-ie-adjust="brightness" />
                </label>
                <label class="ie-control">
                  <span>Contrast <em data-ie-value="contrast">100%</em></span>
                  <input type="range" min="50" max="150" step="1" value="100" data-ie-adjust="contrast" />
                </label>
                <label class="ie-control">
                  <span>Saturation <em data-ie-value="saturation">100%</em></span>
                  <input type="range" min="0" max="200" step="1" value="100" data-ie-adjust="saturation" />
                </label>
                ${isArtwork ? `
                <label class="ie-control">
                  <span>Sharpness <em data-ie-value="sharpness">0%</em></span>
                  <input type="range" min="0" max="100" step="1" value="0" data-ie-adjust="sharpness" />
                </label>` : ''}
              </section>

              ${isAvatar ? `
              <section class="ie-card ie-avatar-card">
                <h3>Circular preview</h3>
                <div class="ie-avatar-preview">
                  <img data-ie-avatar-preview alt="Circular profile preview" />
                </div>
                <p>Your avatar is shown as a circle across ArtSpace.</p>
              </section>` : isCover ? `
              <section class="ie-card ie-cover-card">
                <h3>Cover previews</h3>
                <div class="ie-cover-preview">
                  <span>Desktop</span>
                  <div class="ie-cover-frame ie-cover-desktop">
                    <img data-ie-cover-desktop alt="Desktop cover preview" />
                  </div>
                </div>
                <div class="ie-cover-preview">
                  <span>Mobile</span>
                  <div class="ie-cover-frame ie-cover-mobile">
                    <img data-ie-cover-mobile alt="Mobile cover preview" />
                  </div>
                </div>
              </section>` : `
              <section class="ie-card">
                <h3>Output size</h3>
                <div class="ie-size-row">
                  <label>
                    <span>Width</span>
                    <input type="number" min="16" step="1" data-ie-size="width" />
                  </label>
                  <label>
                    <span>Height</span>
                    <input type="number" min="16" step="1" data-ie-size="height" />
                  </label>
                </div>
                <label class="ie-lock">
                  <input type="checkbox" data-ie-lock checked />
                  <span>Keep aspect ratio</span>
                </label>
                <p class="ie-note" data-ie-size-note>Original size is never enlarged.</p>
              </section>`}

              <section class="ie-card">
                <h3>Details</h3>
                <dl class="ie-details">
                  <div><dt>Original</dt><dd data-ie-original-size>—</dd></div>
                  <div><dt>Output</dt><dd data-ie-output-size>—</dd></div>
                  <div><dt>File size</dt><dd data-ie-output-bytes>Calculated on preview</dd></div>
                </dl>
                ${isAvatar ? '<p class="ie-note">Capped at 400 px for a lightweight avatar.</p>' : isCover ? '<p class="ie-note">Capped at 1600 × 500 px for the cover slot.</p>' : ''}
                <button type="button" class="ie-secondary-btn" data-ie-action="preview">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.7" /></svg>
                  ${previewLabel}
                </button>
                ${isArtwork ? `
                <button type="button" class="ie-secondary-btn" data-ie-action="download">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m-4-4 4 4 4-4M5 19h14" /></svg>
                  Download edited image
                </button>` : ''}
              </section>
            </aside>
          </div>

          <footer class="ie-foot">
            <p class="ie-foot-note">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.5 7 3v5c0 4.3-2.9 7.3-7 9-4.1-1.7-7-4.7-7-9v-5l7-3Z" /><path d="m9 12 2 2 4-4.5" /></svg>
              Your original file stays untouched until you apply.
            </p>
            <div class="ie-foot-actions">
              <button type="button" class="ie-btn ie-btn-ghost" data-ie-cancel>Cancel</button>
              <button type="button" class="ie-btn ie-btn-soft" data-ie-reset>Reset</button>
              <button type="button" class="ie-btn ie-btn-save" data-ie-save disabled>${applyLabel}</button>
            </div>
          </footer>
        </div>

        <div class="ie-preview" data-ie-preview hidden>
          <div class="ie-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="ie-preview-title">
            <header class="ie-preview-head">
              <h3 id="ie-preview-title">Original vs edited</h3>
              <div class="ie-preview-head-actions">
                ${isAvatar ? '' : `
                <button type="button" class="ie-preview-tool" data-ie-fullscreen aria-label="Toggle fullscreen preview" title="Fullscreen">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4" /></svg>
                </button>`}
                <button type="button" class="ie-preview-tool" data-ie-preview-close aria-label="Close preview">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
                </button>
              </div>
            </header>
            <div class="ie-preview-grid">
              <figure class="ie-preview-figure">
                <div class="ie-preview-frame"><img data-ie-preview-original alt="Original" /></div>
                <figcaption data-ie-preview-original-meta>Original</figcaption>
              </figure>
              <figure class="ie-preview-figure ie-preview-figure-edited">
                <div class="ie-preview-frame"><img data-ie-preview-edited alt="Edited" /></div>
                <figcaption data-ie-preview-edited-meta>Edited</figcaption>
              </figure>
            </div>
            <footer class="ie-preview-foot">
              <button type="button" class="ie-btn ie-btn-ghost" data-ie-preview-back>Back to editing</button>
              <button type="button" class="ie-btn ie-btn-soft" data-ie-preview-download ${isArtwork ? '' : 'hidden'}>Download</button>
            </footer>
          </div>
        </div>

        <div class="ie-error" data-ie-error hidden role="alert">
          <div class="ie-error-card">
            <strong>We could not edit that image.</strong>
            <p data-ie-error-text></p>
            <button type="button" class="ie-btn ie-btn-ghost" data-ie-error-close>Close</button>
          </div>
        </div>
      </div>
    `;
  };

  const open = async (options = {}) => {
    ensureEditorStyle();
    const mode = options.mode === 'avatar' ? 'avatar' : options.mode === 'cover' ? 'cover' : 'artwork';
    const maxBytes = Number(options.maxBytes) || DEFAULT_MAX_BYTES;
    const file = options.file;
    const validationError = validateFile(file, maxBytes);

    if (validationError) {
      const error = new Error(validationError);
      error.userMessage = validationError;
      throw error;
    }

    if (document.querySelector('[data-ie-overlay]')) {
      return null;
    }

    const previousFocus = document.activeElement;
    const holder = document.createElement('div');
    holder.innerHTML = buildMarkup(mode).trim();
    const overlay = holder.firstElementChild;
    document.body.appendChild(overlay);
    overlay.classList.toggle('ie-mode-avatar', mode === 'avatar');
    document.body.classList.add('ie-open');

    const $ = (selector) => overlay.querySelector(selector);
    const $$ = (selector) => [...overlay.querySelectorAll(selector)];

    const dialog = $('.ie-dialog');
    const stage = $('[data-ie-cropper]');
    const loading = $('[data-ie-loading]');
    const errorLayer = $('[data-ie-error]');
    const errorText = $('[data-ie-error-text]');
    const compareLayer = $('[data-ie-compare-layer]');
    const preview = $('[data-ie-preview]');

    const state = {
      mode,
      file,
      ready: false,
      cropper: null,
      sourceEl: null,
      sourceUrl: '',
      originalUrl: URL.createObjectURL(file),
      originalWidth: 0,
      originalHeight: 0,
      workWidth: 0,
      workHeight: 0,
      filters: defaultFilters(),
      aspect: mode === 'avatar' ? 1 : mode === 'cover' ? 16 / 5 : NaN,
      viewMode: mode === 'cover' ? 'fill' : 'fit',
      cropRatio: { x: 0, y: 0, w: 1, h: 1 },
      applyingView: false,
      undo: [],
      redo: [],
      dragSnapshot: null,
      sliderSnapshot: null,
      applying: false,
      resizeTouched: false,
      aspectLocked: true,
      outWidth: 0,
      outHeight: 0,
      naturalCropWidth: 0,
      naturalCropHeight: 0,
      previewDirty: true,
      previewUrl: '',
      editedUrl: '',
      editedBlob: null,
      editedWidth: 0,
      editedHeight: 0,
      busy: false,
      closed: false,
      avatarFrame: 0,
      coverFrame: 0,
      resizeObserver: null,
      resizeFrame: 0,
    };

    let resolveDialog;
    const resultPromise = new Promise((resolve) => { resolveDialog = resolve; });

    const setMeta = (text) => { $('[data-ie-meta]').textContent = text; };

    const close = (result) => {
      if (state.closed) return;
      state.closed = true;
      if (state.avatarFrame) cancelAnimationFrame(state.avatarFrame);
      if (state.coverFrame) cancelAnimationFrame(state.coverFrame);
      if (state.resizeFrame) cancelAnimationFrame(state.resizeFrame);
      if (state.resizeObserver) {
        try { state.resizeObserver.disconnect(); } catch (error) { }
        state.resizeObserver = null;
      }
      if (state.cropper) {
        try { state.cropper.destroy(); } catch (error) { }
        state.cropper = null;
      }
      if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
      if (state.originalUrl) URL.revokeObjectURL(state.originalUrl);
      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
      if (state.editedUrl) URL.revokeObjectURL(state.editedUrl);
      overlay.remove();
      document.body.classList.remove('ie-open');
      if (previousFocus && typeof previousFocus.focus === 'function') {
        try { previousFocus.focus({ preventScroll: true }); } catch (error) { }
      }
      resolveDialog(result || null);
    };

    const showError = (message) => {
      loading.hidden = true;
      errorText.textContent = message || 'Please try another image.';
      errorLayer.hidden = false;
    };

    const cssFilters = () => cssFilter(state.filters);

    const applyFilterPreview = () => {
      if (state.sourceEl) state.sourceEl.style.filter = cssFilters();
      $$('[data-ie-avatar-preview], [data-ie-cover-desktop], [data-ie-cover-mobile]').forEach((image) => {
        image.style.filter = cssFilters();
      });
    };

    const updateSliderLabels = () => {
      Object.keys(state.filters).forEach((key) => {
        const label = $(`[data-ie-value="${key}"]`);
        if (label) label.textContent = `${state.filters[key]}%`;
        const input = $(`[data-ie-adjust="${key}"]`);
        if (input) input.value = String(state.filters[key]);
      });
    };

    const updateDetails = () => {
      $('[data-ie-original-size]').textContent = formatDimensions(state.originalWidth, state.originalHeight);
      $('[data-ie-output-size]').textContent = state.outWidth && state.outHeight
        ? formatDimensions(state.outWidth, state.outHeight)
        : '—';
      const bytes = $('[data-ie-output-bytes]');
      if (bytes) bytes.textContent = state.editedBlob ? formatBytes(state.editedBlob.size) : 'Calculated on preview';
    };

    const capture = () => ({
      data: state.cropper ? state.cropper.getData(true) : null,
      filters: { ...state.filters },
      aspect: state.aspect,
      outWidth: state.outWidth,
      outHeight: state.outHeight,
      resizeTouched: state.resizeTouched,
      aspectLocked: state.aspectLocked,
    });

    const sameSnapshot = (a, b) => {
      if (!a || !b) return false;
      return JSON.stringify(a) === JSON.stringify(b);
    };

    const syncHistoryButtons = () => {
      const undoButton = $('[data-ie-action="undo"]');
      const redoButton = $('[data-ie-action="redo"]');
      if (undoButton) undoButton.disabled = state.undo.length === 0;
      if (redoButton) redoButton.disabled = state.redo.length === 0;
    };

    const pushUndo = (snapshot) => {
      const entry = snapshot || capture();
      if (!entry.data) return;
      state.undo.push(entry);
      if (state.undo.length > HISTORY_LIMIT) state.undo.shift();
      state.redo.length = 0;
      syncHistoryButtons();
    };

    const restore = (snapshot) => {
      if (!snapshot || !snapshot.data || !state.cropper) return;
      state.applying = true;
      state.aspect = snapshot.aspect;
      state.filters = { ...snapshot.filters };
      state.resizeTouched = snapshot.resizeTouched;
      state.aspectLocked = snapshot.aspectLocked;
      state.outWidth = snapshot.outWidth;
      state.outHeight = snapshot.outHeight;
      try {
        state.cropper.setAspectRatio(Number.isNaN(state.aspect) ? NaN : state.aspect);
        state.cropper.setData(snapshot.data);
      } catch (error) { }
      state.applying = false;
      updateSliderLabels();
      syncRatioButtons();
      applyFilterPreview();
      syncSizeInputs();
      state.cropRatio = captureCropRatio();
      updateOutputFromCrop();
      updateDetails();
      if (state.viewMode !== 'custom') applyViewMode(state.viewMode);
      scheduleAvatarPreview();
      scheduleCoverPreview();
      markPreviewDirty();
    };

    const parseRatio = (value) => {
      if (value === 'free') return NaN;
      if (String(value).includes(':')) {
        const [width, height] = String(value).split(':').map(Number);
        return width && height ? width / height : NaN;
      }
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : NaN;
    };

    const syncRatioButtons = () => {
      $$('[data-ie-ratio]').forEach((button) => {
        const value = parseRatio(button.dataset.ieRatio);
        const active = Number.isNaN(value) ? Number.isNaN(state.aspect) : value === state.aspect;
        button.classList.toggle('is-active', active);
      });
    };

    const syncViewButtons = () => {
      $$('[data-ie-view]').forEach((button) => {
        button.classList.toggle('is-active', button.dataset.ieView === state.viewMode);
      });
    };

    const markCustomView = () => {
      if (state.viewMode === 'custom') return;
      state.viewMode = 'custom';
      syncViewButtons();
    };

    const getViewCanvas = () => state.cropper.getCanvasData();

    const captureCropRatio = () => {
      const canvas = getViewCanvas();
      const crop = state.cropper.getCropBoxData();
      if (!canvas.width || !canvas.height) return { x: 0, y: 0, w: 1, h: 1 };
      return {
        x: (crop.left - canvas.left) / canvas.width,
        y: (crop.top - canvas.top) / canvas.height,
        w: crop.width / canvas.width,
        h: crop.height / canvas.height,
      };
    };

    const restoreCropRatio = (ratio) => {
      const canvas = getViewCanvas();
      state.applyingView = true;
      try {
        state.cropper.setCropBoxData({
          left: canvas.left + ratio.x * canvas.width,
          top: canvas.top + ratio.y * canvas.height,
          width: ratio.w * canvas.width,
          height: ratio.h * canvas.height,
        });
      } catch (error) { }
      state.applyingView = false;
    };

    const setViewScale = (scale, anchor = 'crop') => {
      if (!state.cropper) return;
      const canvas = getViewCanvas();
      const container = state.cropper.getContainerData();
      const target = anchor === 'container'
        ? { left: 0, top: 0, width: container.width, height: container.height }
        : state.cropper.getCropBoxData();
      const width = Math.max(1, canvas.naturalWidth * scale);
      const height = Math.max(1, canvas.naturalHeight * scale);
      const centerX = target.left + target.width / 2;
      const centerY = target.top + target.height / 2;
      state.applyingView = true;
      try {
        state.cropper.setCanvasData({
          left: centerX - width / 2,
          top: centerY - height / 2,
          width,
          height,
        });
      } catch (error) { }
      state.applyingView = false;
    };

    const centerImage = (axis) => {
      if (!state.cropper) return;
      const canvas = getViewCanvas();
      const crop = state.cropper.getCropBoxData();
      const left = axis === 'v' ? canvas.left : crop.left + (crop.width - canvas.width) / 2;
      const top = axis === 'h' ? canvas.top : crop.top + (crop.height - canvas.height) / 2;
      state.applyingView = true;
      try {
        state.cropper.setCanvasData({ left, top, width: canvas.width, height: canvas.height });
      } catch (error) { }
      state.applyingView = false;
    };

    const centerCanvasInContainer = () => {
      if (!state.cropper) return;
      const canvas = getViewCanvas();
      const container = state.cropper.getContainerData();
      state.applyingView = true;
      try {
        state.cropper.setCanvasData({
          left: (container.width - canvas.width) / 2,
          top: (container.height - canvas.height) / 2,
          width: canvas.width,
          height: canvas.height,
        });
      } catch (error) { }
      state.applyingView = false;
    };

    const applyViewMode = (mode, options = {}) => {
      if (!state.cropper) return;
      const container = state.cropper.getContainerData();
      const canvas = getViewCanvas();
      const naturalWidth = Math.max(1, canvas.naturalWidth);
      const naturalHeight = Math.max(1, canvas.naturalHeight);
      const fitStage = Math.min(container.width / naturalWidth, container.height / naturalHeight);
      const fillCrop = Math.max(
        state.cropper.getCropBoxData().width / naturalWidth,
        state.cropper.getCropBoxData().height / naturalHeight
      );

      if (mode === 'fit') {
        const ratio = options.storedRatio ? state.cropRatio : captureCropRatio();
        setViewScale(fitStage, 'container');
        restoreCropRatio(ratio);
      } else if (mode === 'fill') {
        setViewScale(fillCrop);
      } else if (mode === 'original') {
        setViewScale(Math.min(1, fitStage), 'container');
      } else if (mode === 'actual') {
        setViewScale(1, 'container');
      } else if (mode === 'center') {
        centerCanvasInContainer();
      }

      state.cropRatio = captureCropRatio();
      state.viewMode = mode;
      syncViewButtons();
      updateOutputFromCrop();
      scheduleAvatarPreview();
      scheduleCoverPreview();
    };

    const updateCoverPreview = () => {
      if (state.mode !== 'cover' || !state.cropper) return;
      const desktop = $('[data-ie-cover-desktop]');
      const mobile = $('[data-ie-cover-mobile]');
      if (!desktop && !mobile) return;
      try {
        const data = state.cropper.getData(true);
        if (!data.width || !data.height) return;
        const frame = state.cropper.getCroppedCanvas({
          maxWidth: 480,
          maxHeight: 480,
          imageSmoothingEnabled: true,
          imageSmoothingQuality: 'medium',
          fillColor: 'rgba(0,0,0,0)',
        });
        if (!frame) return;
        const url = frame.toDataURL('image/png');
        [desktop, mobile].forEach((image) => {
          if (!image) return;
          image.src = url;
          image.style.filter = cssFilters();
        });
      } catch (error) { }
    };

    const scheduleCoverPreview = () => {
      if (state.mode !== 'cover' || !state.cropper || state.coverFrame) return;
      state.coverFrame = requestAnimationFrame(() => {
        state.coverFrame = 0;
        updateCoverPreview();
      });
    };

    const syncSizeInputs = () => {
      const widthInput = $('[data-ie-size="width"]');
      const heightInput = $('[data-ie-size="height"]');
      if (!widthInput || !heightInput) return;
      widthInput.max = String(Math.max(16, state.naturalCropWidth));
      heightInput.max = String(Math.max(16, state.naturalCropHeight));
      if (Number(widthInput.value) !== state.outWidth) widthInput.value = String(state.outWidth);
      if (Number(heightInput.value) !== state.outHeight) heightInput.value = String(state.outHeight);
      const note = $('[data-ie-size-note]');
      if (note) note.textContent = `Max ${formatDimensions(state.naturalCropWidth, state.naturalCropHeight)} · never enlarged`;
    };

    const updateOutputFromCrop = () => {
      if (!state.cropper || state.applying) return;
      const data = state.cropper.getData(true);
      const naturalWidth = Math.max(1, Math.round(data.width));
      const naturalHeight = Math.max(1, Math.round(data.height));
      state.naturalCropWidth = naturalWidth;
      state.naturalCropHeight = naturalHeight;
      if (!state.resizeTouched) {
        if (state.mode === 'avatar') {
          const maxSide = Math.max(naturalWidth, naturalHeight);
          const scale = Math.min(1, 400 / maxSide);
          state.outWidth = Math.max(1, Math.round(naturalWidth * scale));
          state.outHeight = Math.max(1, Math.round(naturalHeight * scale));
        } else if (state.mode === 'cover') {
          const scale = Math.min(1, 1600 / naturalWidth, 500 / naturalHeight);
          state.outWidth = Math.max(1, Math.round(naturalWidth * scale));
          state.outHeight = Math.max(1, Math.round(naturalHeight * scale));
        } else {
          state.outWidth = naturalWidth;
          state.outHeight = naturalHeight;
        }
      } else {
        state.outWidth = Math.min(Math.max(16, state.outWidth || naturalWidth), naturalWidth);
        state.outHeight = Math.min(Math.max(16, state.outHeight || naturalHeight), naturalHeight);
      }
      syncSizeInputs();
      updateDetails();
      markPreviewDirty();
    };

    const markPreviewDirty = () => {
      state.previewDirty = true;
      if (state.editedUrl) {
        URL.revokeObjectURL(state.editedUrl);
        state.editedUrl = '';
        state.editedBlob = null;
      }
    };

    const scheduleAvatarPreview = () => {
      if (state.mode !== 'avatar' || !state.cropper || state.avatarFrame) return;
      state.avatarFrame = requestAnimationFrame(() => {
        state.avatarFrame = 0;
        try {
          const data = state.cropper.getData(true);
          if (!data.width || !data.height) return;
          const frame = state.cropper.getCroppedCanvas({
            maxWidth: 240,
            maxHeight: 240,
            imageSmoothingEnabled: true,
            imageSmoothingQuality: 'medium',
            fillColor: 'rgba(0,0,0,0)',
          });
          if (!frame) return;
          const avatarImage = $('[data-ie-avatar-preview]');
          if (avatarImage) {
            avatarImage.src = frame.toDataURL('image/png');
            avatarImage.style.filter = cssFilters();
          }
        } catch (error) { }
      });
    };

    const runTransform = (action) => {
      if (!state.cropper) return;
      pushUndo();
      state.applying = true;
      try {
        if (action === 'rotate-left') state.cropper.rotate(-90);
        else if (action === 'rotate-right') state.cropper.rotate(90);
        else if (action === 'flip-h') {
          const data = state.cropper.getData(true);
          state.cropper.scaleX((data.scaleX || 1) * -1);
        } else if (action === 'flip-v') {
          const data = state.cropper.getData(true);
          state.cropper.scaleY((data.scaleY || 1) * -1);
        } else if (action === 'zoom-in') state.cropper.zoom(0.08);
        else if (action === 'zoom-out') state.cropper.zoom(-0.08);
      } catch (error) { }
      state.applying = false;
      if (action === 'zoom-in' || action === 'zoom-out') markCustomView();
      if (action === 'rotate-left' || action === 'rotate-right' || action === 'flip-h' || action === 'flip-v') {
        state.cropRatio = captureCropRatio();
        if (state.viewMode !== 'custom') applyViewMode(state.viewMode);
      }
      updateOutputFromCrop();
      scheduleAvatarPreview();
      scheduleCoverPreview();
    };

    const resetAll = () => {
      if (!state.cropper) return;
      pushUndo();
      const defaultAspect = state.mode === 'avatar' ? 1 : state.mode === 'cover' ? 16 / 5 : NaN;
      state.applying = true;
      try {
        state.cropper.reset();
        state.cropper.setAspectRatio(defaultAspect);
      } catch (error) { }
      state.aspect = defaultAspect;
      state.viewMode = state.mode === 'cover' ? 'fill' : 'fit';
      state.filters = defaultFilters();
      state.resizeTouched = false;
      state.aspectLocked = true;
      const lock = $('[data-ie-lock]');
      if (lock) lock.checked = true;
      state.applying = false;
      updateSliderLabels();
      syncRatioButtons();
      applyFilterPreview();
      state.cropRatio = captureCropRatio();
      updateOutputFromCrop();
      applyViewMode(state.viewMode);
      scheduleAvatarPreview();
      scheduleCoverPreview();
      markPreviewDirty();
    };

    const undo = () => {
      if (!state.undo.length) return;
      const current = capture();
      const snapshot = state.undo.pop();
      state.redo.push(current);
      restore(snapshot);
      syncHistoryButtons();
    };

    const redo = () => {
      if (!state.redo.length) return;
      const current = capture();
      const snapshot = state.redo.pop();
      state.undo.push(current);
      restore(snapshot);
      syncHistoryButtons();
    };

    const setAspect = (value) => {
      if (!state.cropper) return;
      pushUndo();
      state.applying = true;
      state.aspect = value;
      try {
        state.cropper.setAspectRatio(Number.isNaN(value) ? NaN : value);
      } catch (error) { }
      state.applying = false;
      syncRatioButtons();
      state.cropRatio = captureCropRatio();
      updateOutputFromCrop();
      if (state.viewMode !== 'custom') applyViewMode(state.viewMode);
      scheduleAvatarPreview();
      scheduleCoverPreview();
    };

    const exportEdited = async () => {
      if (!state.cropper) throw new Error('The editor is not ready yet.');

      const data = state.cropper.getData(true);
      const naturalWidth = Math.max(1, Math.round(data.width));
      const naturalHeight = Math.max(1, Math.round(data.height));
      let width = state.resizeTouched ? Math.round(state.outWidth) : naturalWidth;
      let height = state.resizeTouched ? Math.round(state.outHeight) : naturalHeight;

      if (state.mode === 'avatar' && !state.resizeTouched) {
        const maxSide = Math.max(naturalWidth, naturalHeight);
        const scale = Math.min(1, 400 / maxSide);
        width = Math.max(1, Math.round(naturalWidth * scale));
        height = Math.max(1, Math.round(naturalHeight * scale));
      } else if (state.mode === 'cover' && !state.resizeTouched) {
        const scale = Math.min(1, 1600 / naturalWidth, 500 / naturalHeight);
        width = Math.max(1, Math.round(naturalWidth * scale));
        height = Math.max(1, Math.round(naturalHeight * scale));
      }

      width = Math.min(Math.max(16, width || naturalWidth), naturalWidth);
      height = Math.min(Math.max(16, height || naturalHeight), naturalHeight);

      const cropped = state.cropper.getCroppedCanvas({
        width,
        height,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
        fillColor: 'rgba(0,0,0,0)',
      });

      if (!cropped) throw new Error('We could not prepare that image. Try a smaller file.');

      const filters = state.filters;
      const needsFilters = filters.brightness !== 100 || filters.contrast !== 100 || filters.saturation !== 100;
      const needsSharpen = state.mode !== 'avatar' && filters.sharpness > 0;
      let canvas = cropped;

      if (needsFilters || needsSharpen) {
        canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('This browser cannot process images right now.');
        if (contextSupportsFilter) context.filter = cssFilters();
        context.drawImage(cropped, 0, 0, width, height);
        if (!contextSupportsFilter && needsFilters) applyPixelFilters(context, width, height, filters);
        if (needsSharpen) applySharpen(context, width, height, filters.sharpness);
        context.filter = 'none';
      }

      let blob = null;
      try {
        blob = await canvasToBlob(canvas, 'image/webp', state.mode === 'avatar' ? 0.9 : 0.92);
      } catch (error) {
        blob = null;
      }

      if (!blob) {
        try {
          blob = await canvasToBlob(canvas, 'image/png', undefined);
        } catch (error) {
          blob = dataUrlToBlob(canvas.toDataURL('image/png'));
        }
      }

      if (!blob) throw new Error('We could not prepare that image. Try a smaller file.');

      return { blob, width, height };
    };

    const buildEditedFile = (blob) => {
      const base = String(state.file.name || 'artwork').replace(/\.[^.]+$/, '');
      const extension = blob.type === 'image/png' ? 'png' : 'webp';
      return new File([blob], `${base}-edited.${extension}`, {
        type: blob.type || 'image/webp',
        lastModified: Date.now(),
      });
    };

    const ensureEdited = async () => {
      if (state.editedBlob && !state.previewDirty) {
        return {
          blob: state.editedBlob,
          url: state.editedUrl,
          width: state.editedWidth,
          height: state.editedHeight,
        };
      }
      const result = await exportEdited();
      if (state.editedUrl) URL.revokeObjectURL(state.editedUrl);
      state.editedBlob = result.blob;
      state.editedWidth = result.width;
      state.editedHeight = result.height;
      state.editedUrl = URL.createObjectURL(result.blob);
      state.previewDirty = false;
      updateDetails();
      return {
        blob: result.blob,
        url: state.editedUrl,
        width: result.width,
        height: result.height,
      };
    };

    const openPreview = async () => {
      try {
        const result = await ensureEdited();
        $('[data-ie-preview-original]').src = state.originalUrl;
        $('[data-ie-preview-edited]').src = result.url;
        $('[data-ie-preview-original-meta]').textContent = `Original · ${formatDimensions(state.originalWidth, state.originalHeight)} · ${formatBytes(state.file.size)}`;
        $('[data-ie-preview-edited-meta]').textContent = `Edited · ${formatDimensions(result.width, result.height)} · ${formatBytes(result.blob.size)}`;
        preview.hidden = false;
        preview.classList.remove('is-fullscreen');
        requestAnimationFrame(() => preview.classList.add('is-visible'));
      } catch (error) {
        showError(error.message || 'We could not preview that image.');
      }
    };

    const closePreview = () => {
      preview.classList.remove('is-visible', 'is-fullscreen');
      window.setTimeout(() => { preview.hidden = true; }, 180);
    };

    const downloadEdited = async () => {
      try {
        const result = await ensureEdited();
        const link = document.createElement('a');
        const base = String(state.file.name || 'artwork').replace(/\.[^.]+$/, '');
        link.href = result.url;
        link.download = `${base}-edited.${result.blob.type === 'image/png' ? 'png' : 'webp'}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      } catch (error) {
        showError(error.message || 'We could not prepare that download.');
      }
    };

    const save = async () => {
      if (state.busy || !state.ready) return;
      state.busy = true;
      const button = $('[data-ie-save]');
      const originalLabel = button.textContent;
      button.disabled = true;
      button.textContent = 'Applying…';
      try {
        const result = await ensureEdited();
        close(buildEditedFile(result.blob));
      } catch (error) {
        state.busy = false;
        button.disabled = false;
        button.textContent = originalLabel;
        showError(error.message || 'We could not save those edits.');
      }
    };

    const initCropper = ({ sourceEl, originalWidth, originalHeight, workWidth, workHeight, checkOrientation }) => {
      state.sourceEl = sourceEl;
      state.originalWidth = originalWidth;
      state.originalHeight = originalHeight;
      state.workWidth = workWidth;
      state.workHeight = workHeight;

      $('[data-ie-compare-image]').src = state.originalUrl;
      setMeta(`${file.name} · ${formatDimensions(originalWidth, originalHeight)} · ${formatBytes(file.size)}`);

      stage.appendChild(sourceEl);

      state.cropper = new window.Cropper(sourceEl, {
        aspectRatio: state.mode === 'avatar' ? 1 : state.mode === 'cover' ? 16 / 5 : NaN,
        viewMode: 1,
        dragMode: 'move',
        autoCropArea: 1,
        responsive: true,
        restore: false,
        checkOrientation: Boolean(checkOrientation),
        background: false,
        modal: true,
        guides: true,
        center: true,
        highlight: false,
        cropBoxMovable: true,
        cropBoxResizable: true,
        toggleDragModeOnDblclick: false,
        ready: () => {
          state.ready = true;
          loading.hidden = true;
          dialog.classList.add('is-ready');
          const saveButton = $('[data-ie-save]');
          if (saveButton) saveButton.disabled = false;
          updateSliderLabels();
          syncRatioButtons();
          applyFilterPreview();
          state.cropRatio = captureCropRatio();
          updateOutputFromCrop();
          updateDetails();
          applyViewMode(state.viewMode);
          scheduleAvatarPreview();
          scheduleCoverPreview();
          syncViewButtons();
          syncHistoryButtons();
          window.setTimeout(() => $('[data-ie-save]').focus({ preventScroll: true }), 60);
        },
        cropstart: (event) => {
          if (state.applyingView) return;
          const target = event.originalEvent?.target;
          if (!state.applyingView && target instanceof Element && target.closest('.cropper-face')) {
            markCustomView();
          }
          if (!state.dragSnapshot) state.dragSnapshot = capture();
        },
        cropend: () => {
          if (state.applying || state.applyingView) return;
          if (state.dragSnapshot) {
            const after = capture();
            if (!sameSnapshot(state.dragSnapshot, after)) pushUndo(state.dragSnapshot);
            state.dragSnapshot = null;
          }
          state.cropRatio = captureCropRatio();
          updateOutputFromCrop();
          scheduleAvatarPreview();
          scheduleCoverPreview();
        },
        crop: () => {
          scheduleAvatarPreview();
          scheduleCoverPreview();
        },
        zoom: (event) => {
          if (!state.applyingView && event.originalEvent) markCustomView();
          scheduleAvatarPreview();
          scheduleCoverPreview();
        },
      });

      sourceEl.style.filter = cssFilters();

      if ('ResizeObserver' in window) {
        state.resizeObserver = new ResizeObserver(() => {
          if (!state.ready || state.applyingView || state.closed) return;
          if (state.viewMode === 'custom') return;
          if (state.resizeFrame) return;
          state.resizeFrame = requestAnimationFrame(() => {
            state.resizeFrame = 0;
            applyViewMode(state.viewMode, { storedRatio: true });
          });
        });
        state.resizeObserver.observe(stage);
      }
    };

    const prepareSource = async () => {
      const drawScaledCanvas = (drawable, width, height) => {
        const scale = Math.min(1, MAX_WORK_SIZE / Math.max(width, height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('This browser cannot process images right now.');
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(drawable, 0, 0, canvas.width, canvas.height);
        return canvas;
      };

      let bitmap = null;
      try {
        if ('createImageBitmap' in window) {
          bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        }
      } catch (error) {
        bitmap = null;
      }

      if (bitmap) {
        const width = bitmap.width;
        const height = bitmap.height;
        if (!width || !height) {
          bitmap.close?.();
          throw new Error('That image has no readable dimensions.');
        }
        const canvas = drawScaledCanvas(bitmap, width, height);
        bitmap.close?.();
        initCropper({
          sourceEl: canvas,
          originalWidth: width,
          originalHeight: height,
          workWidth: canvas.width,
          workHeight: canvas.height,
          checkOrientation: false,
        });
        return;
      }

      const loaded = await loadImageElement(file);
      const width = loaded.image.naturalWidth;
      const height = loaded.image.naturalHeight;

      if (!width || !height) {
        URL.revokeObjectURL(loaded.url);
        throw new Error('That image has no readable dimensions.');
      }

      const scale = Math.min(1, MAX_WORK_SIZE / Math.max(width, height));

      if (scale < 1) {
        const canvas = drawScaledCanvas(loaded.image, width, height);
        URL.revokeObjectURL(loaded.url);
        initCropper({
          sourceEl: canvas,
          originalWidth: width,
          originalHeight: height,
          workWidth: canvas.width,
          workHeight: canvas.height,
          checkOrientation: false,
        });
        return;
      }

      state.sourceUrl = loaded.url;
      initCropper({
        sourceEl: loaded.image,
        originalWidth: width,
        originalHeight: height,
        workWidth: width,
        workHeight: height,
        checkOrientation: true,
      });
    };

    const bindEvents = () => {
      $('[data-ie-close]').addEventListener('click', () => close(null));
      $('[data-ie-cancel]').addEventListener('click', () => close(null));
      $('[data-ie-error-close]').addEventListener('click', () => close(null));
      $('[data-ie-save]').addEventListener('click', save);
      $('[data-ie-reset]').addEventListener('click', resetAll);

      $$('[data-ie-action]').forEach((button) => {
        button.addEventListener('click', () => {
          const action = button.dataset.ieAction;
          if (action === 'undo') undo();
          else if (action === 'redo') redo();
          else if (action === 'preview') openPreview();
          else if (action === 'download') downloadEdited();
          else if (action === 'reset') resetAll();
          else if (action === 'compare') return;
          else runTransform(action);
        });
      });

      $$('[data-ie-ratio]').forEach((button) => {
        button.addEventListener('click', () => {
          setAspect(parseRatio(button.dataset.ieRatio));
        });
      });

      $$('[data-ie-view]').forEach((button) => {
        button.addEventListener('click', () => applyViewMode(button.dataset.ieView));
      });

      $$('[data-ie-position]').forEach((button) => {
        button.addEventListener('click', () => {
          const position = button.dataset.iePosition;
          if (position === 'reset') {
            applyViewMode(state.mode === 'cover' ? 'fill' : 'fit');
            return;
          }
          centerImage(position);
          markCustomView();
          scheduleAvatarPreview();
          scheduleCoverPreview();
        });
      });

      $$('[data-ie-adjust]').forEach((input) => {
        const key = input.dataset.ieAdjust;
        input.addEventListener('pointerdown', () => {
          if (!state.sliderSnapshot) state.sliderSnapshot = capture();
        });
        input.addEventListener('input', () => {
          if (!state.sliderSnapshot) state.sliderSnapshot = capture();
          const value = Number(input.value);
          state.filters[key] = value;
          const label = $(`[data-ie-value="${key}"]`);
          if (label) label.textContent = `${value}%`;
          applyFilterPreview();
          markPreviewDirty();
        });
        input.addEventListener('change', () => {
          if (state.sliderSnapshot && !sameSnapshot(state.sliderSnapshot, capture())) {
            pushUndo(state.sliderSnapshot);
          }
          state.sliderSnapshot = null;
          scheduleAvatarPreview();
        });
      });

      const widthInput = $('[data-ie-size="width"]');
      const heightInput = $('[data-ie-size="height"]');
      const lock = $('[data-ie-lock]');

      const applySize = (source) => {
        if (!state.cropper) return;
        const ratio = state.naturalCropWidth / state.naturalCropHeight || 1;
        let width = Math.round(Number(widthInput.value) || state.naturalCropWidth);
        let height = Math.round(Number(heightInput.value) || state.naturalCropHeight);
        width = Math.min(Math.max(16, width), state.naturalCropWidth);
        height = Math.min(Math.max(16, height), state.naturalCropHeight);

        if (source === 'width' && state.aspectLocked) {
          height = Math.min(state.naturalCropHeight, Math.max(16, Math.round(width / ratio)));
        } else if (source === 'height' && state.aspectLocked) {
          width = Math.min(state.naturalCropWidth, Math.max(16, Math.round(height * ratio)));
        }

        state.resizeTouched = true;
        state.outWidth = width;
        state.outHeight = height;
        widthInput.value = String(width);
        heightInput.value = String(height);
        updateDetails();
        markPreviewDirty();
      };

      if (widthInput) {
        widthInput.addEventListener('input', () => applySize('width'));
        widthInput.addEventListener('change', () => applySize('width'));
      }
      if (heightInput) {
        heightInput.addEventListener('input', () => applySize('height'));
        heightInput.addEventListener('change', () => applySize('height'));
      }
      if (lock) {
        lock.addEventListener('change', () => {
          state.aspectLocked = lock.checked;
          if (state.aspectLocked) applySize('width');
        });
      }

      const compareButton = $('[data-ie-action="compare"]');
      const showCompare = (visible) => { compareLayer.hidden = !visible; };
      compareButton.addEventListener('pointerdown', () => showCompare(true));
      compareButton.addEventListener('pointerup', () => showCompare(false));
      compareButton.addEventListener('pointerleave', () => showCompare(false));
      compareButton.addEventListener('pointercancel', () => showCompare(false));
      compareButton.addEventListener('keydown', (event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          showCompare(true);
        }
      });
      compareButton.addEventListener('keyup', () => showCompare(false));

      $('[data-ie-preview-close]').addEventListener('click', closePreview);
      $('[data-ie-preview-back]').addEventListener('click', closePreview);
      $('[data-ie-preview-download]').addEventListener('click', downloadEdited);
      $('[data-ie-fullscreen]')?.addEventListener('click', () => {
        preview.classList.toggle('is-fullscreen');
      });

      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close(null);
      });

      overlay.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          if (!preview.hidden) closePreview();
          else close(null);
          return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
          event.preventDefault();
          if (event.shiftKey) redo();
          else undo();
          return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
          event.preventDefault();
          redo();
          return;
        }

        if (event.key !== 'Tab') return;
        const focusables = $$('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')
          .filter((element) => element.getClientRects().length > 0 && !element.closest('[hidden]'));
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      });

      const handleNavigation = () => close(null);
      window.addEventListener('artspace:navigation', handleNavigation);
      window.addEventListener('popstate', handleNavigation);
      const cleanup = () => {
        window.removeEventListener('artspace:navigation', handleNavigation);
        window.removeEventListener('popstate', handleNavigation);
      };
      resultPromise.then(cleanup);
    };

    bindEvents();
    updateDetails();
    loading.hidden = false;

    try {
      await loadCropper();
      if (state.closed) return resultPromise;
      await prepareSource();
    } catch (error) {
      showError(error.userMessage || error.message);
    }

    return resultPromise;
  };

  window.ArtSpaceImageEditor = { open };
})();
