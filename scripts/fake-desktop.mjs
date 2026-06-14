import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { zipSync } from 'fflate'
import WebSocket from 'ws'

const mobileRoot = process.cwd()
const desktopRoot = path.resolve(mobileRoot, '..', 'waifuprogramming-experiencia')
const modelRoot = path.join(desktopRoot, 'live2d-models', 'catgpt')
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

const modelZip = Buffer.from(zipSync(await collectModelFiles(modelRoot, 'catgpt.model3.json'), { level: 1 }))
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

socket.on('open', () => {
  console.log(`Fake desktop online: room=${room}, model=${modelZip.length} bytes`)
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
      modelId: 'catgpt',
      modelName: 'CatGPT',
      modelFile: 'catgpt.model3.json',
      provider: 'Teste local',
      ttsEnabled: true,
      visionEnabled: true,
    }
  } else if (method === 'live2d.bundle') {
    result = {
      transferId: `bundle-${Date.now()}`,
      totalChunks,
      byteLength: modelZip.length,
      modelFile: 'catgpt.model3.json',
      modelId: 'catgpt',
      modelName: 'CatGPT',
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
