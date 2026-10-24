export type THolepunchMedia = {
  version: 1;
  create: (options: { sessionId: string }) => Promise<{
    publicKey: string;
    port: number;
  }>;
  connect: (options: {
    sessionId: string;
    remotePublicKey: string;
    initiator: boolean;
  }) => Promise<void>;
  close: (options: { sessionId: string }) => Promise<void>;
  onClosed: (callback: (event: { sessionId: string }) => void) => () => void;
};

export const getHolepunchMedia = (): THolepunchMedia | undefined => {
  const desktop = (
    globalThis as typeof globalThis & {
      dodecagonDesktop?: { media?: THolepunchMedia };
    }
  ).dodecagonDesktop;
  const media = desktop?.media;
  return media?.version === 1 ? media : undefined;
};

export const withHolepunchCandidate = (sdp: string, port: number): string => {
  const sections = sdp.split(/(?=^m=)/m);
  return sections
    .map((section, index) => {
      const stripped = section.replace(
        /^a=(?:candidate:.*|end-of-candidates|remote-candidates:.*)\r?\n/gm,
        ''
      );
      if (index === 0 || /^m=\S+ 0 /m.test(stripped)) return stripped;
      return `${stripped}a=candidate:1 1 UDP 2130706431 127.0.0.1 ${port} typ host\r\na=end-of-candidates\r\n`;
    })
    .join('');
};
