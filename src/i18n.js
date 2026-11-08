'use strict';

const fs = require('fs');
const path = require('path');

const SUPPORTED = ['km', 'en'];
const DEFAULT_LOCALE = 'km';
const LOCALE_COOKIE = 'artspace-locale';
const ONE_YEAR = 365 * 24 * 60 * 60 * 1000;

const entityMap = {
  '&amp;': '&',
  '&mdash;': '—',
  '&ndash;': '–',
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&ldquo;': '“',
  '&rdquo;': '”',
  '&hellip;': '…',
  '&nbsp;': ' ',
  '&middot;': '·',
  '&nearr;': '↗',
  '&larr;': '←',
  '&rarr;': '→',
  '&times;': '×',
  '&#8627;': '↳',
  '&#10022;': '✦',
  '&copy;': '©',
  '&quot;': '"',
  '&#39;': "'"
};

const monthMap = {
  Jan: 'មករា',
  Feb: 'កុម្ភៈ',
  Mar: 'មីនា',
  Apr: 'មេសា',
  May: 'ឧសភា',
  Jun: 'មិថុនា',
  Jul: 'កក្កដា',
  Aug: 'សីហា',
  Sep: 'កញ្ញា',
  Oct: 'តុលា',
  Nov: 'វិច្ឆិកា',
  Dec: 'ធ្នូ'
};

function loadLocale(locale) {
  const file = path.join(__dirname, '..', 'locales', `${locale}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return { phrases: {}, patterns: [] };
  }
}

const localeData = {
  km: loadLocale('km'),
  en: loadLocale('en')
};

const kmPhrases = localeData.km.phrases || {};
const kmPatterns = (localeData.km.patterns || []).map((pattern) => ({
  regex: new RegExp(pattern.en, 'u'),
  value: pattern.km
}));

function decodeEntities(value) {
  return String(value || '').replace(/&[a-zA-Z#0-9]+;/g, (entity) => (
    Object.prototype.hasOwnProperty.call(entityMap, entity) ? entityMap[entity] : entity
  ));
}

function normalize(value) {
  return decodeEntities(value).replace(/\s+/g, ' ').trim();
}

function translateMonths(value) {
  return value.replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g, (month) => monthMap[month] || month);
}

function lookupPhrase(value) {
  if (!value) return '';
  if (Object.prototype.hasOwnProperty.call(kmPhrases, value)) return kmPhrases[value];

  const segments = value.split(' · ');
  if (segments.length > 1) {
    let changed = false;
    const translatedSegments = segments.map((segment) => {
      if (Object.prototype.hasOwnProperty.call(kmPhrases, segment)) {
        changed = true;
        return kmPhrases[segment];
      }
      for (const pattern of kmPatterns) {
        if (!pattern.regex.test(segment)) continue;
        changed = true;
        return translateMonths(segment.replace(pattern.regex, pattern.value));
      }
      const months = translateMonths(segment);
      if (months !== segment) changed = true;
      return months;
    });
    if (changed) return translatedSegments.join(' · ');
  }

  for (const pattern of kmPatterns) {
    if (!pattern.regex.test(value)) continue;
    return translateMonths(value.replace(pattern.regex, pattern.value));
  }

  const withMonths = translateMonths(value);
  if (withMonths !== value) return withMonths;
  return '';
}

function translateText(value) {
  const match = String(value || '').match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!match || !match[2]) return value;
  const core = normalize(match[2]);
  if (!core) return value;
  const translated = lookupPhrase(core);
  if (!translated || translated === core) return value;
  return `${match[1]}${translated}${match[3]}`;
}

function translateAttributeValue(value) {
  const core = normalize(value);
  if (!core) return value;
  const translated = lookupPhrase(core);
  return translated || value;
}

function translateConfirmMessages(tag) {
  return tag.replace(/confirm\((['"])([\s\S]*?)\1\)/g, (full, quote, message) => {
    const translated = translateAttributeValue(message);
    if (translated === message) return full;
    return `confirm(${quote}${translated.replace(new RegExp(quote, 'g'), `\\${quote}`)}${quote})`;
  });
}

function translateTag(tag) {
  let output = tag;
  output = output.replace(/(\s(?:placeholder|title|aria-label|alt)=)(["'])([\s\S]*?)\2/g, (full, prefix, quote, value) => {
    const translated = translateAttributeValue(value);
    if (translated === value) return full;
    return `${prefix}${quote}${translated.replace(new RegExp(quote, 'g'), `\\${quote}`)}${quote}`;
  });
  return translateConfirmMessages(output);
}

function translateMetaDescription(html) {
  return html.replace(/(<meta\s+name=["']description["']\s+content=["'])([\s\S]*?)(["'])/i, (full, start, value, end) => {
    const translated = translateAttributeValue(value);
    if (translated === value) return full;
    return `${start}${translated}${end}`;
  });
}

function translateHtml(html, locale = DEFAULT_LOCALE) {
  if (locale !== 'km' || typeof html !== 'string' || !html) return html;

  let output = '';
  let index = 0;
  let skipTag = '';

  while (index < html.length) {
    const tagStart = html.indexOf('<', index);
    if (tagStart === -1) {
      output += translateText(html.slice(index));
      break;
    }

    if (tagStart > index) output += translateText(html.slice(index, tagStart));

    let cursor = tagStart + 1;
    let quote = '';
    while (cursor < html.length) {
      const character = html[cursor];
      if (quote) {
        if (character === quote) quote = '';
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        break;
      }
      cursor += 1;
    }

    const tag = html.slice(tagStart, cursor + 1);
    const tagMatch = tag.match(/^<\/?\s*([a-zA-Z0-9:-]+)/);
    const tagName = tagMatch ? tagMatch[1].toLowerCase() : '';
    const closing = /^<\//.test(tag);

    if (skipTag) {
      output += tag;
      if (closing && tagName === skipTag) skipTag = '';
      index = cursor + 1;
      continue;
    }

    if (!closing && tagName) {
      const fullMatch = tag.match(/\sdata-i18n-full=(["'])([\s\S]*?)\1/);
      if (fullMatch) {
        const translated = translateAttributeValue(fullMatch[2]);
        if (translated !== fullMatch[2]) {
          const closeIndex = html.indexOf(`</${tagName}>`, cursor + 1);
          if (closeIndex !== -1) {
            output += translateTag(tag) + translated;
            index = closeIndex;
            continue;
          }
        }
      }
    }

    if (!closing && tagName && /\sdata-(?:i18n-km|i18n-skip)(?:\s|=|>)/.test(tag)) {
      if (/\/>$/.test(tag) || ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'].includes(tagName)) {
        output += tag;
        index = cursor + 1;
        continue;
      }
      const closeTag = `</${tagName}>`;
      const closeIndex = html.indexOf(closeTag, cursor + 1);
      if (closeIndex !== -1) {
        output += tag + html.slice(cursor + 1, closeIndex) + closeTag;
        index = closeIndex + closeTag.length;
        continue;
      }
    }

    if (!closing && ['script', 'style', 'textarea', 'pre', 'code'].includes(tagName)) {
      output += tag;
      skipTag = tagName;
      index = cursor + 1;
      continue;
    }

    output += translateTag(tag);
    index = cursor + 1;
  }

  return translateMetaDescription(output);
}

function getRequestLocale(req) {
  const cookieLocale = req && req.cookies ? req.cookies[LOCALE_COOKIE] : '';
  if (SUPPORTED.includes(cookieLocale)) return cookieLocale;

  const sessionLocale = req && req.session && req.session.user ? req.session.user.locale : '';
  if (SUPPORTED.includes(sessionLocale)) return sessionLocale;

  return DEFAULT_LOCALE;
}

function setLocaleCookie(res, locale) {
  if (!SUPPORTED.includes(locale)) return;
  res.cookie(LOCALE_COOKIE, locale, {
    maxAge: ONE_YEAR,
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.VERCEL === '1'
  });
}

function t(locale, phrase, vars = {}) {
  const safeLocale = SUPPORTED.includes(locale) ? locale : DEFAULT_LOCALE;
  let value = phrase;
  if (safeLocale === 'km') {
    value = lookupPhrase(normalize(phrase)) || phrase;
  }
  return String(value).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (full, key) => (
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : full
  ));
}

function clientDictionary() {
  return {
    phrases: kmPhrases,
    patterns: localeData.km.patterns || []
  };
}

module.exports = {
  SUPPORTED,
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  translateHtml,
  translateText,
  translateAttributeValue,
  getRequestLocale,
  setLocaleCookie,
  t,
  clientDictionary
};
