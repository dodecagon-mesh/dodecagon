import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { VoiceGrid } from '../voice-grid';

const i18n = i18next.createInstance();

await i18n.init({ lng: 'en', fallbackLng: 'en', resources: {} });

const cards = ['share', 'one', 'two'].map((id) =>
  createElement('button', { key: id }, id)
);
const noop = () => {};

const renderGrid = (hidden: boolean, pinnedCardId?: string) => {
  const html = renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <VoiceGrid
        pinnedCardId={pinnedCardId}
        participantsHidden={hidden}
        onToggleParticipants={noop}
      >
        {cards}
      </VoiceGrid>
    </I18nextProvider>
  );
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document;
};

test('hiding the participant strip removes thumbnails from interaction, not the focused media', () => {
  const document = renderGrid(true, 'share');
  const strip = document.querySelector('[aria-hidden="true"]');

  expect(strip?.hasAttribute('inert')).toBe(true);
  expect(strip?.textContent).toBe('onetwo');
  expect(strip?.textContent).not.toContain('share');
  expect(
    document.querySelector('button[aria-label="showParticipants"]')
  ).not.toBeNull();
  expect(document.querySelectorAll('button')).toHaveLength(4);
});

test('showing participants makes every thumbnail available and offers the hide action', () => {
  const document = renderGrid(false, 'share');

  expect(document.querySelector('[inert]')).toBeNull();
  expect(document.querySelector('div[aria-hidden="true"]')).toBeNull();
  expect(
    document.querySelector('button[aria-label="hideParticipants"]')
  ).not.toBeNull();
  expect(document.querySelectorAll('button')).toHaveLength(4);
});

test('unfocused grid keeps all participants available without a redundant strip disclosure', () => {
  const document = renderGrid(true);

  expect(document.querySelector('[inert]')).toBeNull();
  expect(document.querySelectorAll('button')).toHaveLength(3);
  expect(document.body.textContent).toBe('shareonetwo');
});
