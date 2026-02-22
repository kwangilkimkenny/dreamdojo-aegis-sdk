// guards.js — AEGIS DreamDojo SDK Guard Logic (JS port from Rust)
// Ported from: src/action_guard.rs, src/chain_guard.rs, src/types.rs, src/pipeline.rs

// ─── Risk Levels ───
export const RiskLevel = Object.freeze({
  SAFE: 'safe',
  WARNING: 'warning',
  DANGER: 'danger',
  BLOCKED: 'blocked',
});

export function riskLevelFromScore(score) {
  if (score < 0.5) return RiskLevel.SAFE;
  if (score < 0.7) return RiskLevel.WARNING;
  if (score < 0.9) return RiskLevel.DANGER;
  return RiskLevel.BLOCKED;
}

export const RISK_COLORS = {
  [RiskLevel.SAFE]: '#22c55e',
  [RiskLevel.WARNING]: '#eab308',
  [RiskLevel.DANGER]: '#f97316',
  [RiskLevel.BLOCKED]: '#ef4444',
};

// ─── GR1 Embodiment Profile ───
export const GR1_PROFILE = {
  name: 'GR1',
  actionDim: 7,
  bounds: Array.from({ length: 7 }, () => [-Math.PI, Math.PI]),
  maxVelocity: new Float64Array(7).fill(2.0),
  gripperIndices: [5, 6],
  gripperRange: [0.0, 1.0],
};

// ─── Violation Categories & Severities ───
export const ActionViolation = {
  NAN_INF:       { name: 'NaN/Inf',           severity: 1.0 },
  DIM_MISMATCH:  { name: 'DimensionMismatch', severity: 1.0 },
  RANGE:         { name: 'RangeViolation',     severity: 0.5 },
  SCALE_BOUND:   { name: 'ScaleBoundary',      severity: 0.9 },
  VELOCITY:      { name: 'VelocitySpike',      severity: 0.7 },
  GRIPPER:       { name: 'GripperRange',        severity: 0.6 },
  ZERO_ACTION:   { name: 'ZeroAction',          severity: 0.3 },
};

export const ChainViolation = {
  EMPTY:        { name: 'EmptyChain',            severity: 1.0 },
  LENGTH:       { name: 'ChainLengthExceeded',   severity: 0.8 },
  DELTA_SPIKE:  { name: 'TemporalDeltaSpike',    severity: 0.7 },
  DRIFT:        { name: 'DriftAccumulation',      severity: 0.8 },
};

// ─── ActionSpaceGuard ───
export class ActionSpaceGuard {
  constructor(profile = GR1_PROFILE) {
    this.profile = profile;
    this.scaleBoundaryMultiplier = 50.0;
    this.blockThreshold = 0.8;
    this.allowZeroAction = false;
  }

  check(action, previousAction = null) {
    const violations = [];
    const values = action;

    // 1. NaN/Inf check
    for (let i = 0; i < values.length; i++) {
      if (!Number.isFinite(values[i])) {
        violations.push({
          ...ActionViolation.NAN_INF,
          dimension: i,
          message: `Dimension ${i}: NaN/Inf detected (value=${values[i]})`,
        });
      }
    }

    // 2. Dimension check
    if (values.length !== this.profile.actionDim) {
      violations.push({
        ...ActionViolation.DIM_MISMATCH,
        message: `Expected ${this.profile.actionDim} dims, got ${values.length}`,
      });
    }

    // Skip remaining checks if NaN/Inf found
    if (violations.some(v => v.name === 'NaN/Inf')) {
      return this._buildResult(violations);
    }

    // 3. Range & Scale Boundary check
    const dim = Math.min(values.length, this.profile.actionDim);
    for (let i = 0; i < dim; i++) {
      const [lo, hi] = this.profile.bounds[i];
      const range = hi - lo;
      const scaledLo = lo - range * this.scaleBoundaryMultiplier;
      const scaledHi = hi + range * this.scaleBoundaryMultiplier;

      if (values[i] < scaledLo || values[i] > scaledHi) {
        violations.push({
          ...ActionViolation.SCALE_BOUND,
          dimension: i,
          message: `Dim ${i}: ${values[i].toFixed(3)} outside scaled bounds [${scaledLo.toFixed(1)}, ${scaledHi.toFixed(1)}]`,
        });
      } else if (values[i] < lo || values[i] > hi) {
        violations.push({
          ...ActionViolation.RANGE,
          dimension: i,
          message: `Dim ${i}: ${values[i].toFixed(3)} outside bounds [${lo.toFixed(2)}, ${hi.toFixed(2)}]`,
        });
      }
    }

    // 4. Zero action check
    if (!this.allowZeroAction && values.every(v => v === 0)) {
      violations.push({
        ...ActionViolation.ZERO_ACTION,
        message: 'All-zero action detected',
      });
    }

    // 5. Velocity check
    if (previousAction) {
      for (let i = 0; i < dim; i++) {
        const delta = Math.abs(values[i] - previousAction[i]);
        if (delta > this.profile.maxVelocity[i]) {
          violations.push({
            ...ActionViolation.VELOCITY,
            dimension: i,
            message: `Dim ${i}: velocity ${delta.toFixed(3)} > max ${this.profile.maxVelocity[i]}`,
          });
        }
      }
    }

    // 6. Gripper range check
    for (const gi of this.profile.gripperIndices) {
      if (gi < values.length) {
        const [gLo, gHi] = this.profile.gripperRange;
        if (values[gi] < gLo || values[gi] > gHi) {
          violations.push({
            ...ActionViolation.GRIPPER,
            dimension: gi,
            message: `Gripper dim ${gi}: ${values[gi].toFixed(3)} outside [${gLo}, ${gHi}]`,
          });
        }
      }
    }

    return this._buildResult(violations);
  }

  _buildResult(violations) {
    const riskScore = violations.length > 0
      ? Math.max(...violations.map(v => v.severity))
      : 0;
    return {
      isSafe: riskScore < this.blockThreshold,
      riskScore,
      violations,
      messages: violations.map(v => v.message),
    };
  }
}

// ─── AutoregressiveChainGuard ───
export class AutoregressiveChainGuard {
  constructor() {
    this.maxTemporalDelta = 50.0;
    this.maxChainLength = 64;
    this.driftThreshold = 500.0;
    this.blockThreshold = 0.8;
  }

  check(deltas) {
    const violations = [];

    // 1. Empty chain
    if (!deltas || deltas.length === 0) {
      violations.push({
        ...ChainViolation.EMPTY,
        message: 'Empty prediction chain',
      });
      return this._buildResult(violations, { frameCount: 0, meanDelta: 0, maxDelta: 0, driftScore: 0 });
    }

    // 2. Chain length
    if (deltas.length > this.maxChainLength) {
      violations.push({
        ...ChainViolation.LENGTH,
        message: `Chain length ${deltas.length} > max ${this.maxChainLength}`,
      });
    }

    // 3. Delta spikes
    let driftScore = 0;
    let maxDelta = 0;
    for (let i = 0; i < deltas.length; i++) {
      const d = Math.abs(deltas[i]);
      maxDelta = Math.max(maxDelta, d);
      driftScore += d;
      if (d > this.maxTemporalDelta) {
        violations.push({
          ...ChainViolation.DELTA_SPIKE,
          frameIndex: i,
          message: `Frame ${i}: delta ${d.toFixed(2)} > max ${this.maxTemporalDelta}`,
        });
      }
    }

    // 4. Drift accumulation
    if (driftScore > this.driftThreshold) {
      violations.push({
        ...ChainViolation.DRIFT,
        message: `Cumulative drift ${driftScore.toFixed(2)} > threshold ${this.driftThreshold}`,
      });
    }

    const stats = {
      frameCount: deltas.length,
      meanDelta: driftScore / deltas.length,
      maxDelta,
      driftScore,
    };

    return this._buildResult(violations, stats);
  }

  _buildResult(violations, stats) {
    const riskScore = violations.length > 0
      ? Math.max(...violations.map(v => v.severity))
      : 0;
    return {
      isSafe: riskScore < this.blockThreshold,
      riskScore,
      violations,
      messages: violations.map(v => v.message),
      chainStats: stats,
    };
  }
}

// ─── Stub Guards (for dashboard display) ───
export class LatentSpaceGuard {
  check() { return { isSafe: true, riskScore: 0, violations: [], messages: [] }; }
}

export class GuidanceGuard {
  check() { return { isSafe: true, riskScore: 0, violations: [], messages: [] }; }
}

export class WorldModelInputGuard {
  check() { return { isSafe: true, riskScore: 0, violations: [], messages: [] }; }
}

// ─── DreamDojo Pipeline ───
export class DreamDojoPipeline {
  constructor(profile = GR1_PROFILE) {
    this.actionGuard = new ActionSpaceGuard(profile);
    this.chainGuard = new AutoregressiveChainGuard();
    this.latentGuard = new LatentSpaceGuard();
    this.guidanceGuard = new GuidanceGuard();
    this.worldModelGuard = new WorldModelInputGuard();
    this.profile = profile;
  }

  evaluate(action, previousAction = null, chainDeltas = null) {
    const actionResult = this.actionGuard.check(action, previousAction);
    const chainResult = chainDeltas
      ? this.chainGuard.check(chainDeltas)
      : { isSafe: true, riskScore: 0, violations: [], messages: [] };
    const latentResult = this.latentGuard.check();
    const guidanceResult = this.guidanceGuard.check();
    const worldModelResult = this.worldModelGuard.check();

    const allScores = [
      actionResult.riskScore,
      chainResult.riskScore,
      latentResult.riskScore,
      guidanceResult.riskScore,
      worldModelResult.riskScore,
    ];
    const overallRisk = Math.max(...allScores);
    const riskLevel = riskLevelFromScore(overallRisk);

    return {
      isSafe: riskLevel === RiskLevel.SAFE || riskLevel === RiskLevel.WARNING,
      overallRisk,
      riskLevel,
      guardReports: [
        { name: 'ActionSpace', ...actionResult },
        { name: 'ChainGuard', ...chainResult },
        { name: 'LatentSpace', ...latentResult },
        { name: 'Guidance', ...guidanceResult },
        { name: 'WorldModel', ...worldModelResult },
      ],
      actionResult,
      chainResult,
    };
  }

  /** Remediate a raw action: replace NaN, clamp range, smooth velocity */
  remediate(action, previousAction = null) {
    const out = new Float64Array(this.profile.actionDim);
    const fallback = previousAction || new Float64Array(this.profile.actionDim);

    for (let i = 0; i < this.profile.actionDim; i++) {
      let v = (i < action.length) ? action[i] : 0;

      // NaN/Inf → fallback
      if (!Number.isFinite(v)) {
        v = fallback[i];
      }

      // Clamp to bounds
      const [lo, hi] = this.profile.bounds[i];
      v = Math.max(lo, Math.min(hi, v));

      // Velocity smoothing
      if (previousAction) {
        const delta = v - previousAction[i];
        const maxV = this.profile.maxVelocity[i];
        if (Math.abs(delta) > maxV) {
          v = previousAction[i] + Math.sign(delta) * maxV;
        }
      }

      // Gripper clamping
      if (this.profile.gripperIndices.includes(i)) {
        const [gLo, gHi] = this.profile.gripperRange;
        v = Math.max(gLo, Math.min(gHi, v));
      }

      out[i] = v;
    }

    return out;
  }
}
