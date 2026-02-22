// scenarios.js — 4 Attack Scenarios for Robot Simulation Demo

const PI = Math.PI;

/**
 * Each scenario returns an action generator function:
 *   generator(frameIndex) → Float64Array[7]
 *
 * The generator produces "raw" (potentially dangerous) actions.
 * The unprotected robot applies these directly.
 * The protected robot runs them through the guard pipeline first.
 */

// ─── Baseline: smooth sinusoidal idle motion ───
function idleAction(frame) {
  const t = frame * 0.02;
  return new Float64Array([
    Math.sin(t * 0.5) * 0.3,         // base X
    Math.cos(t * 0.7) * 0.2,         // base Y
    Math.sin(t * 0.3) * 0.4,         // base Yaw
    Math.sin(t * 1.0) * 0.8,         // shoulder
    Math.cos(t * 0.8) * 0.6,         // elbow
    0.5 + Math.sin(t * 0.4) * 0.3,   // gripper L
    0.5 + Math.cos(t * 0.4) * 0.3,   // gripper R
  ]);
}

// ─── Scenario 1: NaN Injection ───
// Normal for 2 seconds (~120 frames @60fps), then inject NaN/Inf
const nanInjection = {
  id: 'nan-injection',
  name: 'NaN Injection',
  icon: '💥',
  description: '정상 동작 2초 후 NaN/Inf 주입 → 좌측 암 소실, 우측 차단+정지',
  color: '#ef4444',
  generate(frame) {
    if (frame < 120) return idleAction(frame);

    const action = idleAction(frame);
    // Inject NaN into multiple dimensions
    const nanDims = [(frame % 5), ((frame + 2) % 7)];
    for (const d of nanDims) {
      action[d] = (frame % 3 === 0) ? NaN : Infinity;
    }
    return action;
  },
};

// ─── Scenario 2: Joint Limit Violation ───
// Gradually push joints past [-PI, PI] bounds
const jointLimitViolation = {
  id: 'joint-limit',
  name: 'Joint Limit Violation',
  icon: '🔧',
  description: '관절 범위 [-π, π] 초과 → 좌측 비정상 꺾임, 우측 클램핑',
  color: '#f97316',
  generate(frame) {
    const t = frame * 0.02;
    const overshoot = Math.min(frame / 60, 3.0); // ramp up over 3 seconds
    return new Float64Array([
      Math.sin(t * 0.5) * (PI + overshoot * 0.8),
      Math.cos(t * 0.7) * (PI + overshoot * 0.5),
      Math.sin(t * 0.3) * (PI + overshoot * 1.2),
      Math.sin(t * 1.0) * (PI + overshoot * 1.5),   // shoulder — worst offender
      Math.cos(t * 0.8) * (PI + overshoot * 1.0),    // elbow
      0.5 + Math.sin(t * 0.4) * (0.5 + overshoot * 0.4), // gripper overshoot
      0.5 + Math.cos(t * 0.4) * (0.5 + overshoot * 0.4),
    ]);
  },
};

// ─── Scenario 3: Velocity Spike ───
// Every 90 frames (~1.5s), teleport to extreme opposite position
const velocitySpike = {
  id: 'velocity-spike',
  name: 'Velocity Spike',
  icon: '⚡',
  description: '1.5초 간격 극단값 왕복 → 좌측 텔레포트, 우측 부드러운 보간',
  color: '#eab308',
  generate(frame) {
    const cycle = Math.floor(frame / 90);
    const phase = (cycle % 2 === 0) ? 1.0 : -1.0;
    const progress = (frame % 90) / 90;

    // Smooth base motion
    const base = idleAction(frame);

    // At the start of each cycle, spike to extreme position
    if (progress < 0.05) {
      // Sharp jump
      return new Float64Array([
        phase * PI * 0.8,
        phase * PI * 0.6,
        phase * PI * 0.9,
        phase * PI * 0.95,
        -phase * PI * 0.85,
        phase > 0 ? 1.0 : 0.0,
        phase > 0 ? 0.0 : 1.0,
      ]);
    }

    // Gradually drift back to normal
    const blend = Math.min(progress * 2, 1.0);
    const spike = new Float64Array([
      phase * PI * 0.8,
      phase * PI * 0.6,
      phase * PI * 0.9,
      phase * PI * 0.95,
      -phase * PI * 0.85,
      phase > 0 ? 1.0 : 0.0,
      phase > 0 ? 0.0 : 1.0,
    ]);

    const out = new Float64Array(7);
    for (let i = 0; i < 7; i++) {
      out[i] = spike[i] * (1 - blend) + base[i] * blend;
    }
    return out;
  },
};

// ─── Scenario 4: Autoregressive Drift ───
// Tiny cumulative bias added per frame → slow divergence
const autoregressiveDrift = {
  id: 'ar-drift',
  name: 'Autoregressive Drift',
  icon: '🌀',
  description: '프레임당 누적 편향 → 좌측 서서히 이탈, 우측 보정',
  color: '#a855f7',
  _driftAccum: null,
  generate(frame) {
    // Initialize / reset drift accumulator
    if (frame === 0 || !this._driftAccum) {
      this._driftAccum = new Float64Array(7);
    }

    const base = idleAction(frame);
    // Add small per-frame bias (different rate per dimension)
    const biases = [0.008, -0.006, 0.010, -0.012, 0.009, 0.003, -0.003];
    for (let i = 0; i < 7; i++) {
      this._driftAccum[i] += biases[i];
      base[i] += this._driftAccum[i];
    }
    return base;
  },
};

export const SCENARIOS = [nanInjection, jointLimitViolation, velocitySpike, autoregressiveDrift];

export function getScenario(id) {
  return SCENARIOS.find(s => s.id === id) || SCENARIOS[0];
}
