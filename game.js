const canvas = document.querySelector("#game");
const stageText = document.querySelector("#stageText");
const studsText = document.querySelector("#studsText");
const timerText = document.querySelector("#timerText");
const message = document.querySelector("#message");
const restartButton = document.querySelector("#restartButton");
const settingsButton = document.querySelector("#settingsButton");
const settingsPanel = document.querySelector("#settingsPanel");
const closeSettingsButton = document.querySelector("#closeSettingsButton");
const sensitivitySlider = document.querySelector("#sensitivitySlider");
const speedSlider = document.querySelector("#speedSlider");
const fpsSlider = document.querySelector("#fpsSlider");
const sensitivityValue = document.querySelector("#sensitivityValue");
const speedValue = document.querySelector("#speedValue");
const fpsValue = document.querySelector("#fpsValue");
const shadowsToggle = document.querySelector("#shadowsToggle");
const shiftLockToggle = document.querySelector("#shiftLockToggle");
const mobileControlsToggle = document.querySelector("#mobileControlsToggle");
const fullscreenButton = document.querySelector("#fullscreenButton");
const gamePanel = document.querySelector(".game-panel");
const canvasWrap = document.querySelector(".canvas-wrap");

if (!window.THREE) {
  message.classList.remove("hidden");
  message.querySelector("strong").textContent = "Three.js did not load";
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8bd7ff);
scene.fog = new THREE.Fog(0x8bd7ff, 42, 120);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 180);
const keys = new Set();
const clock = new THREE.Clock();
const settings = {
  sensitivity: Number(sensitivitySlider.value),
  speed: Number(speedSlider.value),
  fpsLimit: Number(fpsSlider.value),
  graphics: "medium",
  shadows: true,
  shiftLock: false
};
let cameraYaw = Math.atan2(9, -8);
let looking = false;
let lastPointerX = 0;
let lastFrameTime = 0;

const colors = {
  red: 0xff4d5a,
  orange: 0xff9f1c,
  yellow: 0xffdf4d,
  blue: 0x3498ff,
  green: 0x39d273,
  pink: 0xff6fcf,
  purple: 0x9b5de5,
  lava: 0xff3b1f,
  dark: 0x26374f
};

const start = new THREE.Vector3(0, 2.5, 0);
const state = {
  velocity: new THREE.Vector3(),
  grounded: false,
  jumpQueued: false,
  coyoteTimer: 0,
  jumpBufferTimer: 0,
  respawn: start.clone(),
  stage: 1,
  studs: 0,
  finished: false,
  startedAt: performance.now()
};

const platforms = [];
const hazards = [];
const checkpoints = [];
const coins = [];

function box({ x, y, z, w, h, d, color, roughness = 0.72, metalness = 0.03 }) {
  const geometry = new THREE.BoxGeometry(w, h, d);
  const material = new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function addPlatform(data) {
  const mesh = box({ ...data, h: data.h || 0.9, roughness: 0.58 });
  platforms.push({ mesh, size: new THREE.Vector3(data.w, data.h || 0.9, data.d) });

  const studMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 });
  for (let x = -data.w / 2 + 1.2; x <= data.w / 2 - 1.2; x += 2.4) {
    for (let z = -data.d / 2 + 1.2; z <= data.d / 2 - 1.2; z += 2.4) {
      const stud = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.12, 18), studMaterial);
      stud.position.set(data.x + x, data.y + (data.h || 0.9) / 2 + 0.08, data.z + z);
      stud.receiveShadow = true;
      scene.add(stud);
    }
  }
}

function addHazard(data) {
  const mesh = box({ ...data, color: data.color || colors.lava, roughness: 0.4, metalness: 0.08 });
  hazards.push({ mesh, size: new THREE.Vector3(data.w, data.h, data.d), base: new THREE.Vector3(data.x, data.y, data.z), move: data.move });
}

function addCheckpoint(data) {
  const pad = box({ x: data.x, y: data.y, z: data.z, w: 2.5, h: 0.22, d: 2.5, color: 0xffd166 });
  const pole = box({ x: data.x - 0.8, y: data.y + 1.55, z: data.z, w: 0.12, h: 3, d: 0.12, color: colors.dark });
  const flag = box({ x: data.x + 0.15, y: data.y + 2.45, z: data.z, w: 1.8, h: 0.75, d: 0.08, color: 0xffffff });
  checkpoints.push({ pad, pole, flag, stage: data.stage, respawn: new THREE.Vector3(data.x, data.y + 1.6, data.z) });
}

function addCoin(x, y, z) {
  const coin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.46, 0.46, 0.14, 32),
    new THREE.MeshStandardMaterial({ color: 0xffc857, metalness: 0.25, roughness: 0.35 })
  );
  coin.rotation.z = Math.PI / 2;
  coin.position.set(x, y, z);
  coin.castShadow = true;
  scene.add(coin);
  coins.push({ mesh: coin, collected: false, baseY: y });
}

const sunlight = new THREE.DirectionalLight(0xffffff, 1.35);
sunlight.position.set(-15, 24, 18);
sunlight.castShadow = true;
sunlight.shadow.mapSize.set(2048, 2048);
sunlight.shadow.camera.left = -45;
sunlight.shadow.camera.right = 45;
sunlight.shadow.camera.top = 45;
sunlight.shadow.camera.bottom = -45;
scene.add(sunlight);
scene.add(new THREE.HemisphereLight(0xdff6ff, 0x5c6f46, 0.85));

const player = new THREE.Group();
const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x2176ff, roughness: 0.52 });
const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.58 });
const pantsMaterial = new THREE.MeshStandardMaterial({ color: 0x26374f, roughness: 0.55 });
const shirt = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.05, 0.55), bodyMaterial);
shirt.position.y = 1.05;
const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.62, 0.62), skinMaterial);
head.position.y = 1.9;
const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.95, 0.35), skinMaterial);
leftArm.position.set(-0.72, 1.06, 0);
const rightArm = leftArm.clone();
rightArm.position.x = 0.72;
const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.8, 0.38), pantsMaterial);
leftLeg.position.set(-0.23, 0.25, 0);
const rightLeg = leftLeg.clone();
rightLeg.position.x = 0.23;
player.add(shirt, head, leftArm, rightArm, leftLeg, rightLeg);
player.traverse((part) => {
  part.castShadow = true;
});
scene.add(player);

addPlatform({ x: 0, y: 0, z: 0, w: 8, d: 8, color: colors.green });
addPlatform({ x: 8, y: 1.3, z: -2.4, w: 5, d: 5, color: colors.red });
addPlatform({ x: 15, y: 2.6, z: 1.9, w: 5, d: 5, color: colors.orange });
addPlatform({ x: 22, y: 4, z: -1.6, w: 5.5, d: 5.5, color: colors.yellow });
addPlatform({ x: 30, y: 5.2, z: 1.8, w: 5, d: 5, color: colors.blue });
addPlatform({ x: 38, y: 6.6, z: -2, w: 5, d: 5, color: colors.pink });
addPlatform({ x: 46, y: 8, z: 1.4, w: 5.2, d: 5.2, color: colors.purple });
addPlatform({ x: 55, y: 9.1, z: 0, w: 9, d: 8, color: colors.green });

addHazard({ x: 11.7, y: 2.2, z: -2.4, w: 0.45, h: 2.2, d: 4.8, color: 0xff3131, move: { axis: "z", distance: 2.4, speed: 1.6 } });
addHazard({ x: 26, y: 4.75, z: -1.6, w: 4.5, h: 0.32, d: 0.55, color: 0xff3131, move: { axis: "x", distance: 2.2, speed: 1.8 } });
addHazard({ x: 42, y: 7.15, z: -2, w: 0.5, h: 2.5, d: 4.9, color: 0xff3131, move: { axis: "z", distance: 2.1, speed: 2.1 } });
addHazard({ x: 30, y: -1.1, z: 0, w: 68, h: 0.35, d: 24, color: colors.lava });

addCheckpoint({ x: 22, y: 4.58, z: -1.6, stage: 2 });
addCheckpoint({ x: 46, y: 8.58, z: 1.4, stage: 3 });

addCoin(8, 4.2, -2.4);
addCoin(15, 5.5, 1.9);
addCoin(22, 6.9, -1.6);
addCoin(30, 8.1, 1.8);
addCoin(38, 9.6, -2);
addCoin(46, 10.9, 1.4);

const finish = box({ x: 58, y: 11.25, z: 0, w: 0.3, h: 4, d: 5.5, color: colors.dark });
box({ x: 59.3, y: 12.7, z: 0, w: 2.3, h: 1.1, d: 0.08, color: 0xffffff });

const lavaGlow = new THREE.PointLight(0xff4f24, 1.4, 34);
lavaGlow.position.set(30, 0.6, 0);
scene.add(lavaGlow);

function resizeRenderer() {
  const rect = canvas.getBoundingClientRect();
  const renderWidth = Math.max(1, Math.floor(rect.width));
  const renderHeight = Math.max(1, Math.floor(rect.height));
  const pixelRatio = settings.graphics === "high" ? 2 : settings.graphics === "medium" ? 1.5 : 1;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatio));
  renderer.setSize(renderWidth, renderHeight, false);
  camera.aspect = renderWidth / renderHeight;
  camera.updateProjectionMatrix();
}

function updateSettingsText() {
  sensitivityValue.textContent = settings.sensitivity.toFixed(1);
  speedValue.textContent = `${settings.speed.toFixed(2)}x`;
  fpsValue.textContent = `${settings.fpsLimit} FPS`;
}

function setGraphicsQuality(quality) {
  settings.graphics = quality;
  document.querySelectorAll("[data-quality]").forEach((button) => {
    button.classList.toggle("active", button.dataset.quality === quality);
  });
  resizeRenderer();
}

function setSettingsOpen(isOpen) {
  settingsPanel.classList.toggle("hidden", !isOpen);
  settingsButton.setAttribute("aria-expanded", String(isOpen));
}

function setShiftLock(isOn) {
  settings.shiftLock = isOn;
  shiftLockToggle.checked = isOn;
  gamePanel.classList.toggle("shift-lock", isOn);
  canvas.style.cursor = isOn ? "crosshair" : "";

  if (!isOn && document.pointerLockElement === canvas) {
    document.exitPointerLock?.();
  }
}

function setControl(name, isDown) {
  if (isDown) {
    keys.add(name);
    if (name === "jump") state.jumpQueued = true;
    return;
  }

  keys.delete(name);
}

function handleKeyboard(event, isDown) {
  const code = event.code;
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "KeyA", "KeyD", "KeyW", "KeyS", "ShiftLeft", "ShiftRight"].includes(code)) {
    event.preventDefault();
  }

  if ((code === "ShiftLeft" || code === "ShiftRight") && isDown && !event.repeat) {
    setShiftLock(!settings.shiftLock);
    return;
  }

  if (code === "ArrowLeft" || code === "KeyA") setControl("left", isDown);
  if (code === "ArrowRight" || code === "KeyD") setControl("right", isDown);
  if (code === "ArrowUp" || code === "KeyW") setControl("forward", isDown);
  if (code === "ArrowDown" || code === "KeyS") setControl("back", isDown);
  if (code === "Space") setControl("jump", isDown);
}

function playerBox(position = player.position) {
  return {
    min: new THREE.Vector3(position.x - 0.48, position.y, position.z - 0.34),
    max: new THREE.Vector3(position.x + 0.48, position.y + 2.2, position.z + 0.34)
  };
}

function meshBox(mesh, size) {
  return {
    min: new THREE.Vector3(mesh.position.x - size.x / 2, mesh.position.y - size.y / 2, mesh.position.z - size.z / 2),
    max: new THREE.Vector3(mesh.position.x + size.x / 2, mesh.position.y + size.y / 2, mesh.position.z + size.z / 2)
  };
}

function intersects(a, b) {
  return a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y && a.min.z <= b.max.z && a.max.z >= b.min.z;
}

function resetPlayer() {
  player.position.copy(state.respawn);
  state.velocity.set(0, 0, 0);
  state.coyoteTimer = 0;
  state.jumpBufferTimer = 0;
}

function restartGame() {
  state.respawn.copy(start);
  state.stage = 1;
  state.studs = 0;
  state.finished = false;
  state.startedAt = performance.now();
  coins.forEach((coin) => {
    coin.collected = false;
    coin.mesh.visible = true;
  });
  checkpoints.forEach((checkpoint) => {
    checkpoint.flag.material.color.set(0xffffff);
    checkpoint.pad.material.color.set(0xffd166);
  });
  message.classList.add("hidden");
  resetPlayer();
}

function updateHazards(elapsed) {
  hazards.forEach((hazard) => {
    if (!hazard.move) return;

    hazard.mesh.position.copy(hazard.base);
    hazard.mesh.position[hazard.move.axis] += Math.sin(elapsed * hazard.move.speed) * hazard.move.distance;
  });
}

function movePlayer(delta) {
  const input = new THREE.Vector3();
  const forward = new THREE.Vector3(-Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));
  const right = new THREE.Vector3(-forward.z, 0, forward.x);
  if (keys.has("forward")) input.add(forward);
  if (keys.has("back")) input.sub(forward);
  if (keys.has("left")) input.sub(right);
  if (keys.has("right")) input.add(right);
  if (input.lengthSq() > 0) input.normalize();

  if (state.grounded) {
    state.coyoteTimer = 0.12;
  } else {
    state.coyoteTimer = Math.max(0, state.coyoteTimer - delta);
  }

  if (state.jumpQueued) {
    state.jumpBufferTimer = 0.1;
  } else {
    state.jumpBufferTimer = Math.max(0, state.jumpBufferTimer - delta);
  }
  state.jumpQueued = false;

  const speed = (state.grounded ? 13 : 8.5) * settings.speed;
  state.velocity.x += (input.x * speed - state.velocity.x) * Math.min(1, delta * 12);
  state.velocity.z += (input.z * speed - state.velocity.z) * Math.min(1, delta * 12);
  state.velocity.y -= 28 * delta;

  if (state.jumpBufferTimer > 0 && state.coyoteTimer > 0) {
    state.velocity.y = 11.8;
    state.grounded = false;
    state.coyoteTimer = 0;
    state.jumpBufferTimer = 0;
  }

  if (input.lengthSq() > 0) {
    player.rotation.y = Math.atan2(input.z, input.x) - Math.PI / 2;
  } else if (settings.shiftLock) {
    player.rotation.y = cameraYaw + Math.PI / 2;
  }

  player.position.x += state.velocity.x * delta;
  player.position.z += state.velocity.z * delta;
  player.position.y += state.velocity.y * delta;
  state.grounded = false;

  for (const platform of platforms) {
    const currentPlayerBox = playerBox();
    const platformBox = meshBox(platform.mesh, platform.size);
    if (!intersects(currentPlayerBox, platformBox)) continue;

    const previousBottom = player.position.y - state.velocity.y * delta;
    const platformTop = platformBox.max.y;
    if (previousBottom >= platformTop - 0.08 && state.velocity.y <= 0) {
      player.position.y = platformTop;
      state.velocity.y = 0;
      state.grounded = true;
    }
  }

  if (player.position.y < -5) resetPlayer();
}

function checkRules() {
  for (const hazard of hazards) {
    if (intersects(playerBox(), meshBox(hazard.mesh, hazard.size))) resetPlayer();
  }

  checkpoints.forEach((checkpoint) => {
    if (state.stage < checkpoint.stage && player.position.distanceTo(checkpoint.pad.position) < 2.4) {
      state.stage = checkpoint.stage;
      state.respawn.copy(checkpoint.respawn);
      checkpoint.flag.material.color.set(0x20c997);
      checkpoint.pad.material.color.set(0x20c997);
    }
  });

  coins.forEach((coin) => {
    if (!coin.collected && player.position.distanceTo(coin.mesh.position) < 1.65) {
      coin.collected = true;
      coin.mesh.visible = false;
      state.studs += 1;
    }
  });

  if (!state.finished && player.position.distanceTo(finish.position) < 3.3) {
    state.finished = true;
    message.classList.remove("hidden");
  }
}

function updateCamera(delta) {
  const compact = window.innerWidth < 760;
  const distance = settings.shiftLock ? (compact ? 8 : 9.4) : (compact ? 10 : 12);
  const height = settings.shiftLock ? (compact ? 4.5 : 5.2) : (compact ? 5.2 : 6.4);
  const target = new THREE.Vector3(
    player.position.x + Math.cos(cameraYaw) * distance,
    player.position.y + height,
    player.position.z + Math.sin(cameraYaw) * distance
  );
  camera.position.lerp(target, Math.min(1, delta * (2.6 + settings.sensitivity * 2.4)));
  const lookAhead = settings.shiftLock ? new THREE.Vector3(-Math.cos(cameraYaw) * 3.2, 0, -Math.sin(cameraYaw) * 3.2) : new THREE.Vector3(2.5, 0, 0);
  camera.lookAt(player.position.x + lookAhead.x, player.position.y + 1.45, player.position.z + lookAhead.z);
}

function updateAnimations(elapsed) {
  coins.forEach((coin, index) => {
    coin.mesh.rotation.y = elapsed * 2.4 + index;
    coin.mesh.position.y = coin.baseY + Math.sin(elapsed * 3 + index) * 0.18;
  });

  const run = Math.min(1, Math.abs(state.velocity.x) + Math.abs(state.velocity.z));
  leftArm.rotation.x = Math.sin(elapsed * 11) * 0.45 * run;
  rightArm.rotation.x = -leftArm.rotation.x;
  leftLeg.rotation.x = -leftArm.rotation.x;
  rightLeg.rotation.x = leftArm.rotation.x;
}

function updateHud() {
  stageText.textContent = `Stage ${state.stage}`;
  studsText.textContent = `Studs ${state.studs}`;
  timerText.textContent = `${((performance.now() - state.startedAt) / 1000).toFixed(1)}s`;
}

function loop(now = 0) {
  requestAnimationFrame(loop);
  const frameInterval = 1000 / settings.fpsLimit;
  if (now - lastFrameTime < frameInterval) return;

  lastFrameTime = now;
  resizeRenderer();
  const delta = Math.min(0.033, clock.getDelta());
  const elapsed = clock.elapsedTime;

  updateHazards(elapsed);
  if (!state.finished) {
    movePlayer(delta);
    checkRules();
  }
  updateAnimations(elapsed);
  updateCamera(delta);
  updateHud();
  renderer.render(scene, camera);
}

window.addEventListener("keydown", (event) => handleKeyboard(event, true));
window.addEventListener("keyup", (event) => handleKeyboard(event, false));
window.addEventListener("resize", resizeRenderer);

sensitivitySlider.addEventListener("input", () => {
  settings.sensitivity = Number(sensitivitySlider.value);
  updateSettingsText();
});

speedSlider.addEventListener("input", () => {
  settings.speed = Number(speedSlider.value);
  updateSettingsText();
});

fpsSlider.addEventListener("input", () => {
  settings.fpsLimit = Number(fpsSlider.value);
  updateSettingsText();
});

settingsButton.addEventListener("click", () => {
  setSettingsOpen(settingsPanel.classList.contains("hidden"));
});

closeSettingsButton.addEventListener("click", () => {
  setSettingsOpen(false);
});

document.querySelectorAll("[data-quality]").forEach((button) => {
  button.addEventListener("click", () => setGraphicsQuality(button.dataset.quality));
});

shadowsToggle.addEventListener("change", () => {
  settings.shadows = shadowsToggle.checked;
  renderer.shadowMap.enabled = settings.shadows;
});

shiftLockToggle.addEventListener("change", () => {
  setShiftLock(shiftLockToggle.checked);
});

mobileControlsToggle.addEventListener("change", () => {
  gamePanel.classList.toggle("force-touch", mobileControlsToggle.checked);
});

fullscreenButton.addEventListener("click", () => {
  if (!document.fullscreenElement) {
    canvasWrap.requestFullscreen?.();
    return;
  }

  document.exitFullscreen?.();
});

canvas.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" && event.button !== 0) return;

  looking = true;
  lastPointerX = event.clientX;
  canvas.setPointerCapture(event.pointerId);

  if (settings.shiftLock) {
    canvas.requestPointerLock?.();
  }
});

canvas.addEventListener("pointermove", (event) => {
  if (!looking) return;

  const pointerDelta = document.pointerLockElement === canvas ? event.movementX : event.clientX - lastPointerX;
  cameraYaw -= pointerDelta * 0.004 * settings.sensitivity;
  lastPointerX = event.clientX;
});

canvas.addEventListener("pointerup", (event) => {
  looking = false;
  canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener("pointercancel", () => {
  looking = false;
});

document.querySelectorAll("[data-control]").forEach((button) => {
  const control = button.dataset.control;
  button.addEventListener("pointerdown", () => setControl(control, true));
  button.addEventListener("pointerup", () => setControl(control, false));
  button.addEventListener("pointerleave", () => setControl(control, false));
  button.addEventListener("pointercancel", () => setControl(control, false));
});

restartButton.addEventListener("click", restartGame);
updateSettingsText();
restartGame();
requestAnimationFrame(loop);