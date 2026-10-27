import { describe, expect, test } from 'bun:test';
import { contrast, getThemeVariables, THEMES } from '../themes';

describe('built-in theme catalog', () => {
  test('keeps body text, muted text and action labels readable in every adapted palette', () => {
    for (const theme of THEMES.filter((item) => item.source !== 'dodecagon')) {
      const variables = getThemeVariables(theme);
      for (const token of [
        '--foreground',
        '--muted-foreground',
        '--accent-text'
      ]) {
        for (const surface of ['--background', '--card', '--secondary']) {
          expect(
            contrast(variables[token]!, variables[surface]!),
            `${theme.id} ${token} on ${surface}`
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(
        contrast(variables['--primary']!, variables['--primary-foreground']!),
        theme.id
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(
          variables['--sidebar-primary']!,
          variables['--sidebar-primary-foreground']!
        ),
        theme.id
      ).toBeGreaterThanOrEqual(4.5);
      for (const value of Object.values(variables))
        expect(value).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
