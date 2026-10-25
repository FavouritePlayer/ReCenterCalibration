/**
 * Optimize screen orchestration (instructions → practice → blocks → export).
 * Live trials run inside starTask.js — never through the SPA render loop.
 */

import { CONFIG } from './config.js'
import {
  state,
  setState,
  trialsPerCondition,
  heldOutTrialsPerCondition,
  buildConditionTrials,
  buildAngleOrder,
  saveToLocalStorage,
  conditionLabel,
} from './state.js'
import {
  summarizeByAngle,
  summarizeCondition,
  selectAngle,
  buildExportPayload,
} from './analysis.js'
import { runStarBlock, buildPracticeTrials } from './starTask.js'
import { ensureAudio } from './audio.js'

let abortFlag = false
let blockStartResolver = null
let continueResolver = null
let instructionsStartResolver = null

export function requestOptimizeAbort() {
  abortFlag = true
  if (blockStartResolver) {
    const r = blockStartResolver
    blockStartResolver = null
    r()
  }
  if (continueResolver) {
    const r = continueResolver
    continueResolver = null
    r()
  }
  if (instructionsStartResolver) {
    const r = instructionsStartResolver
    instructionsStartResolver = null
    r()
  }
}

export function isOptimizeAborting() {
  return abortFlag
}

export function resolveBlockStart() {
  if (blockStartResolver) {
    const r = blockStartResolver
    blockStartResolver = null
    r()
  }
}

export function resolveContinue() {
  if (continueResolver) {
    const r = continueResolver
    continueResolver = null
    r()
  }
}

export function resolveInstructionsStart() {
  if (instructionsStartResolver) {
    const r = instructionsStartResolver
    instructionsStartResolver = null
    r()
  }
}

function waitBlockStart() {
  return new Promise((resolve) => {
    blockStartResolver = resolve
  })
}

function waitContinue() {
  return new Promise((resolve) => {
    continueResolver = resolve
  })
}

function waitInstructionsStart() {
  return new Promise((resolve) => {
    instructionsStartResolver = resolve
  })
}

function waitForHost(id, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now()
    const tick = () => {
      const el = document.getElementById(id)
      if (el) return resolve(el)
      if (performance.now() - t0 > timeoutMs) return reject(new Error(`Missing #${id}`))
      requestAnimationFrame(tick)
    }
    tick()
  })
}

/**
 * Full Optimize protocol. Caller should set optimizeUi via setState between steps.
 * Returns when finished or aborted.
 */
export async function runOptimizeProtocol() {
  abortFlag = false
  await ensureAudio()

  // —— Instructions ——
  setState({
    optimizeUi: 'instructions',
    optimizePhase: null,
    trialPhase: 'idle',
  })
  await waitInstructionsStart()
  if (abortFlag) {
    setState({ optimizeUi: 'idle' })
    return
  }

  // —— Practice (optional, with feedback) ——
  setState({
    optimizeUi: 'live',
    optimizePhase: 'practice',
    conditionOrder: [null],
    conditionIndex: 0,
    trialQueue: [],
  })
  try {
    const host = await waitForHost('starTaskHost')
    const practice = buildPracticeTrials(CONFIG.practiceTrials)
    await runStarBlock(host, {
      trials: practice,
      blockLabel: 'practice',
      conditionIndex: 0,
      conditionCount: 1,
      angleDeg: null,
      showTrialFeedback: true,
      shouldAbort: () => abortFlag,
    })
  } catch (e) {
    console.warn(e)
  }
  if (abortFlag) {
    setState({ optimizeUi: 'idle', optimizePhase: null })
    return
  }

  // —— Calibration blocks ——
  const calOrder = buildAngleOrder()
  const allCal = []
  setState({
    optimizePhase: 'calibration',
    conditionOrder: calOrder,
    conditionIndex: 0,
    calibrationTrials: [],
  })

  for (let ci = 0; ci < calOrder.length; ci++) {
    if (abortFlag) break
    const angle = calOrder[ci]
    setState({
      conditionIndex: ci,
      optimizePhase: 'calibration',
      optimizeUi: 'ready_block',
      currentTrial: null,
    })
    await waitBlockStart()
    if (abortFlag) break

    setState({ optimizeUi: 'live', conditionIndex: ci })
    const queue = buildConditionTrials(angle, trialsPerCondition(), 'calibration')
    let blockTrials = []
    try {
      const host = await waitForHost('starTaskHost')
      blockTrials = await runStarBlock(host, {
        trials: queue,
        blockLabel: 'calibration',
        conditionIndex: ci,
        conditionCount: calOrder.length,
        angleDeg: angle,
        showTrialFeedback: false,
        shouldAbort: () => abortFlag,
      })
    } catch (e) {
      console.warn(e)
    }
    if (abortFlag) break
    allCal.push(...blockTrials)

    setState({
      optimizeUi: 'condition_done',
      lastConditionSummary: summarizeCondition(blockTrials),
      conditionIndex: ci,
      calibrationTrials: [...allCal],
    })
    await waitContinue()
  }

  if (abortFlag) {
    setState({ optimizeUi: 'idle', optimizePhase: null })
    return
  }

  const calibrationResults = summarizeByAngle(allCal)
  const localization =
    state.localizationSummary ||
    (state.localizationOk == null
      ? { localization_ok: false, note: 'Screen 1 skipped' }
      : { localization_ok: state.localizationOk })
  const selection = selectAngle(
    calibrationResults,
    localization.localization_ok === true,
  )

  // —— Held-out ——
  const heldOrder = buildAngleOrder()
  const allHeld = []
  setState({
    optimizePhase: 'held_out',
    conditionOrder: heldOrder,
    conditionIndex: 0,
    calibrationResults,
    selection,
  })

  for (let ci = 0; ci < heldOrder.length; ci++) {
    if (abortFlag) break
    setState({
      conditionIndex: ci,
      optimizePhase: 'held_out',
      optimizeUi: 'ready_block',
    })
    await waitBlockStart()
    if (abortFlag) break

    setState({ optimizeUi: 'live', conditionIndex: ci })
    const queue = buildConditionTrials(
      heldOrder[ci],
      heldOutTrialsPerCondition(),
      'held_out',
    )
    let blockTrials = []
    try {
      const host = await waitForHost('starTaskHost')
      blockTrials = await runStarBlock(host, {
        trials: queue,
        blockLabel: 'held_out',
        conditionIndex: ci,
        conditionCount: heldOrder.length,
        angleDeg: heldOrder[ci],
        showTrialFeedback: false,
        shouldAbort: () => abortFlag,
      })
    } catch (e) {
      console.warn(e)
    }
    if (abortFlag) break
    allHeld.push(...blockTrials)

    setState({
      optimizeUi: 'condition_done',
      lastConditionSummary: summarizeCondition(blockTrials),
      conditionIndex: ci,
      heldOutTrials: [...allHeld],
    })
    await waitContinue()
  }

  if (abortFlag) {
    setState({ optimizeUi: 'idle' })
    return
  }

  const heldOutResults = summarizeByAngle(allHeld)
  const exportPayload = buildExportPayload(
    {
      ...state,
      calibrationTrials: allCal,
      heldOutTrials: allHeld,
      notes: state.notes,
    },
    selection,
    calibrationResults,
    heldOutResults,
    localization,
  )
  saveToLocalStorage(exportPayload)
  setState({
    optimizePhase: 'done',
    optimizeUi: 'done',
    heldOutTrials: allHeld,
    heldOutResults,
    exportPayload,
    view: 'results',
  })
}

export function optimizeOneLiner() {
  return `We're testing whether a left spatial sound cue helps you detect brief LEFT stars. Press <kbd>SPACEBAR</kbd> when you see a star.`
}

export { conditionLabel }
