import { useEffect, useState } from 'react';
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

  useEffect(() => setPairingCode(defaultPairingCode), [defaultPairingCode]);

  const busy = phase === 'connecting';
  const cleanPairingCode = pairingCode.trim();
  const canConnect = !busy && cleanPairingCode.length > 0;
  const actionLabel = phase === 'connecting'
    ? t(language, 'gate.action.connecting')
    : t(language, 'gate.action.connect');

  return (
    <main className="connection-screen">
      <section className="connection-card">
        <header className="connection-brand">
          <img src="/nekogpt-logo.png" alt="NekoGPT" />
        </header>

        <div className="connection-copy">
          <p className="connection-kicker">{t(language, 'gate.kicker')}</p>
          <p>{t(language, 'gate.description')}</p>
        </div>

        <form
          className="connection-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canConnect) return;
            onConnect(defaultRelayUrl, cleanPairingCode);
          }}
        >
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

          <label className="connection-code-field">
            <span>{t(language, 'gate.codeLabel')}</span>
            <input
              value={pairingCode}
              onChange={(event) => setPairingCode(event.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
              placeholder="EX.: N3K0A7"
              autoComplete="one-time-code"
              inputMode="text"
              required
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
