import { Toaster as Sonner, type ToasterProps } from 'sonner';

// the app owns its theme and passes the resolved mode in, so this stays a
// presentational wrapper with no assumption about where the theme comes from
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      closeButton
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)'
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
