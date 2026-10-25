/**
 * ReCenter Calibration Studio — schema & protocol constants.
 *
 * Demo-speed defaults at top of CONFIG so a full Optimize pass fits in a few minutes.
 */

export const CALIBRATION_SCHEMA = {
  participant_id: '',
  chosen_angle_deg: null,
  timestamp: '',
  localization_ok: false,
  per_angle_results: [],
  notes: '',
  selection_label: '',
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
  // —— Demo-speed Optimize (Screen 2) ——
  /** Candidate cue angles (left) + no-sound baseline when includeNoCue */
  candidateAnglesDeg: [-30, -45, -60],
  includeNoCue: true,
  /** TRIALS_PER_CONDITION — demo default ~10–12 */
  TRIALS_PER_CONDITION: 10,
  trialsPerCondition: 10,
  heldOutTrialsPerCondition: 6,
  demoTrialsPerCondition: 10,
  demoHeldOutTrialsPerCondition: 6,
  catchTrialRate: 0.18,
  leftTargetRate: 0.5,
  practiceTrials: 4,

  // Star flash (detection)
  starFlashMsMin: 150,
  starFlashMsMax: 250,
  /** How long after star onset responses still count */
  responseWindowMs: 1100,
  fixationMsMin: 500,
  fixationMsMax: 800,
  /** HRTF cue near star onset (cued blocks only) */
  cueLeadMs: 40,
  cueDurationMs: 140,
  /** Snappy ITI between trials (no Space-to-arm) */
  itiMs: 450,
  feedbackMs: 420,
  /** pacedMode off — continuous timer, not Space between trials */
  pacedMode: false,

  // Screen 1 — auditory localization
  localizationAnglesDeg: [-75, -45, -30, 0, 30, 45, 75],
  localizationRepeats: 3,
  localizationLeftAngles: [-75, -45, -30],
  localizationOkMinAccuracy: 0.55,
  localizationOkMaxAbsErrorDeg: 35,
  localizationOkMaxLRConfusion: 0.25,

  // Audio
  cueFrequencyHz: 880,
  cueGain: 0.22,
  localizationToneMs: 280,
  localizationToneHz: 750,

  // Selection thresholds
  leftImprovementMin: 0.06,
  rightHitDropMax: 0.12,
  faRateSpikeMax: 0.1,
  defaultExploratoryAngleDeg: -45,

  localStorageKey: 'recenter_calibration_latest',
}

export const STORAGE_KEY = CONFIG.localStorageKey
