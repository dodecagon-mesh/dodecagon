import { LocalStorageKey } from '@/helpers/storage';
import '@/test-utils/dom-render';
import { expect, mock, test } from 'bun:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import type { TDevicesProvider } from '../index';
const translate = (key: string) => key;
mock.module('react-i18next', () => ({
  useTranslation: () => ({ t: translate })
}));
mock.module('@/helpers/browser-logger', () => ({
  logVoice() {},
  logVoiceError() {}
}));
mock.module('@/features/overlays/actions', () => ({
  openOverlay() {}
}));

// Load after the DOM and i18n doubles: static imports initialize these modules too early.
const { DevicesProvider } = await import('../index');
const { useDevices } = await import('../hooks/use-devices');
const { AudioSettingsMenu } = await import('@/components/audio-settings-menu');
const endpoint = (
  kind: MediaDeviceKind,
  deviceId: string,
  label: string
): MediaDeviceInfo => ({
  kind,
  deviceId,
  label,
  groupId: 'shared-group',
  toJSON: () => ({ kind, deviceId, label, groupId: 'shared-group' })
});

test('missing device context fails loudly instead of presenting a default-only menu', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const Consumer = () => {
    expect(useDevices).toThrow(
      'useDevices must be used within a DevicesProvider component'
    );
    return null;
  };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<Consumer />);
    });
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
});

test('devicechange updates every consumer without capture or losing preferences to incomplete discovery', async () => {
  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    localStorage: window.localStorage
  });
  window.localStorage.setItem(
    LocalStorageKey.DEVICES_SETTINGS,
    JSON.stringify({
      microphoneId: 'mic-b',
      playbackId: 'out-b',
      microphoneVolume: 73,
      playbackVolume: 42
    })
  );
  const mediaDevices = new EventTarget();
  let endpoints: MediaDeviceInfo[] = [endpoint('audioinput', '', '')];
  const capture = mock(async () => {
    throw new Error('Discovery must never capture');
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: Object.assign(mediaDevices, {
      enumerateDevices: async () => endpoints,
      getUserMedia: capture
    })
  });
  const consumers: TDevicesProvider[] = [];
  const Consumer = ({ index }: { index: number }) => {
    consumers[index] = useDevices();
    return null;
  };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <DevicesProvider>
          <Consumer index={0} />
          <Consumer index={1} />
          <AudioSettingsMenu kind="output">
            <button type="button">Output trigger</button>
          </AudioSettingsMenu>
        </DevicesProvider>
      );
    });
    expect(consumers[0]!.loading).toBe(false);
    expect(consumers[0]!.inputDevices).toEqual([]);
    expect(consumers[0]!.devices.microphoneId).toBe('mic-b');
    expect(consumers[0]!.devices.playbackId).toBe('out-b');

    endpoints = [
      endpoint('audioinput', 'default', 'Default microphone'),
      endpoint('audioinput', 'mic-a', 'Microphone'),
      endpoint('audioinput', 'mic-b', 'Microphone'),
      endpoint('audiooutput', 'default', 'Default output'),
      endpoint('audiooutput', 'out-a', 'Headphones'),
      endpoint('audiooutput', 'out-b', 'Headphones')
    ];
    await act(async () => {
      mediaDevices.dispatchEvent(new Event('devicechange'));
    });
    expect(
      consumers[0]!.inputDevices.map((device) => device?.deviceId)
    ).toEqual(['default', 'mic-a', 'mic-b']);
    expect(
      consumers[1]!.playbackDevices.map((device) => device?.deviceId)
    ).toEqual(['default', 'out-a', 'out-b']);
    expect(consumers[0]).toBe(consumers[1]);
    await act(async () => {
      container
        .querySelector('span[data-slot="popover-anchor"]')!
        .dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
        );
    });
    await act(async () => {
      document
        .querySelector('[role="combobox"][aria-label="outputDevice"]')!
        .dispatchEvent(
          new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            button: 0
          })
        );
    });
    expect(document.querySelector('[role="option"]')).not.toBeNull();

    endpoints = endpoints.filter((device) => device.deviceId !== 'out-a');
    await act(async () => {
      mediaDevices.dispatchEvent(new Event('devicechange'));
    });
    expect(
      consumers[1]!.playbackDevices.map((device) => device?.deviceId)
    ).toEqual(['default', 'out-b']);
    expect(consumers[0]!.devices.playbackId).toBe('out-b');
    expect(consumers[0]!.devices.microphoneVolume).toBe(73);
    expect(consumers[0]!.devices.playbackVolume).toBe(42);

    endpoints = [endpoint('audiooutput', 'default', 'Default output')];
    await act(async () => {
      mediaDevices.dispatchEvent(new Event('devicechange'));
    });
    expect(
      consumers[0]!.playbackDevices.map((device) => device?.deviceId)
    ).toEqual(['default']);
    expect(consumers[0]!.devices.playbackId).toBe('default');
    expect(capture).not.toHaveBeenCalled();
    expect(
      JSON.parse(window.localStorage.getItem(LocalStorageKey.DEVICES_SETTINGS)!)
        .playbackId
    ).toBe('default');
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
});
