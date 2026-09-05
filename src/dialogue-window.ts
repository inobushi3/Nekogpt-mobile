type DialogueMessageLike = {
  id?: unknown;
  role?: unknown;
  content?: unknown;
  createdAt?: unknown;
};

const nativeArraySlice = Array.prototype.slice;
let installed = false;

function isDialogueMessage(value: unknown): value is DialogueMessageLike {
  if (!value || typeof value !== 'object') return false;
  const message = value as DialogueMessageLike;
  return (
    typeof message.id === 'string'
    && (message.role === 'assistant' || message.role === 'user')
    && typeof message.content === 'string'
    && typeof message.createdAt === 'string'
  );
}

function isDialogueHistorySlice(value: unknown[], start: unknown, end: unknown) {
  if (start !== -2 || end !== undefined || value.length < 3) return false;
  const sampleStart = Math.max(0, value.length - 3);
  for (let index = sampleStart; index < value.length; index += 1) {
    if (!isDialogueMessage(value[index])) return false;
  }
  return true;
}

/**
 * The companion screen historically requested the final two chat entries.
 * Keep that implementation untouched while expanding only MobileChatMessage
 * history slices to the final three entries. The shape guard prevents normal
 * Array#slice calls elsewhere in React/the app from being affected.
 */
export function installDialogueWindow() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  Object.defineProperty(Array.prototype, 'slice', {
    configurable: true,
    writable: true,
    value: function patchedSlice(this: unknown[], start?: number, end?: number) {
      if (isDialogueHistorySlice(this, start, end)) {
        return Reflect.apply(nativeArraySlice, this, [-3]);
      }
      return Reflect.apply(nativeArraySlice, this, [start, end]);
    },
  });
}
