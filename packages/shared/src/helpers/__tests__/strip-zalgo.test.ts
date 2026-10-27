import { describe, expect, test } from 'bun:test';
import { stripZalgo } from '../strip-zalgo';

// helper: builds a zalgo char by stacking N combining marks on a base
const zalgoChar = (base: string, count: number) =>
  base + '\u0300'.repeat(count);

describe('strip-zalgo', () => {
  test('should preserve normal accented characters', () => {
    expect(stripZalgo('café')).toBe('café');
    expect(stripZalgo('résumé')).toBe('résumé');
    expect(stripZalgo('naïve')).toBe('naïve');
    expect(stripZalgo('señor')).toBe('señor');
  });

  test('should strip combining marks beyond the limit', () => {
    const input = zalgoChar('a', 10);
    const expected = zalgoChar('a', 3);

    expect(stripZalgo(input)).toBe(expected);
  });

  test('should handle HTML content with zalgo inside text nodes', () => {
    const input = `<p>${zalgoChar('H', 20)}ello</p>`;
    const expected = `<p>${zalgoChar('H', 3)}ello</p>`;

    expect(stripZalgo(input)).toBe(expected);
  });

  test('should preserve emoji and non-Latin scripts', () => {
    expect(stripZalgo('こんにちは')).toBe('こんにちは');
    expect(stripZalgo('مرحبا')).toBe('مرحبا');
  });

  test('should not corrupt HTML tags', () => {
    const input = '<a href="https://example.com">link</a>';

    expect(stripZalgo(input)).toBe(input);
  });
});
