import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The design system promises WCAG AA contrast in both themes. This test reads
 * the real token file and computes the ratios, so a colour change that breaks
 * the promise fails the build instead of going unnoticed.
 */

const css = readFileSync('src/web/styles/tokens.css', 'utf8');

function tokensIn(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No block for ${selector}`);
  const block = css.slice(start, css.indexOf('\n}', start));
  const tokens = new Map<string, string>();
  for (const match of block.matchAll(/--(color-[\w-]+):\s*(#[0-9a-fA-F]{6});/g)) {
    if (match[1] && match[2]) tokens.set(match[1], match[2]);
  }
  return tokens;
}

function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const TEXT_ON_BACKGROUNDS = [
  'color-text',
  'color-text-muted',
  'color-primary',
  'color-accent',
  'color-success',
  'color-warning',
  'color-danger',
];
const BACKGROUNDS = ['color-bg', 'color-surface', 'color-sunken'];

describe.each([
  ['light', tokensIn(':root')],
  ['dark', tokensIn(":root[data-theme='dark']")],
])('%s theme', (_name, tokens) => {
  const get = (name: string): string => {
    const value = tokens.get(name);
    if (!value) throw new Error(`Token --${name} is missing`);
    return value;
  };

  it('defines every colour token', () => {
    expect([...tokens.keys()].sort()).toEqual(
      [
        ...TEXT_ON_BACKGROUNDS,
        ...BACKGROUNDS,
        'color-border',
        'color-border-strong',
        'color-on-primary',
        'color-focus',
      ].sort(),
    );
  });

  it.each(TEXT_ON_BACKGROUNDS.flatMap((text) => BACKGROUNDS.map((bg) => [text, bg] as const)))(
    '--%s on --%s reaches 4.5:1 for text',
    (text, background) => {
      expect(contrast(get(text), get(background))).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('keeps button text readable on the primary colour', () => {
    expect(contrast(get('color-on-primary'), get('color-primary'))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(BACKGROUNDS)('control borders and the focus ring reach 3:1 on --%s', (background) => {
    expect(contrast(get('color-border-strong'), get(background))).toBeGreaterThanOrEqual(3);
    expect(contrast(get('color-focus'), get(background))).toBeGreaterThanOrEqual(3);
  });
});

describe('contrast maths', () => {
  it('matches the known extremes', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#777777')).toBe(1);
  });
});
