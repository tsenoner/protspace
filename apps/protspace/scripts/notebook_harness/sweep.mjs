// Drive the Preparation panel rendered by harness.py and check every state.
// node sweep.mjs --panel URL --out DIR --widths 1440,1280 --report FILE [--progress URL]
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((pairs, value, i, all) => (i % 2 ? pairs : [...pairs, [all[i].slice(2), all[i + 1]]]), []),
);
const widths = args.widths.split(',').map(Number);
mkdirSync(args.out, { recursive: true });

// Colab runs the widgets' light-theme CSS in both modes. In dark mode it
// bridges --jp-ui-font-color1 and the layout colours to its own and leaves
// --jp-ui-font-color0/2/3 at their light-theme near-black (colabtools#1895):
// that is what made collapsed section titles unreadable.
const THEMES = {
  light: `:root, body { --colab-primary-text-color: #212121; --jp-ui-font-color1: #212121; }
    body { color: #212121; background: #ffffff; }`,
  dark: `:root, body {
      --colab-primary-text-color: #e3e3e3;
      --jp-ui-font-color1: #e3e3e3; --jp-content-font-color1: #e3e3e3;
      --jp-layout-color0: #383838; --jp-layout-color1: #383838;
      --jp-layout-color2: #454545; --jp-layout-color3: #5f6368;
      --jp-border-color1: #5f6368; --jp-border-color2: #5f6368;
    }
    body, .jp-OutputArea-output { background: #383838 !important; color: #e3e3e3 !important; }`,
};
const METHODS = ['PCA', 'UMAP', 't-SNE', 'MDS', 'PaCMAP', 'LocalMAP'];
const COMBOS = { none: [], one: ['PCA'], all: METHODS };
const HEADERS = '.p-Collapse-header, .lm-Collapse-header, .jupyter-widget-Collapse-header';
const MIN_TRACK = 120;

const failures = [];
let states = 0;
const PANEL = '[data-harness-panel="0"]';
const EAT_PANEL = '[data-harness-panel="1"]';

// Mark the control panel (the box holding the accordion and Generate) and the
// EAT box (the one holding its Transfer button), whatever the notebook's own
// class names: the same sweep then runs on an older version for comparison.
async function markPanels(page) {
  await page.evaluate((headers) => {
    const up = (el, test) => {
      for (let n = el; n; n = n.parentElement) if (test(n)) return n;
      return null;
    };
    const buttons = [...document.querySelectorAll('button')];
    const generate = buttons.find((b) => b.textContent.trim() === 'Generate');
    up(generate, (n) => n.querySelector(headers))?.setAttribute('data-harness-panel', '0');
    const transfer = buttons.find((b) => /^Transfer/.test(b.textContent.trim()));
    up(transfer, (n) => n.querySelector('select'))?.setAttribute('data-harness-panel', '1');
  }, HEADERS);
}

async function setTheme(page, css) {
  await page.evaluate((text) => {
    let style = document.getElementById('harness-theme');
    if (!style) {
      style = document.createElement('style');
      style.id = 'harness-theme';
      document.head.appendChild(style);
    }
    style.textContent = text;
  }, css);
}

async function openSection(page, index) {
  // index -1 closes them all; ipywidgets keeps at most one open.
  await page.evaluate(
    ({ panel, selector, index }) => {
      const headers = [...document.querySelectorAll(selector)].filter((h) => h.closest(panel));
      const isOpen = (h) => /Collapse-open/.test(h.parentElement.className);
      headers.forEach((header, i) => {
        if ((i === index) !== isOpen(header)) header.click();
      });
    },
    { panel: PANEL, selector: HEADERS, index },
  );
  await page.waitForTimeout(300);
}

async function selectMethods(page, wanted) {
  await openSection(page, 1);
  for (const name of METHODS) {
    const button = page.locator(`${PANEL} button`, { hasText: new RegExp(`^${name}$`) }).first();
    const on = /mod-active/.test((await button.getAttribute('class')) ?? '');
    if (on !== wanted.includes(name)) await button.click();
  }
  await page.waitForTimeout(300);
}

// Everything measured inside the page: slider tracks, overflow, contrast.
function measure({ minTrack, panelSelector }) {
  const root = document.querySelector(panelSelector);
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
  };
  const describe = (e) => `${e.tagName.toLowerCase()} "${(e.textContent || e.placeholder || '').trim().slice(0, 40)}"`;
  const rgba = (text) => {
    const m = text.match(/rgba?\(([^)]+)\)/);
    if (!m) return [0, 0, 0, 0];
    const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return [r, g, b, a];
  };
  const over = (top, under) => top.slice(0, 3).map((c, i) => c * top[3] + under[i] * (1 - top[3]));
  const background = (e) => {
    const chain = [];
    for (let n = e; n; n = n.parentElement) chain.push(n);
    let colour = [255, 255, 255];
    for (const n of chain.reverse()) {
      const bg = rgba(getComputedStyle(n).backgroundColor);
      if (bg[3] > 0) colour = over(bg, colour);
    }
    return colour;
  };
  const opacity = (e) => {
    let o = 1;
    for (let n = e; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  };
  const luminance = (c) => {
    const [r, g, b] = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const contrastOf = (e, colourText) => {
    const bg = background(e);
    const fg = rgba(colourText);
    return ratio(over([fg[0], fg[1], fg[2], fg[3] * opacity(e)], bg), bg);
  };

  const result = { sliders: [], overflow: [], contrast: [], generate: false };
  const panel = root.getBoundingClientRect();
  for (const slider of root.querySelectorAll('.widget-slider')) {
    if (!visible(slider)) continue;
    const track = slider.querySelector('.slider-container') || slider;
    const width = Math.round(track.getBoundingClientRect().width);
    if (width < minTrack) result.sliders.push(`${describe(slider)} track ${width}px`);
  }
  if (document.documentElement.scrollWidth > window.innerWidth + 1) {
    result.overflow.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
  }
  for (const e of root.querySelectorAll('button, input, select, .widget-label, .widget-html-content, .widget-readout')) {
    if (!visible(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.right > panel.right + 1 || r.left < panel.left - 1) {
      result.overflow.push(`${describe(e)} spans ${Math.round(r.left)}-${Math.round(r.right)}, panel ${Math.round(panel.left)}-${Math.round(panel.right)}`);
    }
  }
  const disabled = (e) => e.closest('button:disabled, input:disabled, select:disabled, .mod-disabled');
  for (const e of root.querySelectorAll('*')) {
    const ownText = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!ownText || !visible(e) || disabled(e)) continue;
    const style = getComputedStyle(e);
    const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
    const value = contrastOf(e, style.color);
    if (value < (large ? 3 : 4.5)) result.contrast.push(`${describe(e)} ${value.toFixed(2)}:1`);
  }
  for (const input of root.querySelectorAll('input[type=text], textarea')) {
    if (!visible(input) || disabled(input)) continue;
    if (!input.value && input.placeholder) {
      const value = contrastOf(input, getComputedStyle(input, '::placeholder').color);
      if (value < 3) result.contrast.push(`placeholder "${input.placeholder}" ${value.toFixed(2)}:1`);
    }
  }
  const generate = [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Generate');
  result.generate = Boolean(generate && visible(generate) && generate.getBoundingClientRect().right <= window.innerWidth);
  return result;
}

async function sweep(browser) {
  const page = await browser.newPage({ viewport: { width: widths[0], height: 1000 } });
  await page.goto(args.panel, { waitUntil: 'domcontentloaded', timeout: 600000 });
  await page.locator('button', { hasText: 'Generate' }).first().waitFor({ timeout: 600000 });
  await page.waitForTimeout(1500);
  await markPanels(page);
  for (const [theme, css] of Object.entries(THEMES)) {
    await setTheme(page, css);
    for (const [combo, methods] of Object.entries(COMBOS)) {
      await page.setViewportSize({ width: widths[0], height: 1000 });
      await selectMethods(page, methods);
      for (const section of [-1, 0, 1, 2, 3]) {
        await openSection(page, section);
        for (const width of widths) {
          await page.setViewportSize({ width, height: 1000 });
          await page.waitForTimeout(250);
          const state = `${theme} ${combo} section=${section < 0 ? 'none' : section + 1} ${width}px`;
          const found = await page.evaluate(measure, { minTrack: MIN_TRACK, panelSelector: PANEL });
          states += 1;
          for (const kind of ['sliders', 'overflow', 'contrast']) {
            for (const detail of found[kind]) failures.push(`${state}: ${kind}: ${detail}`);
          }
          if (!found.generate) failures.push(`${state}: Generate not visible`);
          const name = `${theme}-${combo}-s${section < 0 ? 0 : section + 1}-${width}.png`;
          await page.locator(PANEL).screenshot({ path: `${args.out}/${name}` });
        }
      }
    }
  }
  await page.close();
}

// Generate and EAT on the demo data with every step slowed down: one
// screenshot per status the panel shows, from the click to the download.
async function progress(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
  await page.goto(args.progress, { waitUntil: 'domcontentloaded', timeout: 600000 });
  await page.locator('button', { hasText: 'Generate' }).first().waitFor({ timeout: 600000 });
  await page.waitForTimeout(1500);
  await markPanels(page);
  await setTheme(page, THEMES.dark);
  const capture = async (panel, button, done, prefix) => {
    await page.locator(`${panel} button`, { hasText: button }).first().click();
    const seen = new Set();
    for (let i = 0; i < 200; i += 1) {
      const text = await page.locator(panel).innerText();
      const status = (text.match(/(Step \d of \d[^\n]*|Done in[^\n]*|failed[^\n]*)/) || [''])[0].replace(/\d+:\d\d elapsed/, '');
      if (status && !seen.has(status)) {
        seen.add(status);
        await page.locator(panel).screenshot({ path: `${args.out}/${prefix}-${String(seen.size).padStart(2, '0')}.png` });
      }
      if (done.test(status) || /failed/.test(status)) return [...seen];
      await page.waitForTimeout(400);
    }
    failures.push(`${prefix}: no final state within 80 s`);
    return [...seen];
  };
  const generate = await capture(PANEL, 'Generate', /^Done in/, 'progress-generate');
  if (!generate.some((s) => s.startsWith('Done in'))) failures.push(`Generate did not finish: ${generate.at(-1)}`);
  const eat = page.locator(EAT_PANEL).locator('select').first();
  // The column list refreshes just after Generate reports Done.
  let labels = [];
  for (let i = 0; i < 50 && !labels.some((l) => l.startsWith('family ')); i += 1) {
    await page.waitForTimeout(200);
    // ipywidgets writes option labels with non-breaking spaces.
    labels = await eat.evaluate((select) => [...select.options].map((o) => o.textContent.replace(/\u00a0/g, ' ').trim()));
  }
  const index = labels.findIndex((l) => l.startsWith('family '));
  if (index < 0) throw new Error(`no family column among ${JSON.stringify(labels)}`);
  await eat.selectOption({ index });
  const transfer = await capture(EAT_PANEL, 'Transfer & download', /^Done in/, 'progress-eat');
  if (!transfer.some((s) => s.startsWith('Done in'))) failures.push(`EAT did not finish: ${transfer.at(-1)}`);
  await page.close();
  return { generate, transfer };
}

const browser = await chromium.launch();
let steps = null;
try {
  if (args.sweep !== '0') await sweep(browser);
  if (args.progress) steps = await progress(browser);
} catch (error) {
  failures.push(`harness error: ${error.message.split('\n')[0]}`);
} finally {
  await browser.close();
}
writeFileSync(args.report, JSON.stringify({ states, failures, steps }, null, 1));
