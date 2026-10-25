/**
 * Star detection task engine — completely outside the SPA render loop.
 *
 * Diagnosis of the old flicker bug:
 * - Fixation `.on` was toggled every phase (off during target/feedback)
 * - ITI called setTrialState every 100ms → patchOptimizeDOM churn
 * - subscribe(() => render()) could still remount when flags slipped
 *
 * This module: mount once → controlled timers → only star visibility changes.
 * SPACEBAR detection; HRTF cue via playSpatialTone (not L/R gain pan).
 */

import { CONFIG } from './config.js'
import { playSpatialTone, ensureAudio } from './audio.js'
import { sleep, randInt, conditionLabel } from './state.js'

/**
 * @param {HTMLElement} host
 * @param {{
 *   trials: object[],
 *   blockLabel: string,
 *   conditionIndex: number,
 *   conditionCount: number,
 *   angleDeg: number|null,
 *   showTrialFeedback?: boolean,
 *   shouldAbort?: () => boolean,
 * }} opts
 * @returns {Promise<object[]>}
 */
export async function runStarBlock(host, opts) {
  const {
    trials,
    blockLabel,
    conditionIndex,
    conditionCount,
    angleDeg,
    showTrialFeedback = false,
    shouldAbort = () => false,
  } = opts

  await ensureAudio().catch(() => {})

  // Mount stage ONCE — fixation is always present (never toggled off).
  host.innerHTML = `
    <div class="star-task" id="starTaskRoot" tabindex="0" role="application" aria-label="Star detection task">
      <p class="space-instruction" id="starSpaceHint">Press <kbd>SPACEBAR</kbd> when you see a star.</p>
      <div class="status-board compact">
        <div class="status-big">${conditionLabel(angleDeg)}</div>
        <div class="status-meta">
          <span class="block-label ${blockLabel === 'held_out' ? 'held' : ''}">${blockLabel === 'held_out' ? 'held-out' : blockLabel}</span>
          <span id="starTrialMeta">Trial 1 / ${trials.length}</span>
          <span>Condition ${conditionIndex + 1} / ${conditionCount}</span>
        </div>
      </div>
      <div class="progress-bar"><span id="starProgress" style="width:0%"></span></div>
      <div class="trial-stage fullscreenish star-stage" id="starStage">
        <div class="fixation static-fix" id="starFixation" aria-hidden="true"></div>
        <div class="star left" id="starL" hidden>★</div>
        <div class="star right" id="starR" hidden>★</div>
        <div class="key-registered" id="starRegistered" hidden>Registered</div>
        <div class="stage-feedback" id="starFb" hidden></div>
      </div>
      <p class="trial-prompt" id="starPrompt">Keep eyes on the center cross.</p>
    </div>
  `

  const root = host.querySelector('#starTaskRoot')
  const starL = host.querySelector('#starL')
  const starR = host.querySelector('#starR')
  const registeredEl = host.querySelector('#starRegistered')
  const fbEl = host.querySelector('#starFb')
  const metaEl = host.querySelector('#starTrialMeta')
  const progEl = host.querySelector('#starProgress')
  const promptEl = host.querySelector('#starPrompt')

  // Focus so keydown fires without clicking elsewhere
  root.focus({ preventScroll: true })

  let listening = false
  let pressed = false
  let pressRt = null
  let onsetTs = 0
  let registeredTimer = null

  function flashRegistered() {
    registeredEl.hidden = false
    clearTimeout(registeredTimer)
    registeredTimer = setTimeout(() => {
      registeredEl.hidden = true
    }, 280)
  }

  function onKeyDown(e) {
    if (e.code !== 'Space' && e.key !== ' ') return
    e.preventDefault()
    // Always show key feedback while the stage is focused (demo must feel responsive).
    flashRegistered()
    // Only the first press inside the response window counts for scoring.
    if (!listening || pressed) return
    pressed = true
    pressRt = performance.now() - onsetTs
  }

  // Attach ONCE for the whole block
  root.addEventListener('keydown', onKeyDown)

  function hideStars() {
    starL.hidden = true
    starR.hidden = true
  }

  function showStar(side) {
    hideStars()
    if (side === 'left') starL.hidden = false
    if (side === 'right') starR.hidden = false
  }

  function setMeta(i) {
    metaEl.textContent = `Trial ${i + 1} / ${trials.length}`
    progEl.style.width = `${Math.round((i / trials.length) * 100)}%`
  }

  const results = []

  try {
    for (let i = 0; i < trials.length; i++) {
      if (shouldAbort()) break

      const trial = { ...trials[i] }
      setMeta(i)
      hideStars()
      fbEl.hidden = true
      registeredEl.hidden = true
      pressed = false
      pressRt = null
      listening = false
      promptEl.textContent = 'Keep eyes on the center cross.'

      // Pre-stimulus fixation — cross already static; just wait
      await sleep(trial.fixationMs ?? randInt(CONFIG.fixationMsMin, CONFIG.fixationMsMax))
      if (shouldAbort()) break

      const flashMs = randInt(CONFIG.starFlashMsMin, CONFIG.starFlashMsMax)

      // Open response window at (or just before) star onset
      onsetTs = performance.now()
      listening = true

      // HRTF cue near star onset on cued blocks
      if (trial.condition_angle_deg != null) {
        playSpatialTone(trial.condition_angle_deg, {
          durationMs: CONFIG.cueDurationMs,
          frequencyHz: CONFIG.cueFrequencyHz,
          gain: CONFIG.cueGain,
        })
        if (CONFIG.cueLeadMs > 0) await sleep(CONFIG.cueLeadMs)
      }

      // Flash star (or blank catch)
      if (trial.target === 'left' || trial.target === 'right') {
        showStar(trial.target)
        promptEl.textContent = ' '
        await sleep(flashMs)
        hideStars() // intended disappear
      } else {
        // catch — no star
        promptEl.textContent = ' '
        await sleep(flashMs)
      }

      // Remainder of response window after flash
      const elapsed = performance.now() - onsetTs
      const remain = Math.max(0, CONFIG.responseWindowMs - elapsed)
      if (remain > 0) await sleep(remain)
      listening = false

      const response = pressed ? 'space' : null
      const rtMs = pressRt != null ? Math.round(pressRt) : null
      let correct
      if (trial.target === 'catch') {
        correct = response == null
      } else {
        correct = response === 'space'
      }

      const finished = {
        ...trial,
        response,
        rtMs,
        correct,
        flash_ms: flashMs,
      }
      results.push(finished)

      if (showTrialFeedback) {
        let text = ''
        let cls = 'fb-ok'
        if (trial.target === 'catch') {
          if (response) {
            text = 'False alarm — no star'
            cls = 'fb-miss'
          } else {
            text = 'Good — no star'
          }
        } else if (response) {
          text = 'Hit'
        } else {
          text = 'Miss'
          cls = 'fb-miss'
        }
        fbEl.textContent = text
        fbEl.className = `stage-feedback on ${cls}`
        fbEl.hidden = false
        await sleep(CONFIG.feedbackMs)
        fbEl.hidden = true
      }

      progEl.style.width = `${Math.round(((i + 1) / trials.length) * 100)}%`
      if (i < trials.length - 1 && !shouldAbort()) {
        promptEl.textContent = 'Keep eyes on the center cross.'
        await sleep(CONFIG.itiMs)
      }
    }
  } finally {
    root.removeEventListener('keydown', onKeyDown)
    clearTimeout(registeredTimer)
    hideStars()
  }

  return results
}

/**
 * Build a short practice queue (mixed L/R/catch), no cue angle.
 */
export function buildPracticeTrials(n = CONFIG.practiceTrials) {
  const targets = []
  for (let i = 0; i < n; i++) {
    if (i === n - 1) targets.push('catch')
    else targets.push(i % 2 === 0 ? 'left' : 'right')
  }
  return targets.map((target, i) => ({
    id: `practice_${i}`,
    block: 'practice',
    condition_angle_deg: null,
    target,
    fixationMs: randInt(CONFIG.fixationMsMin, CONFIG.fixationMsMax),
  }))
}
