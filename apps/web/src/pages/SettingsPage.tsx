import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header.js';
import { useGame } from '../stores/game.js';
import { useSettings, type FontSizeSetting } from '../stores/settings.js';
import { strings } from '../strings.js';

const FONT_SIZES: Array<{ value: FontSizeSetting; label: string }> = [
  { value: 'normal', label: strings.fontSizeNormal },
  { value: 'large', label: strings.fontSizeLarge },
  { value: 'xlarge', label: strings.fontSizeXlarge },
];

/** Settings: accessibility prefs + progress reset (plan.md §9.2). */
export function SettingsPage() {
  const navigate = useNavigate();
  const me = useGame((s) => s.me);
  const highContrast = useSettings((s) => s.highContrast);
  const fontSize = useSettings((s) => s.fontSize);
  const reducedMotion = useSettings((s) => s.reducedMotion);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetFailed, setResetFailed] = useState(false);

  const reset = async (): Promise<void> => {
    setResetFailed(false);
    await useGame.getState().resetProgress();
    if (useGame.getState().error === null) {
      navigate('/map');
    } else {
      setResetFailed(true);
    }
  };

  return (
    <div className="min-h-screen bg-bg">
      <Header me={me} />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
        <h1 className="font-mono text-2xl text-text">{strings.settingsTitle}</h1>

        <fieldset>
          <legend className="mb-2 font-mono text-sm text-cyan">{strings.fontSizeLabel}</legend>
          <div className="flex gap-4">
            {FONT_SIZES.map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-text">
                <input
                  type="radio"
                  name="font-size"
                  value={option.value}
                  checked={fontSize === option.value}
                  onChange={() => {
                    useSettings.getState().setFontSize(option.value);
                  }}
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-text">
            <input
              type="checkbox"
              checked={highContrast}
              onChange={(e) => {
                useSettings.getState().setHighContrast(e.target.checked);
              }}
            />
            {strings.highContrastLabel}
          </label>
          <label className="flex items-center gap-2 text-text">
            <input
              type="checkbox"
              checked={reducedMotion}
              onChange={(e) => {
                useSettings.getState().setReducedMotion(e.target.checked);
              }}
            />
            {strings.reducedMotionLabel}
          </label>
        </div>

        <div>
          {confirmingReset ? (
            <div role="group" aria-label={strings.resetProgress} className="flex flex-col gap-2">
              <p className="text-sm text-amber">{strings.resetProgressConfirm}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingReset(false);
                    void reset();
                  }}
                  className="rounded-md bg-red px-4 py-2 font-mono text-sm text-bg"
                >
                  {strings.resetConfirmYes}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingReset(false);
                  }}
                  className="rounded-md border border-border px-4 py-2 font-mono text-sm text-text"
                >
                  {strings.resetConfirmNo}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setConfirmingReset(true);
              }}
              className="rounded-md border border-red px-4 py-2 font-mono text-sm text-red"
            >
              {strings.resetProgress}
            </button>
          )}
          {resetFailed && (
            <p role="alert" className="mt-2 text-sm text-red">
              {strings.saveFailed}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
