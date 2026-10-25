import { DesignSystem } from '@/screens/design-system';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/design-system')({
  head: () => ({ meta: [{ title: 'Dodecagon | UI' }] }),
  component: DesignSystem
});
