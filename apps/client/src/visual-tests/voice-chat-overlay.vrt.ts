import { useMouseActivity } from '@/components/channel-view/voice/hooks/use-mouse-activity';
import { VoiceChatButton } from '@/components/channel-view/voice/voice-chat-button';
import { cn } from '@/lib/utils';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import '../index.css';

const { toggleVoiceChatSidebar } = vi.hoisted(() => ({
  toggleVoiceChatSidebar: vi.fn()
}));

vi.mock('@/features/app/actions', () => ({ toggleVoiceChatSidebar }));
vi.mock('@/features/app/hooks', () => ({
  useVoiceChatSidebar: () => ({ isOpen: false, channelId: 2 })
}));
vi.mock('@/features/server/hooks', () => ({
  useHasUnreadMentions: () => false,
  useUnreadMessagesCount: () => 0
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}));

const Harness = () => {
  const { isVisible, stageRef } = useMouseActivity();

  return createElement(
    'div',
    {
      ref: stageRef,
      'data-testid': 'voice-stage',
      style: { height: '200px', position: 'relative', width: '400px' }
    },
    createElement(
      'div',
      {
        'data-testid': 'overlay',
        className: cn(
          'absolute right-3 top-3 transition-opacity',
          isVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        )
      },
      createElement(VoiceChatButton, { channelId: 2 })
    )
  );
};

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
  toggleVoiceChatSidebar.mockReset();
});

test('chat toggle stays hidden until the pointer moves over the voice stage', async () => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  root.render(createElement(Harness));

  const stage = page.getByTestId('voice-stage');
  const overlay = page.getByTestId('overlay');
  await expect.element(stage).toBeVisible();
  expect(getComputedStyle(overlay.element()).opacity).toBe('0');
  expect(getComputedStyle(overlay.element()).pointerEvents).toBe('none');

  stage
    .element()
    .dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));

  await expect
    .poll(() => getComputedStyle(overlay.element()).opacity)
    .toBe('1');
  expect(getComputedStyle(overlay.element()).pointerEvents).not.toBe('none');

  await page.getByRole('button', { name: 'openVoiceChat' }).click();
  expect(toggleVoiceChatSidebar).toHaveBeenCalledWith(2);

  stage.element().dispatchEvent(new PointerEvent('pointerleave'));
  await expect
    .poll(() => getComputedStyle(overlay.element()).opacity)
    .toBe('0');
});
