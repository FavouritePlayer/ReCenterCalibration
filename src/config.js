/**
 * ReCenter Calibration Studio — schema & protocol constants.
 *
 * CALIBRATION_SCHEMA is the export shape consumed by companion players
 * (NeuroCompass / spatial-cue playback). Extends the hackathon session
 * summary pattern (participant_id, caveat, held-out separation) with
 * spatial-audio angle fields.
 */

/** @type {import('./types').CalibrationExport} */
export const CALIBRATION_SCHEMA = {
  participant_id: '',
  chosen_angle_deg: null, // number | null (null = no clear benefit / no-cue)
  timestamp: '',
  localization_ok: false,
  per_angle_results: [],
  notes: '',
  // Extended fields (documented for players)
  selection_label: '', // "chosen" | "exploratory / no clear benefit"
  protocol: 'recenter-spatial-cue-v1',
  headphones_required: true,
  eeg_required: false,
  localization: null,
  calibration_block: null,
  held_out_block: null,
  honesty: [
    'Behavioral metrics are primary; EEG figures are archival context only.',
    'Held-out block is separate from calibration selection.',
    'Short-term compensation ≠ lasting benefit.',
    'Research prototype — not a treatment or clinical device.',
    'Stereo headphones required; no EEG headset needed for this demo.',
  ],
}

/**
 * Protocol knobs — tune here, not sprinkled through trial code.
 */
export const CONFIG = {
  // Screen 1 — auditory localization
  localizationAnglesDeg: [-75, -45, -30, 0, 30, 45, 75],
  localizationRepeats: 3,
  localizationLeftAngles: [-75, -45, -30],
  localizationOkMinAccuracy: 0.55,
  localizationOkMaxAbsErrorDeg: 35,
  localizationOkMaxLRConfusion: 0.25,

  // Screen 2 — angle optimization candidates (+ NO-CUE baseline)
  candidateAnglesDeg: [-30, -45, -60],
  includeNoCue: true,
  trialsPerCondition: 20,
  heldOutTrialsPerCondition: 10,
  /** Quick demo uses fewer trials so the flow is demoable in minutes. */
  demoTrialsPerCondition: 8,
  demoHeldOutTrialsPerCondition: 4,
  catchTrialRate: 0.18,
  leftTargetRate: 0.5, // among non-catch trials

  // Timings (ms)
  fixationMsMin: 600,
  fixationMsMax: 900,
  cueLeadMs: 220,
  cueDurationMs: 150,
  targetMs: 130,
  responseWindowMs: 1500,
  /** Inter-trial gap (visible countdown). Was 400ms — too fast to read. */
  itiMs: 1000,
  itiMsMin: 800,
  itiMsMax: 1200,
  feedbackMs: 750,
  conditionCompleteMs: 0, // 0 = wait for Continue button

  /**
   * pacedMode: require Space to arm each next trial after feedback.
   * Default true so Optimize never feels like a rapid-fire blur.
   */
  pacedMode: true,

  // Audio
  cueFrequencyHz: 880,
  cueGain: 0.22,
  localizationToneMs: 280,
  localizationToneHz: 750,

  // Selection thresholds (honesty gates)
  leftImprovementMin: 0.06,
  rightHitDropMax: 0.12,
  faRateSpikeMax: 0.10,
  defaultExploratoryAngleDeg: -45,

  localStorageKey: 'recenter_calibration_latest',
}

export const STORAGE_KEY = CONFIG.localStorageKey
