// app.js — Main: Scene setup, animation loop, controls
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createRobot, applyAction, updateNanParticles, createScene, createCamera } from './robot.js';
import { DreamDojoPipeline, GR1_PROFILE } from './guards.js';
import { SCENARIOS, getScenario } from './scenarios.js';
import { Dashboard } from './dashboard.js';

// ─── State ───
let playing = false;
let frameIndex = 0;
let speed = 1.0;
let currentScenario = SCENARIOS[0];
let previousAction = null;
let chainDeltas = [];  // rolling window of L1 deltas for chain guard

// ─── Pipeline ───
const pipeline = new DreamDojoPipeline(GR1_PROFILE);

// ─── Dashboard ───
const dashboard = new Dashboard();

// ─── Three.js Setup ───
const canvasL = document.getElementById('canvas-left');
const canvasR = document.getElementById('canvas-right');

const sceneL = createScene();
const sceneR = createScene();

function getViewportSize() {
  const vp = document.getElementById('viewport-left');
  return { width: vp.clientWidth, height: vp.clientHeight };
}

const { width, height } = getViewportSize();
const aspect = width / height;

const cameraL = createCamera(aspect);
const cameraR = createCamera(aspect);

const rendererL = new THREE.WebGLRenderer({ canvas: canvasL, antialias: true });
rendererL.setSize(width, height);
rendererL.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const rendererR = new THREE.WebGLRenderer({ canvas: canvasR, antialias: true });
rendererR.setSize(width, height);
rendererR.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// ─── OrbitControls (attached to left, synced to right) ───
const controls = new OrbitControls(cameraL, canvasL);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0.5, 0);

// ─── Robots ───
const robotLeft = createRobot(sceneL);
const robotRight = createRobot(sceneR);
// Ghost robot for drift reference
const ghostRight = createRobot(sceneR, { ghost: true });

// ─── UI Controls ───
const selectEl = document.getElementById('scenario-select');
const btnPlay = document.getElementById('btn-play');
const btnReset = document.getElementById('btn-reset');
const speedSlider = document.getElementById('speed-slider');
const speedValue = document.getElementById('speed-value');
const scenarioDesc = document.getElementById('scenario-desc');

// Populate scenario selector
SCENARIOS.forEach(s => {
  const opt = document.createElement('option');
  opt.value = s.id;
  opt.textContent = `${s.icon} ${s.name}`;
  selectEl.appendChild(opt);
});

function updateScenarioUI() {
  scenarioDesc.textContent = currentScenario.description;
}
updateScenarioUI();

selectEl.addEventListener('change', () => {
  currentScenario = getScenario(selectEl.value);
  updateScenarioUI();
  resetSimulation();
});

btnPlay.addEventListener('click', () => {
  playing = !playing;
  btnPlay.innerHTML = playing ? '&#9632; Pause' : '&#9654; Play';
  btnPlay.classList.toggle('active', playing);
});

btnReset.addEventListener('click', resetSimulation);

speedSlider.addEventListener('input', () => {
  speed = parseFloat(speedSlider.value);
  speedValue.textContent = `${speed.toFixed(2)}x`;
});

function resetSimulation() {
  playing = false;
  frameIndex = 0;
  previousAction = null;
  chainDeltas = [];
  btnPlay.innerHTML = '&#9654; Play';
  btnPlay.classList.remove('active');
  dashboard.reset();

  // Reset drift accumulators in scenarios
  for (const s of SCENARIOS) {
    if (s._driftAccum) s._driftAccum = null;
  }

  // Reset robots to idle pose
  const idle = new Float64Array(7).fill(0);
  idle[5] = 0.5;
  idle[6] = 0.5;
  applyAction(robotLeft, idle);
  applyAction(robotRight, idle);
  applyAction(ghostRight, idle);
}

// ─── Resize Handler ───
window.addEventListener('resize', () => {
  const { width: w, height: h } = getViewportSize();
  const a = w / h;

  cameraL.aspect = a;
  cameraL.updateProjectionMatrix();
  cameraR.aspect = a;
  cameraR.updateProjectionMatrix();

  rendererL.setSize(w, h);
  rendererR.setSize(w, h);
});

// ─── Animation Loop ───
let lastTime = 0;
let accumulator = 0;
const FIXED_DT = 1 / 60; // 60fps simulation step

function animate(time) {
  requestAnimationFrame(animate);

  const dt = Math.min((time - lastTime) / 1000, 0.1);
  lastTime = time;

  // Update controls
  controls.update();

  // Sync right camera to left
  cameraR.position.copy(cameraL.position);
  cameraR.rotation.copy(cameraL.rotation);
  cameraR.quaternion.copy(cameraL.quaternion);

  if (playing) {
    accumulator += dt * speed;

    while (accumulator >= FIXED_DT) {
      accumulator -= FIXED_DT;
      simulationStep();
    }
  }

  // NaN particle animation
  updateNanParticles(robotLeft, time);
  updateNanParticles(robotRight, time);

  // Render
  rendererL.render(sceneL, cameraL);
  rendererR.render(sceneR, cameraR);
}

function simulationStep() {
  // Generate raw action from scenario
  const rawAction = currentScenario.generate(frameIndex);

  // ── LEFT (unprotected): apply raw action directly ──
  applyAction(robotLeft, rawAction);

  // ── RIGHT (protected): evaluate + remediate ──
  const result = pipeline.evaluate(
    Array.from(rawAction),
    previousAction ? Array.from(previousAction) : null,
    chainDeltas.length > 0 ? chainDeltas : null,
  );

  const safeAction = pipeline.remediate(rawAction, previousAction);
  applyAction(robotRight, safeAction, result.actionResult.violations);

  // Ghost shows "where it should be" (idle reference for drift scenario)
  if (currentScenario.id === 'ar-drift') {
    const t = frameIndex * 0.02;
    const idleRef = new Float64Array([
      Math.sin(t * 0.5) * 0.3,
      Math.cos(t * 0.7) * 0.2,
      Math.sin(t * 0.3) * 0.4,
      Math.sin(t * 1.0) * 0.8,
      Math.cos(t * 0.8) * 0.6,
      0.5 + Math.sin(t * 0.4) * 0.3,
      0.5 + Math.cos(t * 0.4) * 0.3,
    ]);
    applyAction(ghostRight, idleRef);
    ghostRight.root.visible = true;
  } else {
    ghostRight.root.visible = false;
  }

  // Update chain deltas (L1 norm of frame-to-frame change)
  if (previousAction) {
    let l1 = 0;
    for (let i = 0; i < rawAction.length; i++) {
      const v = rawAction[i];
      const p = previousAction[i];
      if (Number.isFinite(v) && Number.isFinite(p)) {
        l1 += Math.abs(v - p);
      }
    }
    chainDeltas.push(l1);
    if (chainDeltas.length > 64) chainDeltas.shift();
  }

  // Update dashboard
  dashboard.update(result, frameIndex);

  // Store previous action (use safe action for chain tracking)
  previousAction = safeAction;
  frameIndex++;
}

// ─── Init ───
resetSimulation();
requestAnimationFrame(animate);
