// robot.js — 7-DOF Robot Arm with Three.js primitives
import * as THREE from 'three';

const JOINT_RADIUS = 0.08;
const LINK_RADIUS = 0.04;
const COLORS = {
  base: 0x4a5568,
  joint: 0x63b3ed,
  link: 0xa0aec0,
  gripper: 0x48bb78,
  violation: 0xff4444,
  ghost: 0x805ad5,
};

/** Create a single robot arm group */
export function createRobot(scene, options = {}) {
  const { ghost = false } = options;
  const root = new THREE.Group();

  // Materials
  const matBase = new THREE.MeshStandardMaterial({
    color: COLORS.base,
    metalness: 0.6,
    roughness: 0.3,
    transparent: ghost,
    opacity: ghost ? 0.25 : 1,
    wireframe: ghost,
  });
  const matJoint = new THREE.MeshStandardMaterial({
    color: COLORS.joint,
    metalness: 0.4,
    roughness: 0.4,
    transparent: ghost,
    opacity: ghost ? 0.25 : 1,
    wireframe: ghost,
  });
  const matLink = new THREE.MeshStandardMaterial({
    color: COLORS.link,
    metalness: 0.3,
    roughness: 0.5,
    transparent: ghost,
    opacity: ghost ? 0.25 : 1,
    wireframe: ghost,
  });
  const matGripper = new THREE.MeshStandardMaterial({
    color: COLORS.gripper,
    metalness: 0.3,
    roughness: 0.5,
    transparent: ghost,
    opacity: ghost ? 0.25 : 1,
    wireframe: ghost,
  });
  const matViolation = new THREE.MeshStandardMaterial({
    color: COLORS.violation,
    metalness: 0.2,
    roughness: 0.3,
    emissive: 0xff2222,
    emissiveIntensity: 0.5,
  });

  // ── Base platform ──
  const baseMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.25, 0.1, 32),
    matBase,
  );
  baseMesh.position.y = 0.05;
  root.add(baseMesh);

  // ── Joint 0: Base rotator (dim 0 = X, dim 1 = Y, dim 2 = Yaw) ──
  const joint0 = new THREE.Group();
  joint0.position.set(0, 0.1, 0);
  const j0Sphere = new THREE.Mesh(new THREE.SphereGeometry(JOINT_RADIUS, 16, 16), matJoint.clone());
  joint0.add(j0Sphere);
  root.add(joint0);

  // ── Link 0→1 ──
  const link0 = new THREE.Mesh(
    new THREE.CylinderGeometry(LINK_RADIUS, LINK_RADIUS, 0.4, 12),
    matLink.clone(),
  );
  link0.position.y = 0.2;
  joint0.add(link0);

  // ── Joint 1: Shoulder (dim 3) ──
  const joint1 = new THREE.Group();
  joint1.position.set(0, 0.4, 0);
  const j1Sphere = new THREE.Mesh(new THREE.SphereGeometry(JOINT_RADIUS, 16, 16), matJoint.clone());
  joint1.add(j1Sphere);
  joint0.add(joint1);

  // ── Link 1→2 ──
  const link1 = new THREE.Mesh(
    new THREE.CylinderGeometry(LINK_RADIUS * 0.9, LINK_RADIUS * 0.9, 0.35, 12),
    matLink.clone(),
  );
  link1.position.y = 0.175;
  joint1.add(link1);

  // ── Joint 2: Elbow (dim 4) ──
  const joint2 = new THREE.Group();
  joint2.position.set(0, 0.35, 0);
  const j2Sphere = new THREE.Mesh(new THREE.SphereGeometry(JOINT_RADIUS * 0.9, 16, 16), matJoint.clone());
  joint2.add(j2Sphere);
  joint1.add(joint2);

  // ── Link 2→gripper ──
  const link2 = new THREE.Mesh(
    new THREE.CylinderGeometry(LINK_RADIUS * 0.7, LINK_RADIUS * 0.7, 0.25, 12),
    matLink.clone(),
  );
  link2.position.y = 0.125;
  joint2.add(link2);

  // ── Gripper mount ──
  const gripperMount = new THREE.Group();
  gripperMount.position.set(0, 0.25, 0);
  joint2.add(gripperMount);

  // Left finger (dim 5)
  const fingerL = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.12, 0.04),
    matGripper.clone(),
  );
  fingerL.position.set(-0.04, 0.06, 0);
  gripperMount.add(fingerL);

  // Right finger (dim 6)
  const fingerR = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.12, 0.04),
    matGripper.clone(),
  );
  fingerR.position.set(0.04, 0.06, 0);
  gripperMount.add(fingerR);

  scene.add(root);

  // Robot state object
  return {
    root,
    joints: [joint0, joint1, joint2],
    links: [link0, link1, link2],
    fingers: [fingerL, fingerR],
    gripperMount,
    baseMesh,
    jointSpheres: [j0Sphere, j1Sphere, j2Sphere],
    materials: { matBase, matJoint, matLink, matGripper, matViolation },
    // NaN effect particles
    nanParticles: null,
    _originalMaterials: new Map(),
  };
}

/** Apply a 7-DOF action to the robot model */
export function applyAction(robot, action, violations = []) {
  const values = action;

  // Check for NaN — if any NaN, make robot transparent + show particles
  const hasNaN = Array.from(values).some(v => !Number.isFinite(v));
  if (hasNaN) {
    robot.root.traverse(child => {
      if (child.isMesh) {
        child.material.transparent = true;
        child.material.opacity = 0.1;
      }
    });
    showNanParticles(robot);
    return;
  }

  // Restore opacity
  robot.root.traverse(child => {
    if (child.isMesh && !child.material.wireframe) {
      child.material.transparent = false;
      child.material.opacity = 1.0;
    }
  });
  hideNanParticles(robot);

  // dim 0,1,2 → Base: translate X, translate Z, rotate Y
  robot.joints[0].position.x = values[0] * 0.15;
  robot.joints[0].position.z = values[1] * 0.15;
  robot.joints[0].rotation.y = values[2];

  // dim 3 → Shoulder rotation X
  robot.joints[1].rotation.x = values[3];

  // dim 4 → Elbow rotation X
  robot.joints[2].rotation.x = values[4];

  // dim 5,6 → Gripper fingers (open/close as X offset)
  const gripOpen5 = Number.isFinite(values[5]) ? values[5] : 0.5;
  const gripOpen6 = Number.isFinite(values[6]) ? values[6] : 0.5;
  robot.fingers[0].position.x = -0.02 - gripOpen5 * 0.06;
  robot.fingers[1].position.x = 0.02 + gripOpen6 * 0.06;

  // Highlight violated joints
  resetJointColors(robot);
  const violatedDims = new Set();
  for (const v of violations) {
    if (v.dimension !== undefined) violatedDims.add(v.dimension);
  }

  // Map dimensions to visual joints
  if (violatedDims.has(0) || violatedDims.has(1) || violatedDims.has(2)) {
    robot.jointSpheres[0].material = robot.materials.matViolation.clone();
  }
  if (violatedDims.has(3)) {
    robot.jointSpheres[1].material = robot.materials.matViolation.clone();
  }
  if (violatedDims.has(4)) {
    robot.jointSpheres[2].material = robot.materials.matViolation.clone();
  }
  if (violatedDims.has(5)) {
    robot.fingers[0].material = robot.materials.matViolation.clone();
  }
  if (violatedDims.has(6)) {
    robot.fingers[1].material = robot.materials.matViolation.clone();
  }
}

function resetJointColors(robot) {
  for (const s of robot.jointSpheres) {
    s.material = robot.materials.matJoint.clone();
  }
  robot.fingers[0].material = robot.materials.matGripper.clone();
  robot.fingers[1].material = robot.materials.matGripper.clone();
}

// ── NaN Particles ──
function showNanParticles(robot) {
  if (robot.nanParticles) return;

  const count = 40;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 0.6;
    positions[i * 3 + 1] = Math.random() * 1.2;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 0.6;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    color: 0xff4444,
    size: 0.03,
    transparent: true,
    opacity: 0.8,
  });

  robot.nanParticles = new THREE.Points(geo, mat);
  robot.root.add(robot.nanParticles);
}

function hideNanParticles(robot) {
  if (robot.nanParticles) {
    robot.root.remove(robot.nanParticles);
    robot.nanParticles.geometry.dispose();
    robot.nanParticles.material.dispose();
    robot.nanParticles = null;
  }
}

/** Animate NaN particles (call each frame) */
export function updateNanParticles(robot, time) {
  if (!robot.nanParticles) return;
  const pos = robot.nanParticles.geometry.attributes.position.array;
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] += (Math.random() - 0.5) * 0.01;
    pos[i + 1] += 0.005;
    pos[i + 2] += (Math.random() - 0.5) * 0.01;
    if (pos[i + 1] > 1.5) pos[i + 1] = 0;
  }
  robot.nanParticles.geometry.attributes.position.needsUpdate = true;
}

/** Create a scene with lights and grid */
export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a1a);

  // Ambient
  scene.add(new THREE.AmbientLight(0x404060, 0.8));

  // Directional
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(3, 5, 3);
  dirLight.castShadow = true;
  scene.add(dirLight);

  // Point light for warm fill
  const pointLight = new THREE.PointLight(0x6366f1, 0.5, 10);
  pointLight.position.set(-2, 3, 1);
  scene.add(pointLight);

  // Grid helper
  const grid = new THREE.GridHelper(4, 20, 0x1a1a3a, 0x1a1a3a);
  scene.add(grid);

  return scene;
}

/** Create a standard camera */
export function createCamera(aspect) {
  const camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 100);
  camera.position.set(1.5, 1.5, 2.0);
  camera.lookAt(0, 0.5, 0);
  return camera;
}
