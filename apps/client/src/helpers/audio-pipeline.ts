import { logVoiceWarn } from './browser-logger';

type TAudioPipelineListener = () => void;

// chromium renders web audio and media playback in a separate audio service. when
// it is killed the renderer keeps its objects but loses the device: every
// AudioContext ends up suspended with an `error` event, and every <audio> element
// playing a MediaStream pauses and never resumes. a call stays silent until the
// page is rebuilt, so the first surfacing context reports the loss once and the
// owners rebuild what the loss broke.
let pipelineLost = false;

const lossListeners = new Set<TAudioPipelineListener>();
const lostContexts = new WeakSet<AudioContext>();

const reportLoss = () => {
  // the audio service takes every context down in the same outage, and one
  // notification per outage is what the listeners can act on
  if (pipelineLost) return;

  pipelineLost = true;

  logVoiceWarn('audio device lost, rebuilding the local pipeline');

  for (const listener of [...lossListeners]) {
    try {
      listener();
    } catch (error) {
      console.warn('audio pipeline listener failed:', error);
    }
  }
};

const trackAudioContext = (context: AudioContext) => {
  let hasRun = context.state === 'running';

  // a context that starts running means the device is back, so the next outage
  // is a new loss
  if (hasRun) {
    pipelineLost = false;
  }

  const handleStateChange = () => {
    if (context.state === 'running') {
      hasRun = true;
      pipelineLost = false;

      return;
    }

    // a context suspended before it ever ran is an autoplay restriction, not a
    // lost device
    if (!hasRun || context.state !== 'suspended') return;

    lostContexts.add(context);
    reportLoss();
  };

  context.addEventListener('statechange', handleStateChange);
  context.addEventListener('error', () => {
    lostContexts.add(context);
    reportLoss();
  });
};

const createAudioContext = (options?: AudioContextOptions) => {
  const AudioContextClass =
    window.AudioContext ||
    (
      window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }
    ).webkitAudioContext;

  if (!AudioContextClass) return null;

  const context = new AudioContextClass(options);

  trackAudioContext(context);

  return context;
};

// a lost context keeps reporting `running` until the device dies and then stays
// broken forever, so it can only be replaced, never resumed
const canUseAudioContext = (context: AudioContext | null) =>
  !!context && context.state !== 'closed' && !lostContexts.has(context);

const subscribeToAudioPipelineLoss = (listener: TAudioPipelineListener) => {
  lossListeners.add(listener);

  return () => {
    lossListeners.delete(listener);
  };
};

const resumeMediaPlayback = async (element: HTMLAudioElement | null) => {
  if (!element?.srcObject) return;

  // the paused element keeps the output stream of the dead device, so the source
  // is replaced to make chromium ask for a new one
  const stream = element.srcObject;

  element.srcObject = null;
  element.srcObject = stream;

  try {
    await element.play();
  } catch (error) {
    console.warn('audio playback did not resume:', error);
  }
};

export {
  canUseAudioContext,
  createAudioContext,
  resumeMediaPlayback,
  subscribeToAudioPipelineLoss,
  trackAudioContext
};
