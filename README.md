# AEGIS DreamDojo Guard SDK

**Runtime safety validation framework for embodied AI world models.**

Intercept adversarial inputs, physically unsafe actions, and anomalous inference states before they reach real robots. Designed as a drop-in safety layer for [NVIDIA DreamDojo](https://research.nvidia.com/labs/gear/dreamdojo/) and compatible Diffusion Transformer (DiT) world model pipelines.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust-1.75%2B-orange.svg)](https://www.rust-lang.org/)

---

## Interactive Demo

A browser-based Three.js simulation that visualizes the SDK's guard pipeline in real time. Split-screen comparison of an **unprotected** robot (left) vs. an **AEGIS-protected** robot (right) across 4 attack scenarios.

[![Demo Video](https://img.youtube.com/vi/i-5o6GxYsfY/maxresdefault.jpg)](https://youtu.be/i-5o6GxYsfY)

> **[Watch the full demo on YouTube](https://youtu.be/i-5o6GxYsfY)**

### Attack Scenarios

| Scenario | Description | Risk Level |
|----------|-------------|------------|
| NaN Injection | NaN/Inf values injected into action tensor — unprotected arm disappears, protected arm halts safely | BLOCKED (1.0) |
| Joint Limit Violation | Joints pushed past [-π, π] bounds — unprotected arm contorts, protected arm clamps | WARNING (0.6) |
| Velocity Spike | Extreme position jumps every 1.5s — unprotected arm teleports, protected arm interpolates smoothly | SAFE (0.0) |
| Autoregressive Drift | Cumulative per-frame bias — unprotected arm drifts away, protected arm corrects | DANGER (0.8) |

<p align="center">
  <img src="docs/img1.png" width="49%" alt="NaN Injection — BLOCKED (risk 1.0)">
  <img src="docs/img4.png" width="49%" alt="Joint Limit Violation — WARNING (risk 0.6)">
</p>
<p align="center">
  <img src="docs/img3.png" width="49%" alt="Velocity Spike — SAFE (risk 0.0)">
  <img src="docs/img2.png" width="49%" alt="Autoregressive Drift — DANGER (risk 0.8)">
</p>

### Run Locally

```bash
cd demo && python3 -m http.server 8080
# Open http://localhost:8080
```

No build step required — pure ES Modules + Three.js CDN.

---

## About This Research

This project is led by **Kwangil Kim** and **Seokju Kang**, Research Directors at **[Yatav Inc.](https://yatav.com)**, as part of the AEGIS (AI Engine for Guardrail & Inspection System) initiative — a broader program dedicated to adversarial robustness and safety verification across LLM, multimodal, and embodied AI systems.

NVIDIA DreamDojo is currently in an active research phase, advancing the state of the art in generalist robot world models. We are conducting parallel, independent safety research to continuously develop and publish defense mechanisms that keep pace with its evolution. As DreamDojo's capabilities expand — from 2B to 14B parameters, from single-robot to cross-embodiment generalization — the attack surface grows correspondingly. Our goal is to ensure that safety guardrails evolve at the same velocity as the models they protect.

**We welcome collaborators.** If you are a researcher, engineer, or organization working on embodied AI safety — whether in robotics, world models, adversarial robustness, sim-to-real transfer security, or safe autonomous deployment — we would be glad to collaborate. Open an issue, submit a PR, or reach out directly at research@yatav.com.

---

## Motivation: Why World Models Need Runtime Guards

DreamDojo represents a paradigm shift: a single 2B/14B parameter Diffusion Transformer that ingests camera frames and robot actions, then predicts future video trajectories. This enables zero-shot sim-to-real transfer and cross-embodiment policy learning. However, this power introduces novel attack surfaces absent in traditional robotics:

| Traditional Robotics | World Model Robotics (DreamDojo) |
|---------------------|----------------------------------|
| Hardcoded joint limits | Learned action distributions (384-dim, min-max normalized) |
| Sensor → Controller → Actuator | Camera → DiT → Predicted Future → Policy extraction |
| Deterministic safety envelopes | Probabilistic generation with classifier-free guidance |
| Single-robot firmware | Cross-embodiment shared latent space (GR-1, G1, YAM, AgiBot) |
| No autoregressive feedback | Sliding-window autoregression (error accumulation risk) |

**A single adversarial perturbation in the condition frame can propagate through the autoregressive chain, producing a plausible-looking but physically dangerous trajectory that a downstream policy executes on real hardware.**

This SDK provides the first open-source defense layer purpose-built for this threat model.

---

## Threat Model

Nine categories of risk identified through red team analysis of the DreamDojo inference pipeline:

| # | Threat | Severity | Attack Vector | SDK Guard | Detection Method |
|---|--------|----------|---------------|-----------|-----------------|
| T1 | NaN/Inf injection | CRITICAL | Corrupted action tensor | `ActionSpaceGuard` | Per-element IEEE 754 scan |
| T2 | Joint limit violation | CRITICAL | Out-of-bounds commands via inverse normalization | `ActionSpaceGuard` | Embodiment-specific bound check |
| T3 | Velocity spike attack | HIGH | Sudden delta between consecutive actions | `ActionSpaceGuard` | Temporal delta-from-previous |
| T4 | Blank/corrupted frame | HIGH | All-zero or uniform color injection | `WorldModelInputGuard` | Statistical pixel analysis |
| T5 | Adversarial perturbation | HIGH | Imperceptible noise in condition frame | `WorldModelInputGuard` | High-frequency energy detection |
| T6 | Autoregressive drift | HIGH | Error accumulation through sliding window | `AutoregressiveChainGuard` | Cumulative delta tracking |
| T7 | Temporal discontinuity | HIGH | Sudden frame-to-frame jump in prediction chain | `AutoregressiveChainGuard` | Per-frame delta spike |
| T8 | Latent space anomaly | HIGH | LAM latent manipulation (dim 352:384) | `LatentSpaceGuard` | L2 norm + element sigma |
| T9 | Guidance abuse | MEDIUM | Extreme CFG scale causing mode collapse | `GuidanceGuard` | Parameter range validation |

For the full analysis including attack scenarios, ASR benchmarks, and gap assessment, see [`docs/SECURITY_ANALYSIS.md`](docs/SECURITY_ANALYSIS.md).

---

## Architecture

### Defense Pipeline

```
  Robot Camera (Condition Frame)          Robot Action Command
         │                                       │
         ▼                                       ▼
  ┌──────────────────┐                 ┌───────────────────┐
  │ WorldModelInput  │                 │  ActionSpaceGuard  │
  │     Guard        │                 │                    │
  │                  │                 │ - NaN/Inf scan     │
  │ - Dimension      │                 │ - Joint bounds     │
  │ - All-zero       │                 │ - Velocity delta   │
  │ - Uniform color  │                 │ - Gripper range    │
  │ - Mean/Std       │                 │ - Scale boundary   │
  │ - High-freq      │                 └────────┬──────────┘
  └────────┬─────────┘                          │
           │              Inference Params      │
           │                     │               │
           ▼                     ▼               │
  ┌──────────────────────────────────────┐      │
  │          GuidanceGuard               │      │
  │                                      │      │
  │ - Guidance scale range [1.0, 15.0]   │      │
  │ - Extreme guidance detection         │      │
  │ - Step count validation              │      │
  │ - Resolution & frame count           │      │
  └──────────────┬───────────────────────┘      │
                 │                               │
                 ▼          LAM Latent           │
  ┌──────────────────────────────────────┐      │
  │        LatentSpaceGuard              │      │
  │                                      │      │
  │ - L2 norm bounds [0.1, 50.0]         │      │
  │ - Element-wise sigma analysis        │      │
  │ - NaN/Inf in latent dimensions       │      │
  └──────────────┬───────────────────────┘      │
                 │                               │
                 ▼                               │
  ┌──────────────────────────────────────┐      │
  │     DreamDojo DiT Inference          │◄─────┘
  │     (2B / 14B parameters)            │
  └──────────────┬───────────────────────┘
                 │
                 ▼   Predicted Frame Sequence
  ┌──────────────────────────────────────┐
  │    AutoregressiveChainGuard          │
  │                                      │
  │ - Empty/oversized chain detection    │
  │ - Temporal delta spike               │
  │ - Cumulative drift tracking          │
  │ - Chain length enforcement           │
  └──────────────┬───────────────────────┘
                 │
                 ▼
  ┌──────────────────────────────────────┐
  │         PipelineResult               │
  │                                      │
  │  { is_safe, overall_risk,            │
  │    risk_level, guard_reports[] }     │
  └──────────────────────────────────────┘
```

### Execution Order

| Phase | Guard | Purpose |
|-------|-------|---------|
| **Pre-inference** | `ActionSpaceGuard` | Validate action tensor before world model consumes it |
| **Pre-inference** | `WorldModelInputGuard` | Validate condition frame integrity |
| **Pre-inference** | `GuidanceGuard` | Validate inference parameters |
| **Pre-inference** | `LatentSpaceGuard` | Validate LAM latent vector |
| **Post-inference** | `AutoregressiveChainGuard` | Validate generated prediction chain |

Early exit is supported: if any pre-inference guard blocks, subsequent guards and inference can be skipped entirely.

---

## Quick Start

### Installation

```toml
[dependencies]
aegis-dreamdojo-sdk = "0.1"
```

### Single Guard: Validate an Action Tensor

```rust
use aegis_dreamdojo_sdk::prelude::*;

let guard = ActionSpaceGuard::new(EmbodimentType::Gr1);

let action = ActionTensor {
    values: vec![0.1, -0.2, 0.0, 0.5, -0.3, 0.8, 0.2],
    previous_values: None,
    embodiment_type: EmbodimentType::Gr1,
    step_index: 0,
    recent_gripper_states: vec![],
};

let result = guard.evaluate(&action);
if !result.is_safe {
    eprintln!("BLOCKED (risk={:.4}): {:?}", result.risk_score, result.messages);
    // Do NOT send action to robot
}
```

### Full Pipeline: End-to-End Validation

```rust
use aegis_dreamdojo_sdk::prelude::*;

let pipeline = DreamDojoPipeline::for_gr1();

let request = PipelineRequest {
    action: Some(ActionTensor {
        values: vec![0.1, -0.2, 0.0, 0.5, -0.3, 0.8, 0.2],
        previous_values: None,
        embodiment_type: EmbodimentType::Gr1,
        step_index: 0,
        recent_gripper_states: vec![],
    }),
    condition_frame: None,
    inference_params: Some(InferenceParams {
        guidance_scale: 7.5,
        num_steps: 50,
        num_conditional_frames: 2,
        resolution: [512, 512],
        seed: None,
        use_negative_prompt: false,
    }),
    latent_vector: Some(LatentVector {
        values: (0..32).map(|i| (i as f64 - 16.0) * 0.1).collect(),
        batch: vec![],
    }),
    predicted_chain: Some(
        (0..8).map(|i| PredictedFrame {
            index: i,
            pixel_mean: 128.0,
            pixel_std: 30.0,
            temporal_delta: Some(3.0),
        }).collect(),
    ),
};

let result = pipeline.evaluate(&request);

match result.risk_level {
    RiskLevel::Safe    => println!("CLEAR — proceed"),
    RiskLevel::Warning => println!("CAUTION — review reports"),
    RiskLevel::Danger  => println!("DANGER — human approval required"),
    RiskLevel::Blocked => println!("BLOCKED — abort execution"),
}

// Inspect individual guard results
for report in &result.guard_reports {
    println!("[{}] risk={:.4} passed={} violations={}",
        report.guard_name, report.risk_score, report.passed, report.violation_count);
}
```

---

## Guard Reference

### ActionSpaceGuard

Validates robot action tensors against embodiment-specific physical constraints.

| Check | Description | Severity |
|-------|-------------|----------|
| NaN/Inf | IEEE 754 special values in any dimension | 1.0 (critical) |
| Dimension mismatch | Action dim != expected for embodiment | 1.0 (critical) |
| Range violation | Joint value outside embodiment bounds | 0.5 |
| Scale boundary | Value far beyond bounds (adversarial) | 0.9 |
| Velocity spike | Excessive delta from previous action | 0.7 |
| Zero action | All-zero vector (stuck/corrupted) | 0.3 |
| Gripper range | Gripper value outside [0, 1] | 0.6 |

### WorldModelInputGuard

Validates condition frames (camera inputs) for anomalies before world model inference.

| Check | Description | Severity |
|-------|-------------|----------|
| Dimension mismatch | Pixel count != H x W x C | 1.0 |
| All-zero | Blank frame (corrupted sensor) | 0.9 |
| Uniform color | Near-zero std deviation (injection) | 0.7 |
| Mean anomaly | Too dark (< 10) or too bright (> 245) | 0.5 |
| Std anomaly | Excessive variance (> 120) | 0.6 |
| High-frequency noise | Adjacent pixel energy above threshold | 0.7 |

### AutoregressiveChainGuard

Monitors sequences of predicted frames for temporal consistency and drift.

| Check | Description | Severity |
|-------|-------------|----------|
| Empty chain | No frames in prediction sequence | 1.0 |
| Chain length exceeded | Exceeds max (default: 64) | 0.8 |
| Temporal delta spike | Sudden jump between frames | 0.7 |
| Drift accumulation | Cumulative deviation exceeds threshold | 0.8 |

### LatentSpaceGuard

Validates latent vectors from the LAM (Latent Action Model) encoder.

| Check | Description | Severity |
|-------|-------------|----------|
| NaN/Inf | Special values in latent dimensions | 1.0 |
| Dimension mismatch | Vector dim != expected (default: 32) | 1.0 |
| Norm anomaly | L2 norm below 0.1 (collapsed) or above 50.0 (exploding) | 0.7 ~ 0.8 |
| Element sigma | Individual dimension exceeds N sigma from mean | 0.6 |

### GuidanceGuard

Validates inference hyperparameters to prevent generation abuse.

| Check | Description | Severity |
|-------|-------------|----------|
| Guidance scale | Outside valid range [1.0, 15.0] | 0.6 |
| Extreme guidance | Above extreme threshold (mode collapse risk) | 0.9 |
| Step count | Outside [10, 100] | 0.5 |
| Conditional frames | Not in allowed set {1, 2, 4, 8} | 0.4 |
| Resolution | Not in allowed resolution list | 0.4 |

---

## Supported Embodiments

| Robot | Type | Action Dims | Gripper Indices | Description |
|-------|------|-------------|-----------------|-------------|
| Fourier GR1 | `EmbodimentType::Gr1` | 7 | [5, 6] | Humanoid upper body |
| Unitree G1 | `EmbodimentType::G1` | 41 | [20, 40] | Full-body humanoid |
| Galaxea YAM | `EmbodimentType::Yam` | 14 | [6, 13] | Bimanual manipulator |
| AgiBot | `EmbodimentType::AgiBot` | 14 | [6, 13] | General-purpose robot |
| Custom | `EmbodimentType::Custom` | User-defined | User-defined | BYO embodiment profile |

### Custom Embodiment Profile

```rust
let profile = EmbodimentProfile {
    embodiment_type: EmbodimentType::Custom,
    name: "MyRobot".into(),
    action_dim: 6,
    dim_bounds: (0..6).map(|i| DimBound {
        lower: -2.0,
        upper: 2.0,
        name: format!("joint_{}", i),
    }).collect(),
    max_velocity: vec![1.5; 6],
    gripper_indices: vec![5],
    gripper_range: (0.0, 1.0),
    max_gripper_flip_rate: 0.5,
};

let guard = ActionSpaceGuard::with_profile(profile, ActionGuardConfig::default());
```

---

## Configuration

All guards accept custom config structs via `::with_config()`. SDK defaults are intentionally relaxed for broad compatibility during research. Tighten thresholds for deployment:

### SDK Defaults vs. Production Recommendations

| Parameter | SDK Default | Recommended (Lab) | Recommended (Production) |
|-----------|-----------|-------------------|--------------------------|
| `scale_boundary_multiplier` | 50.0 | 20.0 | 10.0 |
| `high_freq_threshold` | 2000.0 | 500.0 | 200.0 |
| `drift_threshold` | 500.0 | 100.0 | 50.0 |
| `max_element_sigma` | 6.0 | 4.0 | 3.0 |
| `extreme_guidance` | 50.0 | 20.0 | 15.0 |
| `block_threshold` | 0.8 | 0.6 | 0.5 |
| Risk Level cutoffs | 0.5 / 0.7 / 0.9 | 0.3 / 0.5 / 0.8 | 0.2 / 0.4 / 0.7 |
| Risk aggregation | `max(scores)` | `max*0.6 + mean*0.4` | Weighted ensemble |

```rust
// Example: Lab-grade configuration
let config = ActionGuardConfig {
    scale_boundary_multiplier: 20.0,
    allow_zero_action: false,
    block_threshold: 0.6,
};
let guard = ActionSpaceGuard::with_config(EmbodimentType::Gr1, config);
```

### Pipeline Configuration

```rust
let config = PipelineConfig {
    action_config: ActionGuardConfig { block_threshold: 0.6, ..Default::default() },
    input_config: InputGuardConfig { high_freq_threshold: 500.0, ..Default::default() },
    guidance_config: GuidanceGuardConfig { extreme_guidance: 20.0, ..Default::default() },
    latent_config: LatentGuardConfig { max_element_sigma: 4.0, ..Default::default() },
    chain_config: ChainGuardConfig { drift_threshold: 100.0, ..Default::default() },
    early_exit: true, // Skip remaining guards on first block
};
let pipeline = DreamDojoPipeline::with_config(EmbodimentType::Gr1, config);
```

---

## Serialization

All types implement `serde::Serialize` and `serde::Deserialize`. Guard results can be serialized to JSON for logging, auditing, or API integration:

```rust
let result = pipeline.evaluate(&request);
let json = serde_json::to_string_pretty(&result).unwrap();
// Send to monitoring system, write to audit log, return via API
```

---

## AEGIS Pro

The open-source SDK provides foundational safety validation. **AEGIS Pro** extends every guard with production-grade detection:

| Capability | SDK (Open Source) | Pro (Commercial) |
|-----------|-------------------|------------------|
| NaN/Inf + bounds checking | Yes | Yes |
| Risk aggregation | `max(scores)` | Weighted `max*0.6 + mean*0.4` |
| Action bounds | Generic `(-PI, PI)` | Robot-specific q01/q99 from production data |
| High-frequency detection | Adjacent pixel L2 energy | 2nd-order finite difference spectral analysis |
| Drift detection | Cumulative sum | Welford streaming variance + z-score anomaly |
| Latent analysis | L2 norm + element sigma | Pearson sliding-window cross-correlation |
| Guidance validation | Range check | Deterministic Defense mode (theta=0) |
| Gripper analysis | Range check | Flip-rate temporal analysis |
| Seed validation | Not included | Suspicious seed pattern detection |
| Prompt defense | Not included | PALADIN 6-Layer + 7 Red Team algorithms |
| Visual defense | Basic statistics | VisCRA + MML + VCS-M multimodal safety |
| Autonomy control | Not included | HITL enforcement + Dead Man Switch |
| Threshold tuning | Manual | Auto-tuned on adversarial attack datasets |

Contact: sales@yatav.com

---

## Project Structure

```
aegis-dreamdojo-sdk/
├── Cargo.toml                 # Independent crate (not workspace member)
├── LICENSE                    # Apache-2.0
├── README.md                  # This file
├── demo/                      # Three.js robot simulation demo
│   ├── index.html             # Entry point (import map + Three.js CDN)
│   ├── css/styles.css         # Dark theme, split layout, dashboard
│   └── js/
│       ├── guards.js          # SDK guard logic ported to JS
│       ├── robot.js           # 7-DOF robot arm (Three.js primitives)
│       ├── scenarios.js       # 4 attack scenario generators
│       ├── dashboard.js       # Risk gauge, guard cards, violation log
│       └── app.js             # Main: dual renderer, animation loop
├── docs/
│   ├── SECURITY_ANALYSIS.md   # Full red team analysis report
│   └── img1~4.png             # Demo screenshots
├── src/
│   ├── lib.rs                 # Module declarations + prelude re-exports
│   ├── types.rs               # All public types, enums, configs (~550 lines)
│   ├── traits.rs              # GuardEngine trait definition
│   ├── action_guard.rs        # ActionSpaceGuard implementation
│   ├── input_guard.rs         # WorldModelInputGuard implementation
│   ├── chain_guard.rs         # AutoregressiveChainGuard implementation
│   ├── latent_guard.rs        # LatentSpaceGuard implementation
│   ├── guidance_guard.rs      # GuidanceGuard implementation
│   └── pipeline.rs            # DreamDojoPipeline orchestrator
├── examples/
│   ├── validate_action.rs     # Single action validation demo
│   └── full_pipeline.rs       # End-to-end pipeline demo
└── tests/
    └── basic_tests.rs         # 16 integration tests
```

**Total:** ~2,900 lines of Rust, 39 tests (22 unit + 16 integration + 1 doc-test), 0 clippy warnings.

---

## Running

```bash
cargo check                              # Verify compilation
cargo test                               # Run all 39 tests
cargo clippy -- -W clippy::all           # Lint check
cargo run --example validate_action      # Single guard demo
cargo run --example full_pipeline        # Full pipeline demo
```

---

## Contributing

We are actively seeking contributions in the following areas:

- **New embodiment profiles** — Add joint bounds and velocity limits for additional robots
- **Adversarial benchmarks** — Standardized test suites for each guard
- **Integration examples** — DreamDojo inference pipeline integration, ROS2 bridges
- **Threshold research** — Empirical data on optimal detection thresholds
- **New guard modules** — Proposals for additional safety checks

Please open an issue to discuss before submitting large PRs.

---

## Citation

If you use this SDK in your research, please cite:

```bibtex
@software{aegis_dreamdojo_sdk,
  title  = {AEGIS DreamDojo Guard SDK: Runtime Safety Validation for Embodied AI World Models},
  author = {Kim, Kwangil and Kang, Seokju},
  year   = {2026},
  url    = {https://github.com/kwangilkimkenny/dreamdojo-aegis-sdk},
  note   = {Yatav Inc. AEGIS Research}
}
```

---

## License

Apache-2.0 — See [LICENSE](LICENSE)

Copyright 2026 Yatav Inc.
