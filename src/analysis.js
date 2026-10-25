import { CONFIG } from './config.js'

function median(nums) {
  if (!nums.length) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function angleKey(a) {
  return a === null || a === 'no_cue' ? 'no_cue' : String(a)
}

/**
 * Aggregate detection metrics for one condition (angle or no-cue).
 */
export function summarizeCondition(trials) {
  const left = trials.filter((t) => t.target === 'left')
  const right = trials.filter((t) => t.target === 'right')
  const catchTrials = trials.filter((t) => t.target === 'catch')

  const leftHits = left.filter((t) => t.response === 'left')
  const rightHits = right.filter((t) => t.response === 'right')
  const falseAlarms = catchTrials.filter((t) => t.response === 'left' || t.response === 'right')

  const leftCorrectRTs = leftHits
    .map((t) => t.rtMs)
    .filter((rt) => rt != null && Number.isFinite(rt))
  const rightCorrectRTs = rightHits
    .map((t) => t.rtMs)
    .filter((rt) => rt != null && Number.isFinite(rt))

  return {
    n_trials: trials.length,
    n_left: left.length,
    n_right: right.length,
    n_catch: catchTrials.length,
    left_hit_rate: left.length ? leftHits.length / left.length : null,
    right_hit_rate: right.length ? rightHits.length / right.length : null,
    fa_rate: catchTrials.length ? falseAlarms.length / catchTrials.length : null,
    median_correct_rt_left_ms: median(leftCorrectRTs),
    median_correct_rt_right_ms: median(rightCorrectRTs),
    median_correct_rt_ms: median([...leftCorrectRTs, ...rightCorrectRTs]),
  }
}

export function summarizeByAngle(trials) {
  const groups = new Map()
  for (const t of trials) {
    const key = angleKey(t.condition_angle_deg)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(t)
  }
  const results = []
  for (const [key, list] of groups) {
    const angle = key === 'no_cue' ? null : Number(key)
    results.push({
      angle_deg: angle,
      label: angle === null ? 'NO-CUE' : `${angle}°`,
      ...summarizeCondition(list),
    })
  }
  // Order: no-cue last among sorted angles
  results.sort((a, b) => {
    if (a.angle_deg === null) return 1
    if (b.angle_deg === null) return -1
    return a.angle_deg - b.angle_deg
  })
  return results
}

/**
 * Screen 1 localization scoring.
 */
export function analyzeLocalization(trials) {
  const byAngle = new Map()
  for (const t of trials) {
    const k = t.true_angle_deg
    if (!byAngle.has(k)) byAngle.set(k, [])
    byAngle.get(k).push(t)
  }

  const per_angle = []
  let leftCorrect = 0
  let leftTotal = 0
  let lrConfusions = 0
  let sideJudgments = 0
  let absErrors = []

  for (const [angle, list] of [...byAngle.entries()].sort((a, b) => a[0] - b[0])) {
    let correct = 0
    const errs = []
    for (const t of list) {
      const err = Math.abs(t.reported_angle_deg - t.true_angle_deg)
      errs.push(err)
      absErrors.push(err)
      if (t.reported_angle_deg === t.true_angle_deg) correct += 1

      const trueLeft = t.true_angle_deg < 0
      const trueRight = t.true_angle_deg > 0
      const repLeft = t.reported_angle_deg < 0
      const repRight = t.reported_angle_deg > 0
      if (trueLeft || trueRight) {
        sideJudgments += 1
        if ((trueLeft && repRight) || (trueRight && repLeft)) lrConfusions += 1
      }
      if (CONFIG.localizationLeftAngles.includes(t.true_angle_deg)) {
        leftTotal += 1
        if (t.reported_angle_deg === t.true_angle_deg) leftCorrect += 1
      }
    }
    per_angle.push({
      angle_deg: angle,
      n: list.length,
      accuracy: list.length ? correct / list.length : null,
      mean_abs_error_deg: errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null,
    })
  }

  const left_accuracy = leftTotal ? leftCorrect / leftTotal : null
  const overall_accuracy = trials.length
    ? trials.filter((t) => t.reported_angle_deg === t.true_angle_deg).length / trials.length
    : null
  const mean_abs_error_deg = absErrors.length
    ? absErrors.reduce((a, b) => a + b, 0) / absErrors.length
    : null
  const lr_confusion_rate = sideJudgments ? lrConfusions / sideJudgments : null

  const localization_ok =
    left_accuracy != null &&
    left_accuracy >= CONFIG.localizationOkMinAccuracy &&
    (mean_abs_error_deg == null || mean_abs_error_deg <= CONFIG.localizationOkMaxAbsErrorDeg) &&
    (lr_confusion_rate == null || lr_confusion_rate <= CONFIG.localizationOkMaxLRConfusion)

  return {
    per_angle,
    overall_accuracy,
    left_accuracy,
    mean_abs_error_deg,
    lr_confusion_rate,
    localization_ok,
    n_trials: trials.length,
  }
}

/**
 * Pick angle with most reproducible LEFT-detection improvement over no-cue,
 * unless right-hit drops or FA spikes. Otherwise exploratory default.
 */
export function selectAngle(calibrationResults, localization_ok) {
  const noCue = calibrationResults.find((r) => r.angle_deg === null)
  const cued = calibrationResults.filter((r) => r.angle_deg !== null)

  if (!noCue || noCue.left_hit_rate == null) {
    return {
      chosen_angle_deg: CONFIG.defaultExploratoryAngleDeg,
      selection_label: 'exploratory / no clear benefit',
      reason: 'Missing no-cue baseline; using conservative default.',
      improvements: [],
    }
  }

  const improvements = cued.map((r) => {
    const leftDelta = (r.left_hit_rate ?? 0) - (noCue.left_hit_rate ?? 0)
    const rightDelta = (r.right_hit_rate ?? 0) - (noCue.right_hit_rate ?? 0)
    const faDelta = (r.fa_rate ?? 0) - (noCue.fa_rate ?? 0)
    const rightOk = -rightDelta <= CONFIG.rightHitDropMax
    const faOk = faDelta <= CONFIG.faRateSpikeMax
    const improved = leftDelta >= CONFIG.leftImprovementMin
    return {
      angle_deg: r.angle_deg,
      left_delta: leftDelta,
      right_delta: rightDelta,
      fa_delta: faDelta,
      eligible: localization_ok && improved && rightOk && faOk,
      left_hit_rate: r.left_hit_rate,
    }
  })

  const eligible = improvements
    .filter((i) => i.eligible)
    .sort((a, b) => b.left_delta - a.left_delta)

  if (!localization_ok) {
    return {
      chosen_angle_deg: CONFIG.defaultExploratoryAngleDeg,
      selection_label: 'exploratory / no clear benefit',
      reason:
        'Localization screening failed for left-side cues — cueing may not help. Conservative default only.',
      improvements,
    }
  }

  if (eligible.length === 0) {
    return {
      chosen_angle_deg: CONFIG.defaultExploratoryAngleDeg,
      selection_label: 'exploratory / no clear benefit',
      reason:
        'No angle showed clear LEFT-detection gain over no-cue without a large right-hit drop or FA spike.',
      improvements,
    }
  }

  const best = eligible[0]
  return {
    chosen_angle_deg: best.angle_deg,
    selection_label: 'chosen',
    reason: `Largest reproducible LEFT-hit improvement over no-cue (+${(best.left_delta * 100).toFixed(1)} pp) without right/FA cost.`,
    improvements,
  }
}

export function buildExportPayload(state, selection, calibrationResults, heldOutResults, localization) {
  const timestamp = new Date().toISOString()
  return {
    participant_id: state.participantId || 'anonymous',
    chosen_angle_deg: selection.chosen_angle_deg,
    timestamp,
    localization_ok: localization?.localization_ok ?? false,
    per_angle_results: calibrationResults,
    notes: state.notes || selection.reason || '',
    selection_label: selection.selection_label,
    selection_reason: selection.reason,
    improvements: selection.improvements,
    protocol: 'recenter-spatial-cue-v1',
    headphones_required: true,
    eeg_required: false,
    localization,
    calibration_block: {
      results: calibrationResults,
      trials: state.calibrationTrials,
    },
    held_out_block: {
      results: heldOutResults,
      trials: state.heldOutTrials,
      note: 'Held-out must not be presented as calibration.',
    },
    honesty: [
      'Behavioral metrics are primary; EEG figures are archival context only.',
      'Held-out block is separate from calibration selection.',
      'Short-term compensation ≠ lasting benefit.',
      'Research prototype — not a treatment or clinical device.',
      'Stereo headphones required; no EEG headset needed for this demo.',
    ],
  }
}
