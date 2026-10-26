import * as React from 'react';

// any component that renders an svg, the approved Heroicons set and the local
// artwork for the symbols Heroicons does not ship both satisfy it
type TIconComponent = React.ComponentType<React.SVGProps<SVGSVGElement>>;

export type { TIconComponent };
