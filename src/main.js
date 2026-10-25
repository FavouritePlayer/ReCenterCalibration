import './style.css'
import { CALIBRATION_SCHEMA, CONFIG } from './config.js'
import { ensureAudio, playSpatialTone, playLocalizationBurst } from './audio.js'
import {
  analyzeLocalization,
  summarizeByAngle,
  selectAngle,
  buildExportPayload,
} from './analysis.js'
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
  buildOptimizeQueue,
} from './state.js'

// Expose schema for console / player integrators
window.CALIBRATION_SCHEMA = CALIBRATION_SCHEMA
window.RECENTER_CONFIG = CONFIG

const app = document.querySelector('#app')

let keyHandler = null
let runningTrials = false
let abortTrials = false

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
        visual detection. HRTF panning only. Export JSON for your player — all client-side.
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
          <p>Brief L/R targets with HRTF cues at candidate left angles vs no-cue.</p>
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
            Quick demo (fewer trials)
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
  const inTrial = state.trialPhase !== 'idle' && state.view === 'localization'

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
        <div class="fixation ${state.trialPhase === 'await_report' || state.trialPhase === 'playing' ? 'on' : ''}"></div>
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
  const inTrial = runningTrials && state.view === 'optimize'
  const phase = state.optimizePhase
  const total = state.trialQueue.length
  const idx = state.trialIndex
  const condLabel =
    state.currentTrial?.condition_angle_deg == null
      ? 'NO-CUE'
      : `${state.currentTrial.condition_angle_deg}°`

  if (!inTrial && phase !== 'done') {
    const n = trialsPerCondition()
    const nHold = heldOutTrialsPerCondition()
    const warned = state.localizationOk === false
    return shell(`
      <section class="panel">
        <h1>Angle optimization</h1>
        <p class="lede">
          Brief visual targets left/right (~${CONFIG.targetMs} ms). On cued blocks, an HRTF tone plays at the block angle before the target.
          Primary metric: <strong style="color:var(--text)">LEFT hit rate</strong>. Catch trials (~${Math.round(CONFIG.catchTrialRate * 100)}%) measure false alarms.
          Conditions: ${CONFIG.candidateAnglesDeg.map((a) => `${a}°`).join(', ')}${CONFIG.includeNoCue ? ', NO-CUE' : ''}.
        </p>
        ${
          warned
            ? `<div class="warn-banner">Localization screening was poor — cueing may not help. Results will be labeled exploratory if no clear benefit.</div>`
            : state.localizationOk === null
              ? `<div class="warn-banner">Screen 1 not run — localization_ok unknown. You can demo Screen 2, but full protocol runs Screen 1 first.</div>`
              : ''
        }
        <div class="trial-prompt" style="text-align:left;margin:0 0 1rem">
          Keys: <kbd>F</kbd> = left target · <kbd>J</kbd> = right target · no key on catch trials.
          Eyes on the fixation cross.
        </div>
        <div class="actions">
          <button type="button" id="startOptimize">
            Start calibration (${n} trials × ${CONFIG.candidateAnglesDeg.length + (CONFIG.includeNoCue ? 1 : 0)} conditions)
          </button>
          <button type="button" class="secondary" data-nav="home">Back</button>
        </div>
        <p class="lede" style="margin-top:1rem;margin-bottom:0;font-size:0.8rem">
          After calibration, a separate held-out block (${nHold}/condition) runs automatically — labeled, not used for selection.
        </p>
      </section>
    `)
  }

  if (inTrial) {
    const progress = total ? Math.round((idx / total) * 100) : 0
    const blockTag = phase === 'held_out' ? 'held-out' : 'calibration'
    return shell(`
      <section class="panel">
        <div class="trial-hud">
          <span>${blockTag} · ${idx + 1} / ${total} · cue ${condLabel}</span>
          <span>F = left · J = right</span>
        </div>
        <div class="progress-bar"><span style="width:${progress}%"></span></div>
        <div class="trial-stage fullscreenish" id="optStage">
          <div class="fixation ${['fixation', 'cue', 'target', 'response'].includes(state.trialPhase) ? 'on' : ''}"></div>
          <div class="target-dot left ${state.trialPhase === 'target' && state.currentTrial?.target === 'left' ? 'on' : ''}"></div>
          <div class="target-dot right ${state.trialPhase === 'target' && state.currentTrial?.target === 'right' ? 'on' : ''}"></div>
        </div>
        <p class="trial-prompt">
          ${
            state.trialPhase === 'response'
              ? 'Respond now'
              : state.trialPhase === 'cue'
                ? 'Listen…'
                : 'Fixate'
          }
        </p>
      </section>
    `)
  }

  // phase done → nudge to results
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
          : `<div class="warn-banner">Exploratory / no clear benefit — default <strong>${chosen}°</strong>. ${escapeHtml(payload.selection_reason || '')} We are not fabricating a winner.</div>`
      }
      <div class="metrics-grid">
        <div class="metric">
          <div class="label">Chosen angle</div>
          <div class="value chosen">${chosen == null ? '—' : `${chosen}°`}</div>
        </div>
        <div class="metric">
          <div class="label">localization_ok</div>
          <div class="value">${payload.localization_ok ? 'true' : 'false'}</div>
        </div>
        <div class="metric">
          <div class="label">Label</div>
          <div class="value" style="font-size:1rem">${escapeHtml(label)}</div>
        </div>
        <div class="metric">
          <div class="label">Participant</div>
          <div class="value" style="font-size:1rem">${escapeHtml(payload.participant_id)}</div>
        </div>
      </div>

      <h2 style="margin-top:1.5rem">Left detection by angle</h2>
      <p class="lede" style="margin-bottom:0">Calibration block (used for selection). Highlighted bar = chosen / default.</p>
      <div class="chart">
        ${cal
          .map((r) => {
            const h = Math.round(((r.left_hit_rate || 0) / maxLeft) * 100)
            const isSel =
              (r.angle_deg === chosen) ||
              (r.angle_deg === null && chosen === null)
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
          <tr>
            <th>Angle</th><th>Left hit</th><th>Right hit</th><th>FA</th><th>Median RT</th><th>Block</th>
          </tr>
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
      <p class="lede">Downloaded JSON + localStorage (<code>${CONFIG.localStorageKey}</code>). Companion players should read <code>chosen_angle_deg</code> and respect <code>selection_label</code>.</p>
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
    {
      src: '/assets/eeg/05_original_alpha_boxplots.png',
      cap: 'Alpha band power boxplots (archival group reference)',
    },
    {
      src: '/assets/eeg/07_cue_locked_ERPs_F3_F4_FC3_FC4_PO7_PO8.png',
      cap: 'Cue-locked ERPs at frontal / posterior sites',
    },
    {
      src: '/assets/eeg/08_ERP_400_800ms_scalp_maps_and_difference.png',
      cap: 'ERP 400–800 ms scalp maps & difference',
    },
    {
      src: '/assets/eeg/eeg_reference_topomaps.png',
      cap: 'EEG reference topomaps',
    },
    {
      src: '/assets/eeg/05_individual_lateralization.png',
      cap: 'Individual lateralization (32-ch results)',
    },
    {
      src: '/assets/eeg/07_cue_dependent_alpha_topographies.png',
      cap: 'Cue-dependent alpha topographies',
    },
  ]

  return shell(`
    <section class="panel">
      <h1>EEG context</h1>
      <div class="archival-tag">ARCHIVAL · NOT LIVE · NOT IN CONTROL LOOP</div>
      <p class="lede">
        Static figures and CSV copied from the neurohack-dataset archive. They provide scientific context
        for the broader NeuroCompass effort. This calibration studio does <strong style="color:var(--text)">not</strong>
        stream EEG and does not use these plots to choose the cue angle — behavior does.
      </p>
      <p class="lede" style="font-size:0.85rem">
        Source: <code>neurocompass_figures/</code>, <code>neurocompass_32_results/</code>
        · <a href="/assets/eeg/participant_lateralization.csv" download>participant_lateralization.csv</a>
      </p>
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

function render() {
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
      if (runningTrials) {
        abortTrials = true
        runningTrials = false
      }
      await ensureAudio().catch(() => {})
      setState({ view: btn.getAttribute('data-nav'), trialPhase: 'idle' })
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
  if (demo) {
    demo.addEventListener('change', () => setState({ demoMode: demo.checked }))
  }

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
        localizationOk: state.localizationOk,
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
  if (toOpt) toOpt.addEventListener('click', () => setState({ view: 'optimize' }))

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
  if (startOpt) startOpt.addEventListener('click', () => runOptimize())

  const dl = app.querySelector('#downloadJson')
  if (dl) {
    dl.addEventListener('click', () => {
      const p = state.exportPayload || loadFromLocalStorage()
      if (!p) return
      const name = `recenter_calibration_${p.participant_id || 'anon'}_${Date.now()}.json`
      downloadJSON(p, name)
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
  abortTrials = false
  runningTrials = true

  const angles = []
  for (let r = 0; r < CONFIG.localizationRepeats; r++) {
    angles.push(...CONFIG.localizationAnglesDeg)
  }
  const sequence = shuffle(angles)
  const trials = []

  for (let i = 0; i < sequence.length; i++) {
    if (abortTrials) break
    const trueAngle = sequence[i]
    setState({
      trialPhase: 'playing',
      localizationTrials: trials,
    })
    await sleep(400)
    if (abortTrials) break
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

  runningTrials = false
  if (abortTrials) {
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

async function runOptimize() {
  await ensureAudio()
  abortTrials = false
  runningTrials = true

  // —— Calibration block ——
  const cal = buildOptimizeQueue('calibration', trialsPerCondition())
  setState({
    optimizePhase: 'calibration',
    conditionOrder: cal.order,
    trialQueue: cal.queue,
    trialIndex: 0,
    calibrationTrials: [],
  })

  const calTrials = await runTrialQueue(cal.queue, 'calibration')
  if (abortTrials) {
    runningTrials = false
    setState({ trialPhase: 'idle', optimizePhase: null })
    return
  }

  const calibrationResults = summarizeByAngle(calTrials)
  const localization =
    state.localizationSummary ||
    (state.localizationOk == null
      ? { localization_ok: false, note: 'Screen 1 skipped' }
      : { localization_ok: state.localizationOk })

  const selection = selectAngle(
    calibrationResults,
    localization.localization_ok === true,
  )

  // —— Held-out block (not used for selection) ——
  const held = buildOptimizeQueue('held_out', heldOutTrialsPerCondition())
  setState({
    optimizePhase: 'held_out',
    trialQueue: held.queue,
    trialIndex: 0,
    calibrationTrials: calTrials,
    calibrationResults,
    selection,
  })

  const heldTrials = await runTrialQueue(held.queue, 'held_out')
  if (abortTrials) {
    runningTrials = false
    setState({ trialPhase: 'idle' })
    return
  }

  const heldOutResults = summarizeByAngle(heldTrials)
  const exportPayload = buildExportPayload(
    {
      ...state,
      calibrationTrials: calTrials,
      heldOutTrials: heldTrials,
      notes: state.notes,
    },
    selection,
    calibrationResults,
    heldOutResults,
    localization,
  )

  saveToLocalStorage(exportPayload)
  runningTrials = false
  setState({
    optimizePhase: 'done',
    heldOutTrials: heldTrials,
    heldOutResults,
    exportPayload,
    trialPhase: 'idle',
    currentTrial: null,
    view: 'results',
  })
}

async function runTrialQueue(queue, blockLabel) {
  const collected = []
  for (let i = 0; i < queue.length; i++) {
    if (abortTrials) break
    const trial = { ...queue[i], block: blockLabel }
    setState({
      trialIndex: i,
      currentTrial: trial,
      trialPhase: 'fixation',
    })

    const result = await runSingleTrial(trial)
    collected.push(result)

    if (blockLabel === 'calibration') {
      setState({ calibrationTrials: [...collected] })
    } else {
      setState({ heldOutTrials: [...collected] })
    }
    await sleep(CONFIG.itiMs)
  }
  return collected
}

async function runSingleTrial(trial) {
  // Fixation
  setState({ trialPhase: 'fixation', currentTrial: trial })
  await sleep(trial.fixationMs)
  if (abortTrials) return finalizeTrial(trial, null, null)

  // Spatial cue (HRTF) on cued blocks
  if (trial.condition_angle_deg !== null) {
    setState({ trialPhase: 'cue' })
    playSpatialTone(trial.condition_angle_deg, {
      durationMs: CONFIG.cueDurationMs,
      frequencyHz: CONFIG.cueFrequencyHz,
      gain: CONFIG.cueGain,
    })
    await sleep(CONFIG.cueLeadMs)
  }

  if (abortTrials) return finalizeTrial(trial, null, null)

  // Target flash (or blank catch)
  setState({ trialPhase: 'target', currentTrial: trial })
  await sleep(CONFIG.targetMs)
  setState({ trialPhase: 'response', currentTrial: { ...trial, target: trial.target } })

  const t0 = performance.now()
  const response = await waitForResponse(CONFIG.responseWindowMs)
  const rt = response ? performance.now() - t0 : null

  return finalizeTrial(trial, response, rt)
}

function finalizeTrial(trial, response, rtMs) {
  let correct = null
  if (trial.target === 'catch') {
    correct = response == null
  } else if (response == null) {
    correct = false
  } else {
    correct = response === trial.target
  }
  return {
    ...trial,
    response: response ?? null,
    rtMs: rtMs != null ? Math.round(rtMs) : null,
    correct,
  }
}

function waitForResponse(timeoutMs) {
  return new Promise((resolve) => {
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      unbindKeys()
      resolve(null)
    }, timeoutMs)

    bindKeys((e) => {
      if (done) return
      const k = e.key.toLowerCase()
      let resp = null
      if (k === 'f' || k === 'arrowleft') resp = 'left'
      if (k === 'j' || k === 'arrowright') resp = 'right'
      if (!resp) return
      e.preventDefault()
      done = true
      clearTimeout(timer)
      unbindKeys()
      resolve(resp)
    })
  })
}

// Initial paint + subscribe
subscribe(() => render())
render()
