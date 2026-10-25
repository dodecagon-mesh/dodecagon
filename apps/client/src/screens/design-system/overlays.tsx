import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Tooltip
} from '@dodecagon/ui';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Example, Section } from './section';

const TRIGGER_LAYOUT = 'h-auto min-h-10 max-w-full whitespace-normal';

export const Overlays = memo(() => {
  const { t } = useTranslation('design-system');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selection, setSelection] = useState('');
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const selectExample = useCallback(() => setSelection(t('menuSelected')), [t]);

  return (
    <Section id="overlays" number="05">
      <p className="mb-6 max-w-[65ch] text-sm leading-relaxed text-muted-foreground">
        {t('overlayNote')}
      </p>
      <Example title="Dialog · Popover · DropdownMenu · Tooltip · Sheet">
        <div className="flex flex-wrap items-center gap-3">
          <Dialog>
            <DialogTrigger
              render={<Button variant="outline" className={TRIGGER_LAYOUT} />}
            >
              {t('openDialog')}
            </DialogTrigger>
            <DialogContent className="max-h-[85dvh] overflow-y-auto overscroll-contain">
              <DialogHeader>
                <DialogTitle>{t('dialogTitle')}</DialogTitle>
                <DialogDescription>{t('safeNote')}</DialogDescription>
              </DialogHeader>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t('dialogNote')}
              </p>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>
                  {t('close')}
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={TRIGGER_LAYOUT}>
                {t('openPopover')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="max-w-[calc(100vw-2rem)] overscroll-contain">
              <h3 className="text-sm font-semibold">{t('example')}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {t('popoverNote')}
              </p>
            </PopoverContent>
          </Popover>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className={TRIGGER_LAYOUT}>
                {t('openMenu')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-w-[calc(100vw-2rem)] overscroll-contain">
              <DropdownMenuItem onSelect={selectExample}>
                {t('selectExample')}
              </DropdownMenuItem>
              <DropdownMenuItem disabled>{t('disabled')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip content={t('tooltipNote')}>
            <Button
              variant="outline"
              className={TRIGGER_LAYOUT}
              onClick={selectExample}
            >
              {t('tooltipExample')}
            </Button>
          </Tooltip>
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger
              render={<Button variant="outline" className={TRIGGER_LAYOUT} />}
            >
              {t('openSheet')}
            </SheetTrigger>
            <SheetContent
              close={closeSheet}
              className="overflow-y-auto overscroll-contain"
            >
              <SheetHeader className="pe-10">
                <SheetTitle>{t('sheetTitle')}</SheetTitle>
                <SheetDescription>{t('safeNote')}</SheetDescription>
              </SheetHeader>
              <p className="px-4 text-sm leading-relaxed text-muted-foreground">
                {t('dialogNote')}
              </p>
              <SheetFooter>
                <SheetClose render={<Button variant="outline" />}>
                  {t('close')}
                </SheetClose>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </div>
        <p role="status" className="mt-4 min-h-6 text-sm text-muted-foreground">
          {selection}
        </p>
      </Example>
    </Section>
  );
});
