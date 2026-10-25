import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

type TSectionProps = {
  id: 'foundations' | 'actions' | 'inputs' | 'feedback' | 'overlays' | 'voice';
  number: string;
  children: ReactNode;
};

export const Section = memo(({ id, number, children }: TSectionProps) => {
  const { t } = useTranslation('design-system');

  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6">
      <div className="mb-6 flex items-baseline gap-3 border-b border-line pb-4">
        <span
          aria-hidden="true"
          className="font-mono text-xs text-muted-foreground"
        >
          {number}
        </span>
        <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">
          {t(id)}
        </h2>
      </div>
      {children}
    </section>
  );
});

export const Example = memo(
  ({ title, children }: { title: string; children: ReactNode }) => (
    <div className="min-w-0 rounded-xl border border-line bg-nav p-5 sm:p-6">
      <h3 className="mb-5 text-sm font-semibold">{title}</h3>
      {children}
    </div>
  )
);
