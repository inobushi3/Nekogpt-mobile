import { useEffect, useState } from 'react';
import { CONNECTION_BACKGROUND_SRC } from '../connection-background';
import { LANGUAGE_OPTIONS, type AppLanguage, saveLanguage, t } from '../i18n';
import type { ConnectionPhase } from '../types';

type ConnectionGateProps = {
  phase: ConnectionPhase;
  detail: string;
  defaultRelayUrl: string;
  defaultPairingCode: string;
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
  onConnect: (relayUrl: string, pairingCode: string) => void;
};

export function ConnectionGate({
  phase,
  detail,
  defaultRelayUrl,
  defaultPairingCode,
  language,
  onLanguageChange,
  onConnect,
}: ConnectionGateProps) {
  const [pairingCode, setPairingCode] = useState(defaultPairingCode);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => setPairingCode(defaultPairingCode), [defaultPairingCode]);

  const busy = phase === 'connecting';
  const cleanPairingCode = pairingCode.trim();
  const canConnect = !busy && cleanPairingCode.length > 0;
  const actionLabel = busy ? t(language, 'gate.action.connecting') : 'Começar';

  return (
    <main className="connection-screen connection-screen--minimal">
      <div className="connection-background-stage" aria-hidden="true">
        <img
          className="connection-background-blur"
          src={CONNECTION_BACKGROUND_SRC}
          alt=""
          aria-hidden="true"
          draggable={false}
          decoding="async"
        />
        <img
          className="connection-background-sharp"
          src={CONNECTION_BACKGROUND_SRC}
          alt=""
          aria-hidden="true"
          draggable={false}
          decoding="async"
          loading="eager"
          fetchPriority="high"
        />
        <span className="connection-background-vignette" />
      </div>

      <button
        className={`connection-settings-trigger ${settingsOpen ? 'is-open' : ''}`}
        type="button"
        onClick={() => setSettingsOpen((value) => !value)}
        aria-label="Configurações"
        aria-expanded={settingsOpen}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
          <path d="m19.2 13.6 1.3 1-.2 1.5-1.6.6a7.7 7.7 0 0 1-1 1.7l.2 1.7-1.3.9-1.4-1a8 8 0 0 1-2 .6l-.6 1.6h-1.5l-.6-1.6a8 8 0 0 1-2-.6l-1.4 1-1.3-.9.2-1.7a7.7 7.7 0 0 1-1-1.7l-1.6-.6-.2-1.5 1.3-1a8 8 0 0 1 0-2l-1.3-1 .2-1.5L5 7.5a7.7 7.7 0 0 1 1-1.7L5.8 4l1.3-.9 1.4 1a8 8 0 0 1 2-.6l.6-1.6h1.5l.6 1.6a8 8 0 0 1 2 .6l1.4-1 1.3.9-.2 1.7a7.7 7.7 0 0 1 1 1.7l1.6.6.2 1.5-1.3 1a8 8 0 0 1 0 2Z" />
        </svg>
      </button>

      {settingsOpen && (
        <section className="connection-settings-panel">
          <label>
            <span>{t(language, 'gate.language')}</span>
            <select
              value={language}
              onChange={(event) => {
                const nextLanguage = event.currentTarget.value as AppLanguage;
                saveLanguage(nextLanguage);
                onLanguageChange(nextLanguage);
              }}
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>{option.label}</option>
              ))}
            </select>
          </label>
        </section>
      )}

      <section className="connection-card connection-card--minimal">
        <form
          className="connection-form connection-form--minimal"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canConnect) return;
            onConnect(defaultRelayUrl, cleanPairingCode);
          }}
        >
          <label className="connection-code-field connection-code-field--centered">
            <span>{t(language, 'gate.codeLabel')}</span>
            <input
              value={pairingCode}
              onChange={(event) => setPairingCode(event.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
              placeholder="EX.: N3K0A7"
              autoComplete="one-time-code"
              inputMode="text"
              required
              autoFocus
            />
          </label>

          <button type="submit" disabled={!canConnect}>
            {actionLabel}
          </button>
        </form>

        {phase !== 'disconnected' && (
          <div className={`connection-state connection-state--${phase}`}>
            <span className="status-orb" />
            <span>{detail || t(language, 'gate.preparing')}</span>
          </div>
        )}
      </section>
    </main>
  );
}
