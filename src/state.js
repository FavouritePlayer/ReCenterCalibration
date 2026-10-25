import { CONFIG, STORAGE_KEY } from './config.js'

const listeners = new Set()

export const state = {
  view: 'home', // home | localization | optimize | results | eeg
  participantId: '',
  notes: '',
  demoMode: true,
  localizationOk: null,
  localizationTrials: [],
  localizationSummary: null,
  /** Current optimize phase: 'calibration' | 'held_out' | 'done' */
  optimizePhase: null,
  conditionOrder: [],
  conditionIndex: 0,
  trialIndex: 0,
  trialQueue: [],
  calibrationTrials: [],
  heldOutTrials: [],
  calibrationResults: null,
  heldOutResults: null,
  selection: null,
  exportPayload: null,
  /** Live trial UI */
  trialPhase: 'idle', // idle | ready | fixation | cue | target | response | feedback | iti | condition_done
  currentTrial: null,
  lastFeedback: null, // 'correct' | 'miss' | 'catch_ok' | 'false_alarm' | null
  itiRemainingMs: 0,
  conditionTrialsDone: [],
  lastConditionSummary: null,
  optimizeUi: 'idle', // idle | ready_block | live | condition_done | done
  lastKey: null,
  warnLocalization: false,
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function emit() {
  for (const fn of listeners) fn(state)
}

export function setState(patch) {
  Object.assign(state, patch)
  emit()
}

export function resetSessionKeepId() {
  setState({
    localizationOk: null,
    localizationTrials: [],
    localizationSummary: null,
    optimizePhase: null,
    conditionOrder: [],
    conditionIndex: 0,
    trialIndex: 0,
    trialQueue: [],
    calibrationTrials: [],
    heldOutTrials: [],
    calibrationResults: null,
    heldOutResults: null,
    selection: null,
    exportPayload: null,
    trialPhase: 'idle',
    currentTrial: null,
    lastFeedback: null,
    itiRemainingMs: 0,
    conditionTrialsDone: [],
    lastConditionSummary: null,
    optimizeUi: 'idle',
    warnLocalization: false,
  })
}

export function conditionLabel(angleDeg) {
  return angleDeg === null || angleDeg === undefined ? 'NO-CUE' : `${angleDeg}°`
}

export function buildAngleOrder() {
  const angles = [
    ...CONFIG.candidateAnglesDeg,
    ...(CONFIG.includeNoCue ? [null] : []),
  ]
  return shuffle(angles)
}

export function trialsPerCondition() {
  return state.demoMode ? CONFIG.demoTrialsPerCondition : CONFIG.trialsPerCondition
}

export function heldOutTrialsPerCondition() {
  return state.demoMode
    ? CONFIG.demoHeldOutTrialsPerCondition
    : CONFIG.heldOutTrialsPerCondition
}

export function saveToLocalStorage(payload) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch (e) {
    console.warn('localStorage write failed', e)
  }
}

export function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function downloadJSON(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Fisher–Yates */
export function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Build a block of trials for one condition angle (null = no-cue).
 */
export function buildConditionTrials(angleDeg, n, blockLabel) {
  const nCatch = Math.max(1, Math.round(n * CONFIG.catchTrialRate))
  const nTarget = n - nCatch
  const nLeft = Math.round(nTarget * CONFIG.leftTargetRate)
  const nRight = nTarget - nLeft
  const targets = [
    ...Array(nLeft).fill('left'),
    ...Array(nRight).fill('right'),
    ...Array(nCatch).fill('catch'),
  ]
  return shuffle(targets).map((target, i) => ({
    id: `${blockLabel}_${angleDeg ?? 'nocue'}_${i}_${Math.random().toString(36).slice(2, 7)}`,
    block: blockLabel,
    condition_angle_deg: angleDeg,
    target,
    response: null,
    rtMs: null,
    correct: null,
    fixationMs: randInt(CONFIG.fixationMsMin, CONFIG.fixationMsMax),
  }))
}

export function buildOptimizeQueue(blockLabel, nPerCond) {
  const angles = [
    ...CONFIG.candidateAnglesDeg,
    ...(CONFIG.includeNoCue ? [null] : []),
  ]
  const order = shuffle(angles)
  const queue = []
  for (const angle of order) {
    queue.push(...buildConditionTrials(angle, nPerCond, blockLabel))
  }
  return { order, queue }
}
