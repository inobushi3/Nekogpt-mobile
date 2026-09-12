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

const CONNECTION_UI_COPY: Record<AppLanguage, {
  start: string;
  settings: string;
  options: string;
  subtitles: string;
  close: string;
}> = {
  'pt-BR': { start: 'Começar', settings: 'Configurações', options: 'Opções', subtitles: 'Legenda', close: 'Fechar' },
  en: { start: 'Start', settings: 'Settings', options: 'Options', subtitles: 'Subtitles', close: 'Close' },
  es: { start: 'Comenzar', settings: 'Ajustes', options: 'Opciones', subtitles: 'Subtítulos', close: 'Cerrar' },
  fr: { start: 'Commencer', settings: 'Paramètres', options: 'Options', subtitles: 'Sous-titres', close: 'Fermer' },
  it: { start: 'Inizia', settings: 'Impostazioni', options: 'Opzioni', subtitles: 'Sottotitoli', close: 'Chiudi' },
  ja: { start: '開始', settings: '設定', options: 'オプション', subtitles: '字幕', close: '閉じる' },
  'zh-CN': { start: '开始', settings: '设置', options: '选项', subtitles: '字幕', close: '关闭' },
  ru: { start: 'Начать', settings: 'Настройки', options: 'Параметры', subtitles: 'Субтитры', close: 'Закрыть' },
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
  const ui = CONNECTION_UI_COPY[language];
  const actionLabel = busy ? t(language, 'gate.action.connecting') : ui.start;

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
        id="nekogpt-connect-settings"
        className={`connection-settings-trigger ${settingsOpen ? 'is-open' : ''}`}
        type="button"
        onClick={() => setSettingsOpen((value) => !value)}
        aria-label={ui.settings}
        aria-expanded={settingsOpen}
        aria-controls="nekogpt-connect-settings-panel"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
          <path d="m19.2 13.6 1.3 1-.2 1.5-1.6.6a7.7 7.7 0 0 1-1 1.7l.2 1.7-1.3.9-1.4-1a8 8 0 0 1-2 .6l-.6 1.6h-1.5l-.6-1.6a8 8 0 0 1-2-.6l-1.4 1-1.3-.9.2-1.7a7.7 7.7 0 0 1-1-1.7l-1.6-.6-.2-1.5 1.3-1a8 8 0 0 1 0-2l-1.3-1 .2-1.5L5 7.5a7.7 7.7 0 0 1 1-1.7L5.8 4l1.3-.9 1.4 1a8 8 0 0 1 2-.6l.6-1.6h1.5l.6 1.6a8 8 0 0 1 2 .6l1.4-1 1.3.9-.2 1.7a7.7 7.7 0 0 1 1 1.7l1.6.6.2 1.5-1.3 1a8 8 0 0 1 0 2Z" />
        </svg>
      </button>

      {settingsOpen && (
        <>
          <button
            className="connection-options-backdrop"
            type="button"
            aria-label={ui.close}
            onClick={() => setSettingsOpen(false)}
          />

          <section
            id="nekogpt-connect-settings-panel"
            className="connection-settings-panel connection-options-panel is-open"
            role="dialog"
            aria-modal="true"
            aria-labelledby="connection-options-title"
          >
            <button
              className="connection-options-close"
              type="button"
              aria-label={ui.close}
              onClick={() => setSettingsOpen(false)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 7l10 10M17 7 7 17" />
              </svg>
            </button>

            <h2 id="connection-options-title" className="connection-options-title">{ui.options}</h2>

            <label className="connection-options-row">
              <svg className="connection-options-row__icon" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
                <path d="M7 10h4M13 10h4M7 14h3M12 14h5" />
              </svg>
              <span className="connection-options-row__label">{ui.subtitles}</span>
              <svg className="connection-options-row__chevron" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m9 6 6 6-6 6" />
              </svg>
              <select
                value={language}
                aria-label={ui.subtitles}
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
        </>
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
