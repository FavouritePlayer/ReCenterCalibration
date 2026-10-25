# ReCenter Calibration Studio

Browser calibration that personalizes a **spatial-audio cue angle** (HRTF) for left-side visual detection and exports JSON for a companion player.

Stereo **headphones required**. No EEG headset needed for the demo. All client-side (Web Audio API + `localStorage` + JSON download).

## Quick start

```bash
npm install
npm run dev
```

Opens at **http://localhost:4729/** (uncommon port — not 3000/5173/8080).

```bash
npm run build    # production bundle → dist/
npm run preview  # serve dist on :4729
```

## Protocol (3 screens)

1. **Localization** — randomized azimuth tones; report perceived direction. Sets `localization_ok` for left-side performance. Poor localization warns that cueing may not help.
2. **Angle optimization** — candidate left angles `{-30, -45, -60}°` + **NO-CUE** baseline. Fixation → HRTF cue (cued blocks) → brief L/R visual target → `F`/`J`. Catch trials ~18%. Metrics: left hit rate (primary), right hit rate, median correct RT, FA rate. Then a **separate held-out** block.
3. **Result & export** — picks the angle with the clearest LEFT-detection gain over no-cue **if** `localization_ok` and no large right-hit drop / FA spike. Otherwise a conservative default labeled **exploratory / no clear benefit** (never fakes a winner). Download JSON + `localStorage`.

Optional **EEG archive** panel: static PNGs/CSV from `neurohack-dataset` — labeled archival / not live / not in the control loop.

## Headphones & audio

- Uses Web Audio **`PannerNode`** with `panningModel = "HRTF"`.
- Raw L/R volume panning is **not** used.
- Click once on the page to resume `AudioContext` (browser autoplay policy).

## `CALIBRATION_SCHEMA`

Exported at runtime as `window.CALIBRATION_SCHEMA` and written into each JSON file. Minimum + documented extensions:

```json
{
  "participant_id": "pilot-01",
  "chosen_angle_deg": -45,
  "timestamp": "2026-10-25T18:00:00.000Z",
  "localization_ok": true,
  "per_angle_results": [
    {
      "angle_deg": -45,
      "label": "-45°",
      "left_hit_rate": 0.72,
      "right_hit_rate": 0.68,
      "fa_rate": 0.05,
      "median_correct_rt_ms": 412
    }
  ],
  "notes": "",
  "selection_label": "chosen",
  "protocol": "recenter-spatial-cue-v1",
  "headphones_required": true,
  "eeg_required": false,
  "localization": {},
  "calibration_block": {},
  "held_out_block": {
    "note": "Held-out must not be presented as calibration."
  },
  "honesty": [
    "Behavioral metrics are primary; EEG figures are archival context only.",
    "Held-out block is separate from calibration selection.",
    "Short-term compensation ≠ lasting benefit.",
    "Research prototype — not a treatment or clinical device.",
    "Stereo headphones required; no EEG headset needed for this demo."
  ]
}
```

Tunable constants live in `src/config.js` (`CONFIG`): candidate angles, trials per condition, timings, selection thresholds. Quick demo mode uses fewer trials.

`localStorage` key: `recenter_calibration_latest`.

## Honesty (also visible in the UI)

- Behavioral metrics are primary.
- Held-out is separate from calibration selection.
- Short-term compensation ≠ lasting benefit.
- Research prototype — not a treatment.
- Headphones only; EEG not required for this demo.

## Stack

Vite + vanilla HTML/CSS/JS. Single-page app.

## License

MIT — research / hackathon prototype.
