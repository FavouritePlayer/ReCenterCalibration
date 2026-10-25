/**
 * HRTF spatial audio via Web Audio API PannerNode.
 * Raw L/R gain panning is intentionally not used.
 */

let ctx = null
let listenerConfigured = false

export function getAudioContext() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)()
  }
  return ctx
}

export async function ensureAudio() {
  const ac = getAudioContext()
  if (ac.state === 'suspended') {
    await ac.resume()
  }
  if (!listenerConfigured) {
    const listener = ac.listener
    // Listener faces −Z (default Web Audio), ears along ±X.
    if (listener.positionX) {
      listener.positionX.setValueAtTime(0, ac.currentTime)
      listener.positionY.setValueAtTime(0, ac.currentTime)
      listener.positionZ.setValueAtTime(0, ac.currentTime)
      listener.forwardX.setValueAtTime(0, ac.currentTime)
      listener.forwardY.setValueAtTime(0, ac.currentTime)
      listener.forwardZ.setValueAtTime(-1, ac.currentTime)
      listener.upX.setValueAtTime(0, ac.currentTime)
      listener.upY.setValueAtTime(1, ac.currentTime)
      listener.upZ.setValueAtTime(0, ac.currentTime)
    }
    listenerConfigured = true
  }
  return ac
}

/**
 * Convert azimuth degrees (0 = front, negative = left, positive = right)
 * to a unit-circle position around the listener on the horizontal plane.
 */
export function azimuthToPosition(azimuthDeg, distance = 1.2) {
  const rad = (azimuthDeg * Math.PI) / 180
  return {
    x: Math.sin(rad) * distance,
    y: 0,
    z: -Math.cos(rad) * distance,
  }
}

/**
 * Play a short tone at `azimuthDeg` using HRTF panning.
 * @param {number|null} azimuthDeg — null skips playback (no-cue)
 * @param {object} opts
 */
export async function playSpatialTone(azimuthDeg, opts = {}) {
  if (azimuthDeg === null || azimuthDeg === undefined) return
  const {
    durationMs = 120,
    frequencyHz = 880,
    gain = 0.22,
  } = opts

  const ac = await ensureAudio()
  const t0 = ac.currentTime
  const dur = durationMs / 1000

  const osc = ac.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(frequencyHz, t0)

  // Soft envelope to avoid clicks
  const env = ac.createGain()
  env.gain.setValueAtTime(0.0001, t0)
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.012)
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)

  const panner = ac.createPanner()
  panner.panningModel = 'HRTF'
  panner.distanceModel = 'inverse'
  panner.refDistance = 1
  panner.maxDistance = 10
  panner.rolloffFactor = 1
  panner.coneInnerAngle = 360
  panner.coneOuterAngle = 360

  const { x, y, z } = azimuthToPosition(azimuthDeg)
  if (panner.positionX) {
    panner.positionX.setValueAtTime(x, t0)
    panner.positionY.setValueAtTime(y, t0)
    panner.positionZ.setValueAtTime(z, t0)
  } else {
    panner.setPosition(x, y, z)
  }

  osc.connect(env)
  env.connect(panner)
  panner.connect(ac.destination)

  osc.start(t0)
  osc.stop(t0 + dur + 0.02)

  return new Promise((resolve) => {
    osc.onended = () => resolve()
  })
}

export async function playLocalizationBurst(azimuthDeg, opts = {}) {
  return playSpatialTone(azimuthDeg, {
    durationMs: 280,
    frequencyHz: 750,
    gain: 0.28,
    ...opts,
  })
}
