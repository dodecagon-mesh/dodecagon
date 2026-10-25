import {
  ColorPicker,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch,
  Textarea
} from '@dodecagon/ui';
import { memo, useCallback, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Example, Section } from './section';

export const Inputs = memo(() => {
  const { t } = useTranslation('design-system');
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [selected, setSelected] = useState('studio');
  const [enabled, setEnabled] = useState(true);
  const [volume, setVolume] = useState([65]);
  const [color, setColor] = useState('#5865f2');
  const [validationName, setValidationName] = useState('');
  const hasValidationError = validationName.trim() === '';
  const changeName = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setName(event.target.value),
    []
  );
  const changeNotes = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => setNotes(event.target.value),
    []
  );
  const changeValidationName = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      setValidationName(event.target.value),
    []
  );
  const changeVolume = useCallback((values: number[]) => setVolume(values), []);

  return (
    <Section id="inputs" number="03">
      <div className="grid gap-6 xl:grid-cols-2">
        <Example title="Input · Textarea">
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="example-name">{t('displayName')}</Label>
              <Input
                id="example-name"
                name="example-name"
                autoComplete="off"
                placeholder={t('nameExample')}
                value={name}
                onChange={changeName}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="example-notes">{t('notes')}</Label>
              <Textarea
                id="example-notes"
                name="example-notes"
                placeholder={t('notesExample')}
                value={notes}
                onChange={changeNotes}
                className="min-h-24 text-base md:text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="example-invalid">{t('invalidExample')}</Label>
              <Input
                id="example-invalid"
                name="example-invalid"
                value={validationName}
                onChange={changeValidationName}
                aria-invalid={hasValidationError}
                aria-describedby={
                  hasValidationError ? 'example-input-error' : undefined
                }
              />
              {hasValidationError && (
                <p
                  id="example-input-error"
                  className="text-sm leading-relaxed text-destructive"
                >
                  {t('inputError')}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="example-disabled">{t('disabled')}</Label>
              <Input id="example-disabled" disabled value={t('disabled')} />
            </div>
          </div>
        </Example>
        <div className="grid gap-6">
          <Example title="Select · Switch · Slider">
            <div className="space-y-6">
              <div className="space-y-2">
                <Label id="example-room-label">{t('roomExample')}</Label>
                <Select value={selected} onValueChange={setSelected}>
                  <SelectTrigger
                    aria-labelledby="example-room-label"
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="studio">{t('studio')}</SelectItem>
                    <SelectItem value="lounge">{t('lounge')}</SelectItem>
                    <SelectItem value="unavailable" disabled>
                      {t('disabled')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="example-switch">{t('notifications')}</Label>
                <Switch
                  id="example-switch"
                  checked={enabled}
                  onCheckedChange={setEnabled}
                />
              </div>
              <div className="space-y-3">
                <div className="flex justify-between gap-4">
                  <Label id="example-volume-label">{t('volumeExample')}</Label>
                  <output className="text-sm tabular-nums text-muted-foreground">
                    {volume[0]}%
                  </output>
                </div>
                <Slider
                  aria-labelledby="example-volume-label"
                  value={volume}
                  onValueChange={changeVolume}
                  min={0}
                  max={100}
                  step={1}
                />
              </div>
            </div>
          </Example>
          <Example title="ColorPicker">
            <div className="flex flex-wrap items-start gap-5">
              <ColorPicker
                value={color}
                onChange={setColor}
                defaultValue="#5865f2"
                ariaLabel={t('colorExample')}
              />
              <p className="max-w-56 text-sm leading-relaxed text-muted-foreground">
                {t('colorNote')}
              </p>
            </div>
          </Example>
        </div>
      </div>
    </Section>
  );
});
