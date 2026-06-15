import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { zipSync } from 'fflate'
import WebSocket from 'ws'

const mobileRoot = process.cwd()
const desktopRoot = path.resolve(mobileRoot, '..', 'waifuprogramming-experiencia')
const modelRoot = process.env.NEKO_MODEL_ROOT
  ? path.resolve(process.env.NEKO_MODEL_ROOT)
  : path.join(desktopRoot, 'public', 'onboarding-guide', 'live2d', 'dororong', 'Doro')
const modelFile = process.env.NEKO_MODEL_FILE || 'Doro.model3.json'
const modelId = process.env.NEKO_MODEL_ID || path.basename(modelRoot).toLowerCase()
const modelName = process.env.NEKO_MODEL_NAME || path.basename(modelRoot)
const relayUrl = process.env.NEKO_RELAY_URL || 'ws://127.0.0.1:8787/connect'
const room = (process.env.NEKO_ROOM || 'TEST42').toUpperCase()

async function collectModelFiles(root, modelFile) {
  const output = {}
  const pending = [modelFile]

  while (pending.length) {
    const relative = pending.pop()
    const absolute = path.resolve(root, relative)
    const relativeFromRoot = path.relative(root, absolute).replaceAll(path.sep, '/')
    if (
      !relativeFromRoot
      || relativeFromRoot.startsWith('../')
      || path.isAbsolute(relativeFromRoot)
      || output[relativeFromRoot]
    ) {
      continue
    }
    const info = await stat(absolute).catch(() => null)
    if (!info?.isFile()) continue
    const bytes = new Uint8Array(await readFile(absolute))
    output[relativeFromRoot] = bytes
    if (!relativeFromRoot.toLowerCase().endsWith('.json')) continue

    const baseDir = path.dirname(relativeFromRoot)
    const visit = (value) => {
      if (typeof value === 'string') {
        const rawCandidate = value.split(/[?#]/, 1)[0].replaceAll('\\', '/')
        let candidate = rawCandidate
        try {
          candidate = decodeURIComponent(rawCandidate)
        } catch {}
        if (!candidate || /^(?:[a-z]+:|data:)/i.test(candidate)) return
        const referenced = candidate.startsWith('/')
          ? candidate.replace(/^\/+/, '')
          : path.join(baseDir, candidate)
        pending.push(referenced.replaceAll(path.sep, '/'))
        return
      }
      if (Array.isArray(value)) {
        value.forEach(visit)
        return
      }
      if (value && typeof value === 'object') Object.values(value).forEach(visit)
    }
    visit(JSON.parse(new TextDecoder().decode(bytes)))
  }

  return output
}

const modelZip = Buffer.from(zipSync(await collectModelFiles(modelRoot, modelFile), { level: 1 }))
const encodedModel = modelZip.toString('base64')
const chunkSize = 96 * 1024
const totalChunks = Math.max(1, Math.ceil(encodedModel.length / chunkSize))
const socket = new WebSocket(`${relayUrl}?role=desktop&room=${encodeURIComponent(room)}`)
const resumeToken = 'fake-desktop-resume-token'
let fakeHistory = {
  sessionId: 'test-session',
  title: 'Teste no celular',
  assistantName: 'CatGPT',
  assistantAvatarUrl: '',
  messages: [{
    id: 'welcome-message',
    role: 'assistant',
    content: 'Conexão pronta. Este é o histórico compartilhado de teste.',
    createdAt: new Date().toISOString(),
  }],
}

function send(message) {
  socket.send(JSON.stringify(message))
}

function sendBundle(transferId) {
  for (let index = 0; index < totalChunks; index += 1) {
    send({
      type: 'live2d.bundle.chunk',
      transferId,
      index,
      totalChunks,
      data: encodedModel.slice(index * chunkSize, (index + 1) * chunkSize),
    })
  }
}

function live2dSnapshot(emotion = 'happy') {
  return {
    currentStateId: 'testing-happy',
    currentStateName: 'Testing Happy',
    stateEnabled: true,
    stateMode: 'manual',
    live2dAction: {
      stateId: 'testing-happy',
      kind: 'expression',
      value: 'Exp1',
      intervalMs: 2500,
    },
    expressionMap: {
      happy: 'Exp1',
      surprised: 'Exp3',
      shy: 'Exp5',
      love: 'TongueOut',
    },
    motionMap: {},
    expressionPreset: '',
    motionPreset: '',
    autoExpressionsEnabled: true,
    autoMotionsEnabled: true,
    maxFps: 60,
    speakingMotionEnabled: true,
    speakingMotionIntensity: 0.8,
    speakingMotionSpeed: 2,
    speakingMotionBodyFollow: 0.5,
    speakingMotionVolumeThreshold: 0.02,
    speakingMotionSmoothing: 0.85,
    listeningMotionEnabled: true,
    listeningMotionIntensity: 0.8,
    listeningMotionSpeed: 1.4,
    listeningMotionBodyFollow: 0.4,
    listeningMotionVolumeThreshold: 0.008,
    listeningMotionSmoothing: 0.88,
    emotion,
    updatedAt: Date.now(),
  }
}

socket.on('open', () => {
  console.log(`Fake desktop online: room=${room}, model=${modelName}, bytes=${modelZip.length}`)
})

socket.on('message', (raw) => {
  const message = JSON.parse(raw.toString())

  if (message.type === 'pair.request') {
    send({
      type: 'pair.approved',
      payload: {
        deviceName: 'NekoGPT desktop de teste',
        resumeToken,
        resumed: message.payload?.resumeToken === resumeToken,
      },
    })
    send({ type: 'companion.snapshot', payload: {
      appName: 'NekoGPT',
      version: 'local-test',
      modelId,
      modelName,
      modelFile,
      provider: 'Teste local',
      ttsEnabled: true,
      visionEnabled: true,
      live2d: live2dSnapshot('happy'),
    } })
    setTimeout(() => send({ type: 'live2d.expression', payload: { emotion: 'surprised', live2d: live2dSnapshot('surprised') } }), 2200)
    setTimeout(() => send({
      type: 'live2d.speech',
      payload: {
        active: true,
        text: 'Teste de fala com movimento e expressão.',
        subtitle: 'Teste de fala com movimento e expressão.',
        emotion: 'shy',
        durationMs: 3600,
        mouthOpen: 0.75,
        live2d: live2dSnapshot('shy'),
      },
    }), 4200)
    setTimeout(() => send({ type: 'live2d.speech', payload: { active: false } }), 8000)
    return
  }

  if (message.type === 'live2d.bundle.ready') {
    sendBundle(message.transferId)
    return
  }

  if (message.type !== 'rpc.request') return

  const { id, method, params } = message
  let result

  if (method === 'companion.snapshot') {
    result = {
      appName: 'NekoGPT',
      version: 'local-test',
      modelId,
      modelName,
      modelFile,
      provider: 'Teste local',
      ttsEnabled: true,
      visionEnabled: true,
      live2d: live2dSnapshot('happy'),
    }
  } else if (method === 'live2d.bundle') {
    result = {
      transferId: `bundle-${Date.now()}`,
      totalChunks,
      byteLength: modelZip.length,
      modelFile,
      modelId,
      modelName,
    }
  } else if (method === 'companion.chat.history') {
    result = fakeHistory
  } else if (method === 'chat.send') {
    const latestMessage = typeof params?.text === 'string' ? params.text.trim() : ''
    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: latestMessage || 'mensagem vazia',
      createdAt: new Date().toISOString(),
    }
    const assistantMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: params?.visionImage
        ? `Visão recebida junto da mensagem: ${latestMessage || 'mensagem vazia'}`
        : `Resposta do PC: ${latestMessage || 'mensagem vazia'}`,
      createdAt: new Date().toISOString(),
    }
    fakeHistory = {
      ...fakeHistory,
      messages: [...fakeHistory.messages, userMessage, assistantMessage],
    }
    result = {
      content: assistantMessage.content,
      emotion: 'happy',
      history: fakeHistory,
    }
    send({ type: 'chat.history', payload: fakeHistory })
  } else if (method === 'voice.transcribe') {
    result = { text: 'Transcrição de voz simulada', provider: 'Teste local' }
  } else if (method === 'live2d.touch') {
    result = {
      text: params?.interaction === 'head-pat'
        ? 'Nyaa... esse carinho foi bom.'
        : `Ei! Você tocou em ${params?.area || 'mim'}.`,
      emotion: params?.interaction === 'head-pat' ? 'happy' : 'surprised',
      speak: true,
    }
  } else {
    result = { ok: true }
  }

  send({ type: 'rpc.response', id, ok: true, result })
})

socket.on('close', () => process.exit(0))
socket.on('error', (error) => {
  console.error(error)
  process.exit(1)
})
