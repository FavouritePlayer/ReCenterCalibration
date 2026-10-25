import './style.css'
import { CALIBRATION_SCHEMA, CONFIG } from './config.js'
import { ensureAudio, playLocalizationBurst } from './audio.js'
import { analyzeLocalization } from './analysis.js'
import {
  state,
  subscribe,
  setState,
  resetSessionKeepId,
  trialsPerCondition,
  heldOutTrialsPerCondition,
  saveToLocalStorage,
  loadFromLocalStorage,
  downloadJSON,
  shuffle,
  sleep,
} from './state.js'
import {
  runOptimizeProtocol,
  requestOptimizeAbort,
  resolveBlockStart,
  resolveContinue,
  resolveInstructionsStart,
  optimizeOneLiner,
  conditionLabel,
} from './optimizeFlow.js'

window.CALIBRATION_SCHEMA = CALIBRATION_SCHEMA
window.RECENTER_CONFIG = CONFIG

const app = document.querySelector('#app')

let keyHandler = null
let locRunning = false
let locAbort = false

function bindKeys(handler) {
  unbindKeys()
  keyHandler = (e) => handler(e)
  window.addEventListener('keydown', keyHandler)
}

function unbindKeys() {
  if (keyHandler) {
    window.removeEventListener('keydown', keyHandler)
    keyHandler = null
  }
}

function pct(v) {
  if (v == null || Number.isNaN(v)) return '—'
  return `${(v * 100).toFixed(0)}%`
}

function ms(v) {
  if (v == null || Number.isNaN(v)) return '—'
  return `${Math.round(v)} ms`
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;')
}

function shell(inner) {
  return `
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand-name">Re<span>Center</span></div>
          <div class="brand-sub">Calibration Studio</div>
        </div>
        <nav class="nav">
          <button type="button" data-nav="home" class="${state.view === 'home' ? 'active' : ''}">Home</button>
          <button type="button" data-nav="localization" class="${state.view === 'localization' ? 'active' : ''}">1 · Localize</button>
          <button type="button" data-nav="optimize" class="${state.view === 'optimize' ? 'active' : ''}">2 · Optimize</button>
          <button type="button" data-nav="results" class="${state.view === 'results' ? 'active' : ''}">3 · Export</button>
          <button type="button" data-nav="eeg" class="${state.view === 'eeg' ? 'active' : ''}">EEG archive</button>
        </nav>
      </header>
      <div class="honesty-strip">
        <span><strong>Behavioral primary</strong> — detection &amp; RT drive selection</span>
        <span><strong>Held-out separate</strong> — not used to pick the angle</span>
        <span><strong>Compensation ≠ lasting benefit</strong></span>
        <span><strong>Research prototype</strong> — not treatment · headphones only · no EEG required</span>
      </div>
      ${inner}
    </div>
  `
}

function renderHome() {
  const saved = loadFromLocalStorage()
  return shell(`
    <section class="panel home-hero">
      <h1 class="brand-mark">Re<em>Center</em></h1>
      <p class="lede">
        Browser calibration that personalizes a spatial-audio cue angle for left-side
        star detection. HRTF panning only. Export JSON for your player — all client-side.
      </p>
      <div class="steps">
        <div class="step">
          <div class="n">SCREEN 01</div>
          <h3>Localization</h3>
          <p>Can you place left-side azimuths? Gates whether cueing can help.</p>
        </div>
        <div class="step">
          <div class="n">SCREEN 02</div>
          <h3>Angle search</h3>
          <p>Brief star flashes L/R with HRTF cues at candidate left angles vs no-sound.</p>
        </div>
        <div class="step">
          <div class="n">SCREEN 03</div>
          <h3>Result &amp; export</h3>
          <p>Honest pick (or exploratory default) + held-out check + JSON download.</p>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="pid">Participant ID</label>
          <input id="pid" type="text" value="${escapeAttr(state.participantId)}" placeholder="e.g. pilot-01" />
        </div>
        <div class="field">
          <label class="toggle" style="margin-top:1.4rem">
            <input type="checkbox" id="demoMode" ${state.demoMode ? 'checked' : ''} />
            Quick demo (${CONFIG.demoTrialsPerCondition} trials / condition)
          </label>
        </div>
      </div>
      <div class="actions">
        <button type="button" id="startFull">Start · Screen 1</button>
        <button type="button" class="secondary" id="skipToOptimize">Demo centerpiece · Screen 2</button>
        <button type="button" class="secondary" id="jumpResults" ${state.exportPayload || saved ? '' : 'disabled'}>Open last results</button>
      </div>
      <p class="lede" style="margin-top:1.25rem;margin-bottom:0;font-size:0.85rem">
        Put on stereo headphones before any audio screen. Click once to unlock Web Audio.
      </p>
    </section>
  `)
}

function renderLocalization() {
  const summary = state.localizationSummary
  const total = CONFIG.localizationAnglesDeg.length * CONFIG.localizationRepeats
  const done = state.localizationTrials.length
  const inTrial = locRunning && state.view === 'localization'

  let body = ''
  if (!inTrial && !summary) {
    body = `
      <h1>Auditory localization</h1>
      <p class="lede">
        You will hear short tones at randomized azimuths
        (${CONFIG.localizationAnglesDeg.map((a) => `${a}°`).join(', ')}).
        Indicate the direction you heard. Left-side accuracy gates whether spatial cueing can help.
      </p>
      <div class="actions">
        <button type="button" id="startLoc">Start localization (${total} trials)</button>
        <button type="button" class="secondary" data-nav="home">Back</button>
      </div>
    `
  } else if (inTrial) {
    const progress = Math.round((done / total) * 100)
    body = `
      <div class="trial-hud">
        <span>Localization · trial ${Math.min(done + 1, total)} / ${total}</span>
        <span>HRTF tone</span>
      </div>
      <div class="progress-bar"><span style="width:${progress}%"></span></div>
      <div class="trial-stage waiting" id="locStage">
        <div class="fixation static-fix on"></div>
      </div>
      ${
        state.trialPhase === 'await_report'
          ? `
        <p class="trial-prompt">Where was the sound? Click the angle you heard.</p>
        <div class="angle-picker" id="anglePicker">
          ${CONFIG.localizationAnglesDeg
            .map((a) => `<button type="button" data-angle="${a}">${a > 0 ? '+' : ''}${a}°</button>`)
            .join('')}
        </div>
      `
          : `<p class="trial-prompt">Listen… keep eyes on the cross.</p>`
      }
    `
  } else if (summary) {
    const ok = summary.localization_ok
    body = `
      <h1>Localization results</h1>
      ${
        ok
          ? `<div class="ok-banner">localization_ok = true — left-side accuracy ${pct(summary.left_accuracy)}. Proceed to angle optimization.</div>`
          : `<div class="warn-banner danger">localization_ok = false — left-side accuracy ${pct(summary.left_accuracy)}, mean |error| ${summary.mean_abs_error_deg?.toFixed(0) ?? '—'}°, L/R confusion ${pct(summary.lr_confusion_rate)}. <strong>Cueing may not help</strong> for this listener. You can still run Screen 2, but export will stay exploratory.</div>`
      }
      <div class="metrics-grid">
        <div class="metric"><div class="label">Overall accuracy</div><div class="value">${pct(summary.overall_accuracy)}</div></div>
        <div class="metric"><div class="label">Left accuracy</div><div class="value">${pct(summary.left_accuracy)}</div></div>
        <div class="metric"><div class="label">Mean |error|</div><div class="value">${summary.mean_abs_error_deg?.toFixed(0) ?? '—'}°</div></div>
        <div class="metric"><div class="label">L/R confusion</div><div class="value">${pct(summary.lr_confusion_rate)}</div></div>
      </div>
      <table class="data">
        <thead><tr><th>Angle</th><th>Accuracy</th><th>Mean |err|</th><th>n</th></tr></thead>
        <tbody>
          ${summary.per_angle
            .map(
              (r) =>
                `<tr><td>${r.angle_deg}°</td><td>${pct(r.accuracy)}</td><td>${r.mean_abs_error_deg?.toFixed(0) ?? '—'}°</td><td>${r.n}</td></tr>`,
            )
            .join('')}
        </tbody>
      </table>
      <div class="actions">
        <button type="button" id="toOptimize">${ok ? 'Continue to Screen 2' : 'Continue anyway (warned)'}</button>
        <button type="button" class="secondary" id="redoLoc">Redo localization</button>
      </div>
    `
  }

  return shell(`<section class="panel">${body}</section>`)
}

function renderOptimize() {
  const ui = state.optimizeUi
  const n = trialsPerCondition()
  const nHold = heldOutTrialsPerCondition()
  const nCond = CONFIG.candidateAnglesDeg.length + (CONFIG.includeNoCue ? 1 : 0)
  const warned = state.localizationOk === false

  if (ui === 'done' || state.optimizePhase === 'done') {
    return shell(`
      <section class="panel">
        <h1>Optimization complete</h1>
        <p class="lede">Calibration and held-out blocks finished. Review selection and export on Screen 3.</p>
        <div class="actions">
          <button type="button" data-nav="results">Open results &amp; export</button>
        </div>
      </section>
    `)
  }

  if (ui === 'instructions') {
    return shell(`
      <section class="panel">
        <h1>Instructions</h1>
        <p class="space-instruction">Press <kbd>SPACEBAR</kbd> when you see a star.</p>
        <ul class="instruct-list">
          <li>Keep your eyes on the <strong>center cross</strong> at all times.</li>
          <li>A <strong>star</strong> will flash briefly on the <strong>left or right</strong>, then disappear.</li>
          <li>Press <strong>SPACEBAR</strong> as fast as you can when you see a star.</li>
          <li>A sound may play from one side — keep doing the visual task.</li>
          <li>Some trials have <strong>no star</strong> — do not press.</li>
        </ul>
        <p class="lede">You’ll get ${CONFIG.practiceTrials} practice trials with feedback, then real blocks (${n} trials × ${nCond} cue conditions). Whole run is a few minutes.</p>
        <div class="actions">
          <button type="button" id="startInstructions">Start practice</button>
          <button type="button" class="secondary" id="abortOptimize">Cancel</button>
        </div>
      </section>
    `)
  }

  if (ui === 'ready_block') {
    const angle = state.conditionOrder[state.conditionIndex]
    const blockTag = state.optimizePhase === 'held_out' ? 'held-out' : 'calibration'
    const nThis =
      state.optimizePhase === 'held_out' ? heldOutTrialsPerCondition() : trialsPerCondition()
    return shell(`
      <section class="panel">
        <p class="task-oneliner">${optimizeOneLiner()}</p>
        <h1>Start next block</h1>
        <div class="status-board">
          <div class="status-big">${conditionLabel(angle)}</div>
          <div class="status-meta">
            <span class="block-label ${blockTag === 'held-out' ? 'held' : ''}">${blockTag}</span>
            <span>Condition ${state.conditionIndex + 1} / ${state.conditionOrder.length}</span>
            <span>${nThis} trials</span>
          </div>
        </div>
        <p class="lede">
          ${
            angle == null
              ? 'NO-SOUND baseline — no spatial cue. Compare later against cued angles.'
              : `HRTF cue from <strong style="color:var(--text)">${angle}°</strong> near star onset. Watch the cross; SPACEBAR when you see a star.`
          }
        </p>
        <div class="actions">
          <button type="button" id="startBlock">Start block · ${conditionLabel(angle)}</button>
          <button type="button" class="secondary" id="abortOptimize">Cancel</button>
        </div>
      </section>
    `)
  }

  if (ui === 'condition_done') {
    const s = state.lastConditionSummary
    const angle = state.conditionOrder[state.conditionIndex]
    const blockTag = state.optimizePhase === 'held_out' ? 'held-out' : 'calibration'
    return shell(`
      <section class="panel">
        <p class="task-oneliner">${optimizeOneLiner()}</p>
        <h1>Condition complete</h1>
        <div class="ok-banner">
          <strong>${conditionLabel(angle)}</strong> (${blockTag}) — left-star hits
          <strong>${pct(s?.left_hit_rate)}</strong>
          · right ${pct(s?.right_hit_rate)} · FA ${pct(s?.fa_rate)}
        </div>
        <div class="actions">
          <button type="button" id="continueCondition">Continue</button>
        </div>
      </section>
    `)
  }

  if (ui === 'live') {
    const practice = state.optimizePhase === 'practice'
    return shell(`
      <section class="panel optimize-live">
        <p class="space-instruction">Press <kbd>SPACEBAR</kbd> when you see a star.</p>
        ${practice ? `<p class="lede" style="margin-bottom:0.75rem">Practice — feedback on. Cross stays still; only the star appears/disappears.</p>` : ''}
        <div id="starTaskHost"></div>
        <div class="actions" style="justify-content:center;margin-top:1rem">
          <button type="button" class="secondary" id="abortOptimize">Stop Optimize</button>
        </div>
      </section>
    `)
  }

  return shell(`
    <section class="panel">
      <h1>Angle optimization</h1>
      <p class="task-oneliner">${optimizeOneLiner()}</p>
      <p class="lede">
        Star detection with optional left HRTF cues at
        ${CONFIG.candidateAnglesDeg.map((a) => `${a}°`).join(', ')}${CONFIG.includeNoCue ? ', or NO-SOUND' : ''}.
        Primary metric: <strong style="color:var(--text)">LEFT-star hit rate</strong>.
        ${n} trials/condition · ${nCond} conditions · held-out ${nHold}/condition after.
      </p>
      ${
        warned
          ? `<div class="warn-banner">Localization screening was poor — cueing may not help. Export may stay exploratory.</div>`
          : state.localizationOk === null
            ? `<div class="warn-banner">Screen 1 not run — localization_ok unknown. You can still run Optimize.</div>`
            : ''
      }
      <div class="actions">
        <button type="button" id="startOptimize">Begin · instructions &amp; practice</button>
        <button type="button" class="secondary" data-nav="home">Back</button>
      </div>
    </section>
  `)
}

function renderResults() {
  const payload = state.exportPayload || loadFromLocalStorage()
  if (!payload) {
    return shell(`
      <section class="panel">
        <h1>Result &amp; export</h1>
        <p class="lede">No calibration yet. Run Screen 2 (and ideally Screen 1) first.</p>
        <div class="actions">
          <button type="button" data-nav="optimize">Go to Screen 2</button>
        </div>
      </section>
    `)
  }

  const cal = payload.per_angle_results || []
  const held = payload.held_out_block?.results || []
  const chosen = payload.chosen_angle_deg
  const label = payload.selection_label
  const isChosen = label === 'chosen'
  const maxLeft = Math.max(...cal.map((r) => r.left_hit_rate || 0), 0.01)

  return shell(`
    <section class="panel">
      <h1>Result &amp; export</h1>
      <span class="block-label">calibration selection</span>
      ${
        isChosen
          ? `<div class="ok-banner">Chosen angle: <strong>${chosen}°</strong> — ${escapeHtml(payload.selection_reason || '')}</div>`
          : `<div class="warn-banner">Exploratory / no clear benefit — default <strong>${chosen}°</strong>. ${escapeHtml(payload.selection_reason || '')}</div>`
      }
      <div class="metrics-grid">
        <div class="metric"><div class="label">Chosen angle</div><div class="value chosen">${chosen == null ? '—' : `${chosen}°`}</div></div>
        <div class="metric"><div class="label">localization_ok</div><div class="value">${payload.localization_ok ? 'true' : 'false'}</div></div>
        <div class="metric"><div class="label">Label</div><div class="value" style="font-size:1rem">${escapeHtml(label)}</div></div>
        <div class="metric"><div class="label">Participant</div><div class="value" style="font-size:1rem">${escapeHtml(payload.participant_id)}</div></div>
      </div>
      <h2 style="margin-top:1.5rem">Left-star detection by angle</h2>
      <p class="lede" style="margin-bottom:0">Calibration block (used for selection).</p>
      <div class="chart">
        ${cal
          .map((r) => {
            const h = Math.round(((r.left_hit_rate || 0) / maxLeft) * 100)
            const isSel = r.angle_deg === chosen
            const isBase = r.angle_deg === null
            return `
              <div class="bar-col">
                <div class="bar-value">${pct(r.left_hit_rate)}</div>
                <div class="bar ${isSel ? 'chosen' : ''} ${isBase ? 'baseline' : ''}" style="height:${h}%"></div>
                <div class="bar-label">${r.label}</div>
              </div>`
          })
          .join('')}
      </div>
      <table class="data">
        <thead>
          <tr><th>Angle</th><th>Left hit</th><th>Right hit</th><th>FA</th><th>Median RT</th><th>Block</th></tr>
        </thead>
        <tbody>
          ${cal
            .map((r) => {
              const sel = r.angle_deg === chosen
              return `<tr class="${sel ? 'chosen-row' : ''}">
                <td>${r.label}${sel ? ' ★' : ''}</td>
                <td>${pct(r.left_hit_rate)}</td>
                <td>${pct(r.right_hit_rate)}</td>
                <td>${pct(r.fa_rate)}</td>
                <td>${ms(r.median_correct_rt_ms)}</td>
                <td>calibration</td>
              </tr>`
            })
            .join('')}
          ${held
            .map(
              (r) => `<tr>
                <td>${r.label}</td>
                <td>${pct(r.left_hit_rate)}</td>
                <td>${pct(r.right_hit_rate)}</td>
                <td>${pct(r.fa_rate)}</td>
                <td>${ms(r.median_correct_rt_ms)}</td>
                <td><span class="block-label held" style="margin:0">held-out</span></td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>
      <h2>Export CALIBRATION_SCHEMA</h2>
      <pre class="json-preview">${escapeHtml(JSON.stringify(summarizePayload(payload), null, 2))}</pre>
      <div class="actions">
        <button type="button" id="downloadJson">Download JSON</button>
        <button type="button" class="secondary" id="copyJson">Copy JSON</button>
        <button type="button" class="secondary" data-nav="eeg">EEG archival context</button>
      </div>
    </section>
  `)
}

function renderEeg() {
  const figs = [
    { src: '/assets/eeg/05_original_alpha_boxplots.png', cap: 'Alpha band power boxplots (archival group reference)' },
    { src: '/assets/eeg/07_cue_locked_ERPs_F3_F4_FC3_FC4_PO7_PO8.png', cap: 'Cue-locked ERPs at frontal / posterior sites' },
    { src: '/assets/eeg/08_ERP_400_800ms_scalp_maps_and_difference.png', cap: 'ERP 400–800 ms scalp maps & difference' },
    { src: '/assets/eeg/eeg_reference_topomaps.png', cap: 'EEG reference topomaps' },
    { src: '/assets/eeg/05_individual_lateralization.png', cap: 'Individual lateralization (32-ch results)' },
    { src: '/assets/eeg/07_cue_dependent_alpha_topographies.png', cap: 'Cue-dependent alpha topographies' },
  ]
  return shell(`
    <section class="panel">
      <h1>EEG context</h1>
      <div class="archival-tag">ARCHIVAL · NOT LIVE · NOT IN CONTROL LOOP</div>
      <p class="lede">Static figures from neurohack-dataset. Not used to choose the cue angle — behavior does.</p>
      <div class="eeg-grid">
        ${figs
          .map(
            (f) => `
          <figure class="eeg-fig">
            <img src="${f.src}" alt="${escapeAttr(f.cap)}" loading="lazy" />
            <figcaption>${escapeHtml(f.cap)}</figcaption>
          </figure>`,
          )
          .join('')}
      </div>
    </section>
  `)
}

function summarizePayload(p) {
  return {
    participant_id: p.participant_id,
    chosen_angle_deg: p.chosen_angle_deg,
    timestamp: p.timestamp,
    localization_ok: p.localization_ok,
    selection_label: p.selection_label,
    selection_reason: p.selection_reason,
    per_angle_results: p.per_angle_results,
    notes: p.notes,
    honesty: p.honesty,
    held_out_note: p.held_out_block?.note,
  }
}

/**
 * Critical: while star task is live, do NOT rebuild the page.
 * starTask.js owns the stage DOM; SPA only hosts #starTaskHost.
 */
function render() {
  if (state.view === 'optimize' && state.optimizeUi === 'live') {
    const host = document.getElementById('starTaskHost')
    if (host) {
      // Already mounted — leave star engine alone
      return
    }
  }

  unbindKeys()
  let html
  switch (state.view) {
    case 'localization':
      html = renderLocalization()
      break
    case 'optimize':
      html = renderOptimize()
      break
    case 'results':
      html = renderResults()
      break
    case 'eeg':
      html = renderEeg()
      break
    default:
      html = renderHome()
  }
  app.innerHTML = html
  wire()
}

function wire() {
  app.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      locAbort = true
      locRunning = false
      requestOptimizeAbort()
      await ensureAudio().catch(() => {})
      setState({
        view: btn.getAttribute('data-nav'),
        trialPhase: 'idle',
        optimizeUi: 'idle',
      })
    })
  })

  const pid = app.querySelector('#pid')
  if (pid) {
    pid.addEventListener('change', () => setState({ participantId: pid.value.trim() }))
    pid.addEventListener('input', () => {
      state.participantId = pid.value.trim()
    })
  }

  const demo = app.querySelector('#demoMode')
  if (demo) demo.addEventListener('change', () => setState({ demoMode: demo.checked }))

  const startFull = app.querySelector('#startFull')
  if (startFull) {
    startFull.addEventListener('click', async () => {
      await ensureAudio()
      resetSessionKeepId()
      setState({
        participantId: pid?.value.trim() || state.participantId,
        demoMode: demo?.checked ?? state.demoMode,
        view: 'localization',
      })
    })
  }

  const skip = app.querySelector('#skipToOptimize')
  if (skip) {
    skip.addEventListener('click', async () => {
      await ensureAudio()
      setState({
        participantId: pid?.value.trim() || state.participantId,
        demoMode: demo?.checked ?? true,
        view: 'optimize',
        optimizeUi: 'idle',
      })
    })
  }

  const jump = app.querySelector('#jumpResults')
  if (jump) {
    jump.addEventListener('click', () => {
      const saved = loadFromLocalStorage()
      if (saved && !state.exportPayload) setState({ exportPayload: saved, view: 'results' })
      else setState({ view: 'results' })
    })
  }

  const startLoc = app.querySelector('#startLoc')
  if (startLoc) startLoc.addEventListener('click', () => runLocalization())

  const toOpt = app.querySelector('#toOptimize')
  if (toOpt) toOpt.addEventListener('click', () => setState({ view: 'optimize', optimizeUi: 'idle' }))

  const redo = app.querySelector('#redoLoc')
  if (redo) {
    redo.addEventListener('click', () =>
      setState({
        localizationTrials: [],
        localizationSummary: null,
        localizationOk: null,
        trialPhase: 'idle',
      }),
    )
  }

  const startOpt = app.querySelector('#startOptimize')
  if (startOpt) startOpt.addEventListener('click', () => runOptimizeProtocol())

  const startInstr = app.querySelector('#startInstructions')
  if (startInstr) startInstr.addEventListener('click', () => resolveInstructionsStart())

  const startBlock = app.querySelector('#startBlock')
  if (startBlock) startBlock.addEventListener('click', () => resolveBlockStart())

  const cont = app.querySelector('#continueCondition')
  if (cont) cont.addEventListener('click', () => resolveContinue())

  const abortOpt = app.querySelector('#abortOptimize')
  if (abortOpt) {
    abortOpt.addEventListener('click', () => {
      requestOptimizeAbort()
      setState({ optimizeUi: 'idle', optimizePhase: null, trialPhase: 'idle' })
    })
  }

  const dl = app.querySelector('#downloadJson')
  if (dl) {
    dl.addEventListener('click', () => {
      const p = state.exportPayload || loadFromLocalStorage()
      if (!p) return
      downloadJSON(p, `recenter_calibration_${p.participant_id || 'anon'}_${Date.now()}.json`)
    })
  }

  const copy = app.querySelector('#copyJson')
  if (copy) {
    copy.addEventListener('click', async () => {
      const p = state.exportPayload || loadFromLocalStorage()
      if (!p) return
      await navigator.clipboard.writeText(JSON.stringify(p, null, 2))
      copy.textContent = 'Copied'
      setTimeout(() => {
        copy.textContent = 'Copy JSON'
      }, 1200)
    })
  }

  const picker = app.querySelector('#anglePicker')
  if (picker) {
    picker.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        if (typeof window.__locResolve === 'function') {
          window.__locResolve(Number(b.getAttribute('data-angle')))
        }
      })
    })
  }
}

async function runLocalization() {
  await ensureAudio()
  locAbort = false
  locRunning = true

  const angles = []
  for (let r = 0; r < CONFIG.localizationRepeats; r++) {
    angles.push(...CONFIG.localizationAnglesDeg)
  }
  const sequence = shuffle(angles)
  const trials = []

  for (let i = 0; i < sequence.length; i++) {
    if (locAbort) break
    const trueAngle = sequence[i]
    setState({ trialPhase: 'playing', localizationTrials: trials })
    await sleep(400)
    if (locAbort) break
    await playLocalizationBurst(trueAngle, {
      durationMs: CONFIG.localizationToneMs,
      frequencyHz: CONFIG.localizationToneHz,
    })
    const reported = await new Promise((resolve) => {
      window.__locResolve = resolve
      setState({ trialPhase: 'await_report', localizationTrials: trials })
    })
    window.__locResolve = null
    trials.push({
      true_angle_deg: trueAngle,
      reported_angle_deg: reported,
      abs_error_deg: Math.abs(reported - trueAngle),
    })
    setState({ localizationTrials: [...trials], trialPhase: 'playing' })
    await sleep(250)
  }

  locRunning = false
  if (locAbort) {
    setState({ trialPhase: 'idle' })
    return
  }

  const summary = analyzeLocalization(trials)
  setState({
    localizationTrials: trials,
    localizationSummary: summary,
    localizationOk: summary.localization_ok,
    warnLocalization: !summary.localization_ok,
    trialPhase: 'idle',
  })
}

function applyQueryBootstrap() {
  const params = new URLSearchParams(location.search)
  const view = params.get('view')
  if (params.get('demo') === '1') {
    const seed = {
      participant_id: 'demo-pilot',
      chosen_angle_deg: -45,
      timestamp: new Date().toISOString(),
      localization_ok: true,
      selection_label: 'chosen',
      selection_reason:
        'Largest reproducible LEFT-hit improvement over no-cue (+12.0 pp) without right/FA cost.',
      notes: 'Demo seed',
      protocol: 'recenter-spatial-cue-v1',
      headphones_required: true,
      eeg_required: false,
      per_angle_results: [
        { angle_deg: -60, label: '-60°', left_hit_rate: 0.62, right_hit_rate: 0.7, fa_rate: 0.08, median_correct_rt_ms: 440, n_trials: 10 },
        { angle_deg: -45, label: '-45°', left_hit_rate: 0.75, right_hit_rate: 0.68, fa_rate: 0.05, median_correct_rt_ms: 410, n_trials: 10 },
        { angle_deg: -30, label: '-30°', left_hit_rate: 0.58, right_hit_rate: 0.72, fa_rate: 0.1, median_correct_rt_ms: 455, n_trials: 10 },
        { angle_deg: null, label: 'NO-CUE', left_hit_rate: 0.5, right_hit_rate: 0.7, fa_rate: 0.06, median_correct_rt_ms: 468, n_trials: 10 },
      ],
      held_out_block: {
        note: 'Held-out must not be presented as calibration.',
        results: [
          { angle_deg: -60, label: '-60°', left_hit_rate: 0.6, right_hit_rate: 0.68, fa_rate: 0.1, median_correct_rt_ms: 450 },
          { angle_deg: -45, label: '-45°', left_hit_rate: 0.7, right_hit_rate: 0.65, fa_rate: 0.05, median_correct_rt_ms: 420 },
          { angle_deg: -30, label: '-30°', left_hit_rate: 0.55, right_hit_rate: 0.7, fa_rate: 0.12, median_correct_rt_ms: 460 },
          { angle_deg: null, label: 'NO-CUE', left_hit_rate: 0.48, right_hit_rate: 0.72, fa_rate: 0.08, median_correct_rt_ms: 475 },
        ],
      },
      honesty: CALIBRATION_SCHEMA.honesty,
    }
    saveToLocalStorage(seed)
    state.exportPayload = seed
    state.participantId = 'demo-pilot'
    state.localizationOk = true
  }
  if (view && ['home', 'localization', 'optimize', 'results', 'eeg'].includes(view)) {
    state.view = view
    if (view === 'results' && !state.exportPayload) {
      state.exportPayload = loadFromLocalStorage()
    }
  }
}

applyQueryBootstrap()
subscribe(() => render())
render()
