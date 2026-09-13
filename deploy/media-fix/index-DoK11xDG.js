import 'https://nekogpt-mobile-3kimvm8bp-inobushi3s-projects.vercel.app/assets/index-DoK11xDG.js';

const settingsGlassStyle = document.createElement('style');
settingsGlassStyle.id = 'nekogpt-settings-glass';
settingsGlassStyle.textContent = `
html body .companion-screen .settings-panel {
  border: 1px solid rgba(255, 255, 255, 0.14) !important;
  border-radius: 18px !important;
  background:
    linear-gradient(145deg, rgba(255,255,255,0.055), rgba(255,255,255,0.012) 42%, rgba(0,0,0,0.055)),
    rgba(10, 9, 12, 0.58) !important;
  box-shadow: 0 14px 42px rgba(0, 0, 0, 0.28) !important;
  -webkit-backdrop-filter: blur(24px) saturate(1.05) !important;
  backdrop-filter: blur(24px) saturate(1.05) !important;
  overflow: hidden !important;
}

html body .companion-screen .settings-panel,
html body .companion-screen .settings-panel * {
  color: rgba(255, 255, 255, 0.96) !important;
}

html body .companion-screen .settings-panel p,
html body .companion-screen .settings-panel small,
html body .companion-screen .settings-panel label,
html body .companion-screen .settings-panel span {
  color: rgba(255, 255, 255, 0.90) !important;
}

html body .companion-screen .settings-panel h1,
html body .companion-screen .settings-panel h2,
html body .companion-screen .settings-panel h3,
html body .companion-screen .settings-panel h4,
html body .companion-screen .settings-panel strong,
html body .companion-screen .settings-panel b {
  color: #ffffff !important;
}

html body .companion-screen .settings-panel .settings-panel__header > i {
  display: none !important;
}

html body .companion-screen .settings-panel .settings-section:nth-of-type(2) .settings-panel__header span {
  display: none !important;
}

html body .companion-screen .settings-panel .background-controls {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;
  gap: 7px !important;
}

html body .companion-screen .settings-panel .camera-controls button,
html body .companion-screen .settings-panel .background-controls button,
html body .companion-screen .settings-panel .background-controls button:first-child {
  width: 100% !important;
  min-width: 0 !important;
  min-height: 38px !important;
  padding: 0 10px !important;
  color: rgba(255, 255, 255, 0.96) !important;
  background: rgba(18, 17, 22, 0.48) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  border-radius: 10px !important;
  box-shadow: none !important;
  -webkit-backdrop-filter: blur(14px) saturate(1.05) !important;
  backdrop-filter: blur(14px) saturate(1.05) !important;
  font-size: 0.7rem !important;
  font-weight: 700 !important;
}

html body .companion-screen .settings-panel .camera-controls button.is-active {
  color: rgba(255, 255, 255, 0.98) !important;
  background: rgba(24, 30, 28, 0.58) !important;
  border: 1px solid rgba(83, 221, 167, 0.28) !important;
  box-shadow: none !important;
}

/* All top notifications are text-only. */
html body .companion-screen .notice,
html body .companion-screen .companion-status {
  width: auto !important;
  max-width: calc(100vw - 48px) !important;
  min-height: 0 !important;
  gap: 0 !important;
  border: 0 !important;
  outline: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
  padding: 0 !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
  filter: none !important;
  text-shadow: none !important;
  text-align: center !important;
  font-weight: 700 !important;
}

html body .companion-screen .notice {
  color: #ff4f6d !important;
}

html body .companion-screen .companion-status {
  color: rgba(255, 255, 255, 0.96) !important;
}

html body .companion-screen .companion-status .status-orb {
  display: none !important;
}

html body .companion-screen .companion-status span {
  color: inherit !important;
  text-shadow: none !important;
}

html body .companion-screen .companion-status.nekogpt-error-status,
html body .companion-screen .companion-status.nekogpt-error-status span {
  color: #ff4f6d !important;
}

@media (max-width: 620px) {
  html body .companion-screen .settings-panel {
    border-radius: 17px !important;
    background:
      linear-gradient(145deg, rgba(255,255,255,0.055), rgba(255,255,255,0.012) 42%, rgba(0,0,0,0.055)),
      rgba(10, 9, 12, 0.54) !important;
    -webkit-backdrop-filter: blur(22px) saturate(1.02) !important;
    backdrop-filter: blur(22px) saturate(1.02) !important;
  }
}
`;
document.head.appendChild(settingsGlassStyle);

const backgroundDescriptionByLanguage = {
  'pt-BR': 'Escolha uma imagem para o fundo.',
  en: 'Choose an image for the background.',
  es: 'Elige una imagen para el fondo.',
  fr: 'Choisissez une image pour l’arrière-plan.',
  it: 'Scegli un’immagine per lo sfondo.',
  ja: '背景用の画像を選択してください。',
  'zh-CN': '选择一张图片作为背景。',
  ru: 'Выберите изображение для фона.',
};

const notificationTranslations = {
  'pt-BR': {
    permissionDismissed: 'Permissão cancelada.',
    permissionDenied: 'Permissão negada.',
    bundleTimeout: 'O download do modelo Live2D excedeu o tempo limite.',
    timeout: 'A operação excedeu o tempo limite.',
    connectionClosed: 'A conexão com o NekoGPT foi encerrada.',
    desktopOffline: 'O NekoGPT no PC ficou offline.',
    relayUnreachable: 'Não foi possível alcançar o relay.',
    rejected: 'O pareamento foi recusado no PC.',
    revoked: 'A conexão móvel foi desligada no NekoGPT do PC.',
    notApproved: 'A conexão com o NekoGPT ainda não foi concluída.',
    commandFailed: 'O PC não conseguiu executar o comando.',
    invalidProtocol: 'Mensagem inválida recebida do relay.',
    incompleteBundle: 'O pacote Live2D chegou incompleto.',
    genericError: 'Ocorreu um erro.',
  },
  en: {
    permissionDismissed: 'Permission dismissed.',
    permissionDenied: 'Permission denied.',
    bundleTimeout: 'The Live2D model download timed out.',
    timeout: 'The operation timed out.',
    connectionClosed: 'The connection with NekoGPT was closed.',
    desktopOffline: 'NekoGPT on the PC went offline.',
    relayUnreachable: 'Could not reach the relay.',
    rejected: 'Pairing was rejected on the PC.',
    revoked: 'The mobile connection was disabled on the NekoGPT PC app.',
    notApproved: 'The NekoGPT connection has not been completed yet.',
    commandFailed: 'The PC could not execute the command.',
    invalidProtocol: 'Invalid message received from the relay.',
    incompleteBundle: 'The Live2D package arrived incomplete.',
    genericError: 'An error occurred.',
  },
  es: {
    permissionDismissed: 'Permiso cancelado.',
    permissionDenied: 'Permiso denegado.',
    bundleTimeout: 'La descarga del modelo Live2D superó el tiempo de espera.',
    timeout: 'La operación superó el tiempo de espera.',
    connectionClosed: 'La conexión con NekoGPT se cerró.',
    desktopOffline: 'NekoGPT en el PC quedó sin conexión.',
    relayUnreachable: 'No se pudo alcanzar el relay.',
    rejected: 'El emparejamiento fue rechazado en el PC.',
    revoked: 'La conexión móvil fue desactivada en NekoGPT del PC.',
    notApproved: 'La conexión con NekoGPT aún no se ha completado.',
    commandFailed: 'El PC no pudo ejecutar el comando.',
    invalidProtocol: 'Se recibió un mensaje no válido del relay.',
    incompleteBundle: 'El paquete Live2D llegó incompleto.',
    genericError: 'Ocurrió un error.',
  },
  fr: {
    permissionDismissed: 'Autorisation annulée.',
    permissionDenied: 'Autorisation refusée.',
    bundleTimeout: 'Le téléchargement du modèle Live2D a dépassé le délai.',
    timeout: 'L’opération a dépassé le délai.',
    connectionClosed: 'La connexion avec NekoGPT a été fermée.',
    desktopOffline: 'NekoGPT sur le PC est hors ligne.',
    relayUnreachable: 'Impossible de joindre le relay.',
    rejected: 'L’appairage a été refusé sur le PC.',
    revoked: 'La connexion mobile a été désactivée sur NekoGPT du PC.',
    notApproved: 'La connexion à NekoGPT n’est pas encore terminée.',
    commandFailed: 'Le PC n’a pas pu exécuter la commande.',
    invalidProtocol: 'Message invalide reçu du relay.',
    incompleteBundle: 'Le paquet Live2D est arrivé incomplet.',
    genericError: 'Une erreur s’est produite.',
  },
  it: {
    permissionDismissed: 'Autorizzazione annullata.',
    permissionDenied: 'Autorizzazione negata.',
    bundleTimeout: 'Il download del modello Live2D ha superato il tempo limite.',
    timeout: 'L’operazione ha superato il tempo limite.',
    connectionClosed: 'La connessione con NekoGPT è stata chiusa.',
    desktopOffline: 'NekoGPT sul PC è offline.',
    relayUnreachable: 'Impossibile raggiungere il relay.',
    rejected: 'L’associazione è stata rifiutata sul PC.',
    revoked: 'La connessione mobile è stata disattivata su NekoGPT del PC.',
    notApproved: 'La connessione a NekoGPT non è ancora stata completata.',
    commandFailed: 'Il PC non è riuscito a eseguire il comando.',
    invalidProtocol: 'Messaggio non valido ricevuto dal relay.',
    incompleteBundle: 'Il pacchetto Live2D è arrivato incompleto.',
    genericError: 'Si è verificato un errore.',
  },
  ja: {
    permissionDismissed: '権限リクエストがキャンセルされました。',
    permissionDenied: '権限が拒否されました。',
    bundleTimeout: 'Live2Dモデルのダウンロードがタイムアウトしました。',
    timeout: '処理がタイムアウトしました。',
    connectionClosed: 'NekoGPTとの接続が終了しました。',
    desktopOffline: 'PC側のNekoGPTがオフラインになりました。',
    relayUnreachable: 'リレーに接続できませんでした。',
    rejected: 'PC側でペアリングが拒否されました。',
    revoked: 'PC側のNekoGPTでモバイル接続が無効になりました。',
    notApproved: 'NekoGPTとの接続はまだ完了していません。',
    commandFailed: 'PCでコマンドを実行できませんでした。',
    invalidProtocol: 'リレーから無効なメッセージを受信しました。',
    incompleteBundle: 'Live2Dパッケージが不完全です。',
    genericError: 'エラーが発生しました。',
  },
  'zh-CN': {
    permissionDismissed: '权限请求已取消。',
    permissionDenied: '权限被拒绝。',
    bundleTimeout: 'Live2D 模型下载超时。',
    timeout: '操作超时。',
    connectionClosed: '与 NekoGPT 的连接已关闭。',
    desktopOffline: 'PC 上的 NekoGPT 已离线。',
    relayUnreachable: '无法连接到中继。',
    rejected: 'PC 端拒绝了配对。',
    revoked: 'PC 端 NekoGPT 已关闭移动连接。',
    notApproved: '与 NekoGPT 的连接尚未完成。',
    commandFailed: 'PC 无法执行该命令。',
    invalidProtocol: '从中继收到了无效消息。',
    incompleteBundle: 'Live2D 包不完整。',
    genericError: '发生错误。',
  },
  ru: {
    permissionDismissed: 'Запрос разрешения отменён.',
    permissionDenied: 'Доступ запрещён.',
    bundleTimeout: 'Время загрузки модели Live2D истекло.',
    timeout: 'Время выполнения операции истекло.',
    connectionClosed: 'Соединение с NekoGPT закрыто.',
    desktopOffline: 'NekoGPT на ПК перешёл в офлайн.',
    relayUnreachable: 'Не удалось подключиться к relay.',
    rejected: 'Сопряжение было отклонено на ПК.',
    revoked: 'Мобильное подключение отключено в NekoGPT на ПК.',
    notApproved: 'Подключение к NekoGPT ещё не завершено.',
    commandFailed: 'ПК не смог выполнить команду.',
    invalidProtocol: 'От relay получено недопустимое сообщение.',
    incompleteBundle: 'Пакет Live2D получен не полностью.',
    genericError: 'Произошла ошибка.',
  },
};

function normalizeAppLanguage(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'pt' || raw === 'pt-br') return 'pt-BR';
  if (raw === 'zh' || raw === 'zh-cn' || raw === 'zh-hans') return 'zh-CN';
  const base = raw.split('-')[0];
  if (base === 'en' || base === 'es' || base === 'fr' || base === 'it' || base === 'ja' || base === 'ru') return base;
  return null;
}

function getCurrentAppLanguage() {
  try {
    const saved = normalizeAppLanguage(localStorage.getItem('nekogpt:language'));
    if (saved) return saved;
  } catch {}
  const preferred = [navigator.language, ...(navigator.languages || [])];
  for (const value of preferred) {
    const normalized = normalizeAppLanguage(value);
    if (normalized) return normalized;
  }
  return 'pt-BR';
}

function updateBackgroundDescription() {
  const controls = document.querySelector('.companion-screen .settings-panel .background-controls');
  const section = controls?.closest('.settings-section');
  const description = section?.querySelector('p');
  if (!description) return;
  const language = getCurrentAppLanguage();
  const text = backgroundDescriptionByLanguage[language] || backgroundDescriptionByLanguage['pt-BR'];
  if (description.textContent !== text) description.textContent = text;
}

const errorStatusPattern = /permission|dismissed|denied|erro|error|failed|falhou|failure|timeout|timed out|tempo limite|tempo-limite|excedeu|unable|could not|n[aã]o foi poss[ií]vel|negad|imposs[ií]vel|fall[oó]|tiempo de espera|[eé]chec|d[eé]lai|impossible|errore|impossibile|エラー|失敗|タイムアウト|错误|失败|超时|ошиб|не удалось|тайм-аут/i;
const rawForeignErrorPattern = /permission|dismissed|denied|error|failed|failure|timeout|timed out|unable|could not|not connected|not approved|closed|unreachable|invalid|offline|n[aã]o foi poss[ií]vel|falhou|erro|excedeu|negad|encerrad|recusad|desligad|incompleto/i;

function classifyRawNotification(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  if (/permission\s+dismissed/i.test(text)) return 'permissionDismissed';
  if (/permission\s+denied|notallowederror|permission.*blocked/i.test(text)) return 'permissionDenied';
  if (/live2d(?:\.bundle|\s+model|\s+modelo)?.*(timeout|timed out|tempo limite|excedeu|超时|тайм)/i.test(text)) return 'bundleTimeout';
  if (/desktop.*offline|pc.*offline|ficou offline/i.test(text)) return 'desktopOffline';
  if (/could not reach.*relay|unreachable.*relay|alcançar o relay|alcanzar el relay|joindre le relay|raggiungere il relay/i.test(text)) return 'relayUnreachable';
  if (/not approved|ainda n[aã]o foi conclu[ií]da|not.*completed yet/i.test(text)) return 'notApproved';
  if (/pairing.*rejected|pareamento.*recusado|emparejamiento.*rechazado|appairage.*refus/i.test(text)) return 'rejected';
  if (/revoked|mobile connection.*disabled|conex[aã]o m[oó]vel.*desligada/i.test(text)) return 'revoked';
  if (/rpc.*failed|command.*failed|could not execute.*command|n[aã]o conseguiu executar o comando/i.test(text)) return 'commandFailed';
  if (/invalid.*message|invalid.*protocol|mensagem inv[aá]lida/i.test(text)) return 'invalidProtocol';
  if (/incomplete.*live2d|live2d.*incomplete|pacote live2d.*incompleto/i.test(text)) return 'incompleteBundle';
  if (/connection.*closed|connection.*ended|conex[aã]o.*encerrada|conex[aã]o encerrada/i.test(text)) return 'connectionClosed';
  if (/timeout|timed out|tempo limite|tempo-limite|excedeu|tiempo de espera|d[eé]lai|タイムアウト|超时|тайм-аут/i.test(text)) return 'timeout';
  return null;
}

function localizeNotification(raw, language) {
  const dictionary = notificationTranslations[language] || notificationTranslations['pt-BR'];
  const key = classifyRawNotification(raw);
  if (key && dictionary[key]) return dictionary[key];
  if (language !== 'en' && rawForeignErrorPattern.test(raw)) return dictionary.genericError;
  if (language === 'en' && /n[aã]o foi poss[ií]vel|falhou|erro|excedeu|negad|encerrad|recusad|desligad|incompleto/i.test(raw)) return dictionary.genericError;
  return raw;
}

function translateNotificationNode(node, language) {
  if (!(node instanceof HTMLElement)) return { raw: '', translated: '' };
  const current = (node.textContent || '').trim();
  const previousTranslated = node.dataset.nekogptTranslatedText || '';
  if (!node.dataset.nekogptOriginalText || current !== previousTranslated) {
    node.dataset.nekogptOriginalText = current;
  }
  const raw = node.dataset.nekogptOriginalText || current;
  const translated = localizeNotification(raw, language);
  if (translated && current !== translated) node.textContent = translated;
  node.dataset.nekogptTranslatedText = translated;
  return { raw, translated };
}

function updateNotificationUi() {
  const language = getCurrentAppLanguage();

  document.querySelectorAll('.companion-screen .notice').forEach((notice) => {
    translateNotificationNode(notice, language);
  });

  document.querySelectorAll('.companion-screen .companion-status').forEach((status) => {
    const textNode = status.querySelector('span:not(.status-orb)') || status;
    const { raw, translated } = translateNotificationNode(textNode, language);
    const source = `${raw} ${translated}`;
    status.classList.toggle('nekogpt-error-status', errorStatusPattern.test(source));
  });
}

let pendingMediaSend = null;
let clearTimer = null;
const sentMediaSelector = '.app-message-line--user .app-message-attachments img, .app-message-line--user .app-message-attachments video';

function getComposer() {
  return document.querySelector('.floating-composer');
}

function composerHasMediaPreview() {
  const composer = getComposer();
  return Boolean(composer?.querySelector('.media-preview-card img, .media-preview-card video'));
}

function armMediaPreviewClear() {
  if (!composerHasMediaPreview()) return;
  const knownMedia = new WeakSet(document.querySelectorAll(sentMediaSelector));
  pendingMediaSend = { knownMedia, expiresAt: Date.now() + 15000 };
}

function clearComposerPreview() {
  const composer = getComposer();
  if (!composer) return;
  const preview = composer.querySelector('.media-preview-card');
  if (!preview) return;
  const removeButton = preview.querySelector('button');
  if (removeButton) removeButton.click();
  else preview.remove();
  composer.querySelectorAll('input[type="file"]').forEach((input) => {
    try { input.value = ''; } catch {}
  });
}

function tryClearPreviewAfterSuccessfulSend() {
  if (!pendingMediaSend) return;
  if (Date.now() > pendingMediaSend.expiresAt) {
    pendingMediaSend = null;
    return;
  }
  const hasNewSentMedia = Array.from(document.querySelectorAll(sentMediaSelector)).some(
    (media) => !pendingMediaSend.knownMedia.has(media),
  );
  if (!hasNewSentMedia) return;
  pendingMediaSend = null;
  if (clearTimer) window.clearTimeout(clearTimer);
  clearTimer = window.setTimeout(() => {
    clearTimer = null;
    clearComposerPreview();
  }, 60);
}

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('.floating-composer .send-paw-button')) armMediaPreviewClear();
}, true);

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('.floating-composer')) armMediaPreviewClear();
}, true);

document.addEventListener('change', () => {
  window.setTimeout(() => {
    updateBackgroundDescription();
    updateNotificationUi();
  }, 0);
}, true);

window.addEventListener('storage', (event) => {
  if (event.key === 'nekogpt:language') {
    updateBackgroundDescription();
    updateNotificationUi();
  }
});

const root = document.getElementById('root');
if (root) {
  new MutationObserver(() => {
    tryClearPreviewAfterSuccessfulSend();
    updateBackgroundDescription();
    updateNotificationUi();
  }).observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

updateBackgroundDescription();
updateNotificationUi();
