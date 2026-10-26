import { useModViewOpen } from '@/features/app/hooks';
import { requestConfirmation } from '@/features/overlays/actions';
import { usePreventExit } from '@/hooks/use-prevent-exit';
import { cn } from '@/lib/utils';
import { IconButton } from '@dodecagon/ui';
import { Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SettingsFormContext,
  type TSettingsFormHandle,
  type TSettingsFormRegistry
} from './context';
import {
  dirtyForms,
  hasUnsavedWork,
  pickActiveSectionId,
  registerForm,
  unregisterForm,
  type TSettingsSectionPosition
} from './helpers';
import { SaveBar } from './save-bar';
import { SettingsSidebar } from './sidebar';
import type { TSettingsEntry } from './types';

type TSettingsShellProps = {
  title: string;
  close: () => void;
  entries: TSettingsEntry[];
  pluginEntries?: TSettingsEntry[];
  initialEntryId?: string;
  groupLabel?: string;
};

const NO_ENTRIES: TSettingsEntry[] = [];

// a section takes over as the active one once its top reaches this line below the top
// of the scroll area, the same distance the content keeps above the first section
const ACTIVE_SECTION_OFFSET = 32;

const SettingsShell = memo(
  ({
    title,
    close,
    entries,
    pluginEntries = NO_ENTRIES,
    initialEntryId,
    groupLabel
  }: TSettingsShellProps) => {
    const { t } = useTranslation('settings');
    const [forms, setForms] = useState<TSettingsFormRegistry>({});
    const [activeId, setActiveId] = useState(
      () => initialEntryId ?? entries[0]?.id ?? ''
    );
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const { isOpen: isModViewOpen } = useModViewOpen();

    const scrollRef = useRef<HTMLElement | null>(null);
    const sectionRefs = useRef(new Map<string, HTMLElement>());
    const frameRef = useRef<number | null>(null);

    const allEntries = useMemo(
      () => [...entries, ...pluginEntries],
      [entries, pluginEntries]
    );

    const formHandles = useMemo(() => Object.values(forms), [forms]);
    const isDirty = hasUnsavedWork(forms);
    const isSaving = formHandles.some((handle) => handle.isSaving);

    usePreventExit(isDirty);

    const register = useCallback((id: string, handle: TSettingsFormHandle) => {
      setForms((current) => registerForm(current, id, handle));
    }, []);

    const unregister = useCallback(
      (id: string, handle: TSettingsFormHandle) => {
        setForms((current) => unregisterForm(current, id, handle));
      },
      []
    );

    const formSlot = useMemo(
      () => ({ register, unregister }),
      [register, unregister]
    );

    const confirmLeave = useCallback(async () => {
      if (!isDirty) return true;

      return requestConfirmation({
        title: t('discardChangesTitle'),
        message: t('discardChangesMsg'),
        confirmLabel: t('discardChangesBtn'),
        variant: 'danger'
      });
    }, [isDirty, t]);

    const handleClose = useCallback(async () => {
      if (await confirmLeave()) close();
    }, [confirmLeave, close]);

    const sectionRefCallbacks = useMemo(() => {
      const callbacks: Record<string, (element: HTMLElement | null) => void> =
        {};

      for (const entry of allEntries) {
        callbacks[entry.id] = (element: HTMLElement | null) => {
          if (element) {
            sectionRefs.current.set(entry.id, element);
            return;
          }

          sectionRefs.current.delete(entry.id);
        };
      }

      return callbacks;
    }, [allEntries]);

    const syncActiveSection = useCallback(() => {
      const container = scrollRef.current;
      if (!container) return;

      const containerTop = container.getBoundingClientRect().top;
      const positions: TSettingsSectionPosition[] = [];

      for (const entry of allEntries) {
        const element = sectionRefs.current.get(entry.id);
        if (!element) continue;

        const top = element.getBoundingClientRect().top - containerTop;

        positions.push({ id: entry.id, top });
      }

      const nextId = pickActiveSectionId(positions, ACTIVE_SECTION_OFFSET);

      setActiveId((current) => (current === nextId ? current : nextId));
    }, [allEntries]);

    const handleScroll = useCallback(() => {
      if (frameRef.current !== null) return;

      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        syncActiveSection();
      });
    }, [syncActiveSection]);

    const handleSelect = useCallback((id: string) => {
      const element = sectionRefs.current.get(id);

      if (element) element.scrollIntoView({ block: 'start' });

      setActiveId(id);
      setIsDrawerOpen(false);
    }, []);

    const handleSave = useCallback(async () => {
      const dirty = dirtyForms(formHandles);
      const saves = dirty.map((handle) => handle.save());

      await Promise.all(saves);
    }, [formHandles]);

    const handleDiscard = useCallback(() => {
      const dirty = dirtyForms(formHandles);

      for (const handle of dirty) {
        handle.discard();
      }
    }, [formHandles]);

    const toggleDrawer = useCallback(
      () => setIsDrawerOpen((open) => !open),
      []
    );
    const closeDrawer = useCallback(() => setIsDrawerOpen(false), []);

    useEffect(() => {
      syncActiveSection();
    }, [syncActiveSection]);

    // the settings can be opened on a section that is not the first one, the page opens there
    // instead of asking the user to scroll down to it
    const initialScrolledRef = useRef<string | null>(null);

    useEffect(() => {
      if (!initialEntryId) return;
      if (initialScrolledRef.current === initialEntryId) return;

      const element = sectionRefs.current.get(initialEntryId);
      if (!element) return;

      initialScrolledRef.current = initialEntryId;

      element.scrollIntoView({ block: 'start' });
    }, [allEntries, initialEntryId]);

    useEffect(() => {
      return () => {
        if (frameRef.current === null) return;

        cancelAnimationFrame(frameRef.current);
      };
    }, []);

    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key !== 'Escape' || e.defaultPrevented) return;

        // the topmost surface owns escape: the mod view and menus close themselves first
        if (isModViewOpen) return;
        const eventPath = e.composedPath();
        const isMenuEscape = eventPath.some(
          (target) =>
            target instanceof Element && target.getAttribute('role') === 'menu'
        );

        if (isMenuEscape) return;
        handleClose();
      };

      document.addEventListener('keydown', handleKeyDown);

      return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleClose, isModViewOpen]);

    return (
      <SettingsFormContext.Provider value={formSlot}>
        <div className="flex h-dvh flex-col select-none bg-canvas text-foreground">
          <div className="relative flex min-h-0 flex-1">
            {isDrawerOpen && (
              <div
                className="absolute inset-0 z-30 bg-black/50 md:hidden"
                onClick={closeDrawer}
              />
            )}

            <SettingsSidebar
              entries={entries}
              pluginEntries={pluginEntries}
              selectedId={activeId}
              onSelect={handleSelect}
              groupLabel={groupLabel}
              navigationLabel={t('settingsNavigationLabel')}
              className={cn(
                'absolute inset-y-0 left-0 z-40 invisible transition-transform duration-300 ease-in-out md:visible md:relative md:z-0 md:translate-x-0',
                isDrawerOpen
                  ? 'translate-x-0 visible'
                  : '-translate-x-full invisible'
              )}
            />

            <main
              ref={scrollRef}
              onScroll={handleScroll}
              className="relative flex-1 overflow-y-auto bg-canvas [scrollbar-gutter:stable]"
            >
              <div className="pointer-events-none sticky top-0 z-50 h-0">
                <div className="relative mx-auto w-full max-w-[1188px]">
                  <div className="absolute top-3 right-5 left-5 flex items-center justify-between md:right-8 md:left-8 md:justify-end">
                    <IconButton
                      icon={Bars3Icon}
                      variant="ghost"
                      aria-label={t('settingsNavigationLabel')}
                      aria-controls="settings-sidebar"
                      aria-expanded={isDrawerOpen}
                      onClick={toggleDrawer}
                      className="pointer-events-auto md:hidden"
                    />
                    <IconButton
                      icon={XMarkIcon}
                      variant="ghost"
                      size="lg"
                      aria-label={t('close')}
                      onClick={handleClose}
                      className="pointer-events-auto rounded-full border border-line"
                    />
                  </div>
                </div>
              </div>
              <div className="relative mx-auto w-full max-w-[1188px] p-5 pt-8 md:p-8 md:pt-8 lg:px-[60px] lg:pb-11">
                <h1 className="sr-only">{title}</h1>
                {allEntries.map((entry, index) => (
                  <section
                    key={entry.id}
                    ref={sectionRefCallbacks[entry.id]}
                    data-settings-section={entry.id}
                    className={cn(
                      'scroll-mt-8',
                      index > 0 && 'mt-[22px] border-t border-line pt-9'
                    )}
                  >
                    {entry.content}
                  </section>
                ))}
              </div>

              {isDirty && (
                <SaveBar
                  isSaving={isSaving}
                  save={handleSave}
                  discard={handleDiscard}
                />
              )}
            </main>
          </div>
        </div>
      </SettingsFormContext.Provider>
    );
  }
);

export { SettingsShell };
