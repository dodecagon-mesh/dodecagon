import { DEFAULT_PROFILE_COLOR } from '@dodecagon/shared';
import { memo, useMemo } from 'react';

type TCardThemeProps = {
  profileColor?: string;
  hasVideoStream?: boolean;
};

const CardTheme = memo(
  ({
    profileColor = DEFAULT_PROFILE_COLOR,
    hasVideoStream = false
  }: TCardThemeProps) => {
    const style = useMemo(
      () =>
        hasVideoStream
          ? { backgroundColor: '#000000' }
          : {
              backgroundColor: `color-mix(in srgb, ${profileColor} var(--voice-profile-tint,18%), var(--rail))`
            },
      [profileColor, hasVideoStream]
    );

    return (
      <div className="absolute inset-0 pointer-events-none" style={style} />
    );
  }
);

CardTheme.displayName = 'CardTheme';

export { CardTheme };
