const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const startOverlay = document.getElementById("startOverlay");
const gameOverOverlay = document.getElementById("gameOverOverlay");
const startBtn = document.getElementById("startBtn");
const restartBtn = document.getElementById("restartBtn");
const finalScore = document.getElementById("finalScore");
const timerEl = document.getElementById("timer");
const heartsEl = document.getElementById("hearts");
const joystickZone = document.getElementById("joystickZone");
const joystickStick = document.getElementById("joystickStick");
const dashBtn = document.getElementById("dashBtn");
const soundBtn = document.getElementById("soundBtn");

const WORLD = { width: canvas.width, height: canvas.height };
const MAX_HEALTH = 3;

const state = {
  mode: "start",
  elapsed: 0,
  spawnTimer: 0,
  hitFlash: 0,
  screenShake: 0,
  player: createPlayer(),
  projectiles: [],
  particles: [],
  touch: { moveX: 0, moveY: 0, dash: false },
  keys: { left: false, right: false, up: false, down: false, dash: false },
  soundEnabled: true,
};

const audio = createAudioSystem();

function createAudioSystem() {
  return {
    context: null,
    master: null,
    musicGain: null,
    ambientNoiseGain: null,
    subDroneGain: null,
    noiseBuffer: null,
    nextMusicAt: 0,
    lastBeat: -1,
    windSource: null,
    droneLfo: null,
    enabled: true,
  };
}

function ensureAudioContext() {
  if (!audio.enabled) return false;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return false;
  if (!audio.context) {
    const context = new AudioCtx();
    const master = context.createGain();
    const musicGain = context.createGain();
    const ambientNoiseGain = context.createGain();
    const subDroneGain = context.createGain();
    master.gain.value = 0.38;
    musicGain.gain.value = 0.34;
    ambientNoiseGain.gain.value = 0.1;
    subDroneGain.gain.value = 0.16;
    musicGain.connect(master);
    ambientNoiseGain.connect(master);
    subDroneGain.connect(master);
    master.connect(context.destination);
    audio.context = context;
    audio.master = master;
    audio.musicGain = musicGain;
    audio.ambientNoiseGain = ambientNoiseGain;
    audio.subDroneGain = subDroneGain;
    audio.noiseBuffer = createNoiseBuffer(context);
    startAmbientWind();
    startSubDrone();
  }
  if (audio.context.state === "suspended") {
    audio.context.resume().catch(() => {});
  }
  return true;
}

function createNoiseBuffer(context) {
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < channel.length; i += 1) {
    channel[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function startAmbientWind() {
  if (!audio.context || audio.windSource) return;
  const source = audio.context.createBufferSource();
  const filter = audio.context.createBiquadFilter();
  const lfo = audio.context.createOscillator();
  const lfoGain = audio.context.createGain();
  const wobble = audio.context.createOscillator();
  const wobbleGain = audio.context.createGain();
  source.buffer = audio.noiseBuffer;
  source.loop = true;
  filter.type = "bandpass";
  filter.frequency.value = 260;
  filter.Q.value = 0.8;
  lfo.frequency.value = 0.06;
  lfoGain.gain.value = 210;
  wobble.frequency.value = 0.19;
  wobbleGain.gain.value = 90;
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);
  wobble.connect(wobbleGain);
  wobbleGain.connect(filter.Q);
  source.connect(filter);
  filter.connect(audio.ambientNoiseGain);
  source.start();
  lfo.start();
  wobble.start();
  audio.windSource = { source, filter, lfo, lfoGain, wobble, wobbleGain };
}

function startSubDrone() {
  if (!audio.context || audio.droneLfo) return;
  const baseOsc = audio.context.createOscillator();
  const upperOsc = audio.context.createOscillator();
  const baseGain = audio.context.createGain();
  const upperGain = audio.context.createGain();
  const filter = audio.context.createBiquadFilter();
  const lfo = audio.context.createOscillator();
  const lfoGain = audio.context.createGain();

  baseOsc.type = "sawtooth";
  upperOsc.type = "triangle";
  baseOsc.frequency.value = 43;
  upperOsc.frequency.value = 61;
  baseOsc.detune.value = -14;
  upperOsc.detune.value = 9;
  baseGain.gain.value = 0.34;
  upperGain.gain.value = 0.16;
  filter.type = "lowpass";
  filter.frequency.value = 190;
  filter.Q.value = 1.2;
  lfo.frequency.value = 0.11;
  lfoGain.gain.value = 44;

  lfo.connect(lfoGain);
  lfoGain.connect(baseOsc.detune);
  lfoGain.connect(upperOsc.detune);
  baseOsc.connect(baseGain);
  upperOsc.connect(upperGain);
  baseGain.connect(filter);
  upperGain.connect(filter);
  filter.connect(audio.subDroneGain);

  baseOsc.start();
  upperOsc.start();
  lfo.start();
  audio.droneLfo = { baseOsc, upperOsc, baseGain, upperGain, filter, lfo, lfoGain };
}

function setSoundButton() {
  soundBtn.textContent = state.soundEnabled ? "聲音開" : "靜音";
  soundBtn.classList.toggle("is-muted", !state.soundEnabled);
  soundBtn.setAttribute("aria-pressed", String(!state.soundEnabled));
}

function setMasterVolume() {
  if (!audio.master || !audio.context) return;
  const now = audio.context.currentTime;
  audio.master.gain.cancelScheduledValues(now);
  audio.master.gain.setTargetAtTime(state.soundEnabled ? 0.38 : 0.0001, now, 0.08);
}

function noteToFrequency(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function playTone({
  type = "sine",
  frequency = 220,
  frequencyEnd = frequency,
  detune = 0,
  start = 0,
  duration = 0.3,
  gain = 0.1,
  attack = 0.01,
  release = 0.18,
  destination = audio.master,
}) {
  if (!ensureAudioContext() || !destination) return;
  const now = audio.context.currentTime + start;
  const osc = audio.context.createOscillator();
  const amp = audio.context.createGain();
  osc.type = type;
  osc.detune.value = detune;
  osc.frequency.setValueAtTime(frequency, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, frequencyEnd), now + duration);
  amp.gain.setValueAtTime(0.0001, now);
  amp.gain.linearRampToValueAtTime(gain, now + attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(attack + 0.01, duration + release));
  osc.connect(amp);
  amp.connect(destination);
  osc.start(now);
  osc.stop(now + duration + release + 0.05);
}

function playNoiseBurst({
  start = 0,
  duration = 0.2,
  gain = 0.06,
  lowpass = 1200,
  bandpass = 0,
}) {
  if (!ensureAudioContext()) return;
  const now = audio.context.currentTime + start;
  const source = audio.context.createBufferSource();
  const filter = audio.context.createBiquadFilter();
  const amp = audio.context.createGain();
  source.buffer = audio.noiseBuffer;
  if (bandpass > 0) {
    filter.type = "bandpass";
    filter.frequency.value = bandpass;
    filter.Q.value = 1.4;
  } else {
    filter.type = "lowpass";
    filter.frequency.value = lowpass;
  }
  amp.gain.setValueAtTime(0.0001, now);
  amp.gain.linearRampToValueAtTime(gain, now + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  source.connect(filter);
  filter.connect(amp);
  amp.connect(audio.master);
  source.start(now);
  source.stop(now + duration + 0.02);
}

function playRitualStrike({ start = 0, frequency = 780, gain = 0.08 } = {}) {
  playTone({
    type: "square",
    frequency,
    frequencyEnd: Math.max(160, frequency * 0.42),
    duration: 0.11,
    gain,
    start,
    attack: 0.002,
    release: 0.2,
  });
  playTone({
    type: "triangle",
    frequency: frequency * 0.5,
    frequencyEnd: Math.max(90, frequency * 0.2),
    duration: 0.22,
    gain: gain * 0.7,
    start: start + 0.015,
    attack: 0.003,
    release: 0.24,
    detune: -6,
  });
  playNoiseBurst({
    start,
    duration: 0.12,
    gain: gain * 0.45,
    bandpass: 1900,
  });
}

function playHitSound() {
  playTone({ type: "sawtooth", frequency: 220, frequencyEnd: 54, duration: 0.32, gain: 0.22, detune: -12 });
  playTone({ type: "square", frequency: 510, frequencyEnd: 120, duration: 0.26, gain: 0.16, start: 0.015, detune: 8 });
  playNoiseBurst({ duration: 0.24, gain: 0.18, lowpass: 820 });
  playNoiseBurst({ start: 0.03, duration: 0.18, gain: 0.11, bandpass: 410 });
  playRitualStrike({ start: 0.01, frequency: 680, gain: 0.07 });
}

function playDashSound() {
  playNoiseBurst({ duration: 0.22, gain: 0.07, bandpass: 920 });
  playTone({ type: "triangle", frequency: 220, frequencyEnd: 430, duration: 0.15, gain: 0.08 });
}

function playSpawnSound() {
  playTone({ type: "sine", frequency: 740, frequencyEnd: 500, duration: 0.18, gain: 0.06, detune: 15 });
  playTone({ type: "triangle", frequency: 266, frequencyEnd: 188, duration: 0.28, gain: 0.05, start: 0.02, detune: -10 });
  playRitualStrike({ start: 0.035, frequency: 920, gain: 0.035 });
}

function playStartSound() {
  playTone({ type: "triangle", frequency: noteToFrequency(57), frequencyEnd: noteToFrequency(61), duration: 0.24, gain: 0.1 });
  playTone({ type: "sine", frequency: noteToFrequency(64), frequencyEnd: noteToFrequency(69), duration: 0.36, gain: 0.08, start: 0.1 });
  playNoiseBurst({ start: 0.04, duration: 0.2, gain: 0.05, bandpass: 1180 });
  playRitualStrike({ start: 0.18, frequency: 840, gain: 0.06 });
}

function playGameOverSound() {
  playTone({ type: "triangle", frequency: noteToFrequency(55), frequencyEnd: noteToFrequency(47), duration: 0.45, gain: 0.12 });
  playTone({ type: "sawtooth", frequency: noteToFrequency(47), frequencyEnd: noteToFrequency(34), duration: 0.82, gain: 0.14, start: 0.06, detune: -9 });
  playTone({ type: "square", frequency: 160, frequencyEnd: 34, duration: 0.52, gain: 0.08, start: 0.1 });
  playNoiseBurst({ start: 0.1, duration: 0.42, gain: 0.08, lowpass: 540 });
  playRitualStrike({ start: 0.24, frequency: 520, gain: 0.055 });
}

function updateMusic() {
  if (state.mode !== "playing" || !ensureAudioContext()) return;
  const beat = Math.floor(state.elapsed / 0.95);
  if (beat === audio.lastBeat) return;
  audio.lastBeat = beat;
  const now = audio.context.currentTime;
  const start = Math.max(now + 0.02, audio.nextMusicAt || now);
  const scale = [41, 44, 46, 48, 51, 53];
  const root = scale[beat % scale.length];
  const tension = scale[(beat + 2) % scale.length] + (beat % 3 === 2 ? 12 : 7);
  const chant = scale[(beat + 4) % scale.length] + 12;
  playTone({
    type: "sawtooth",
    frequency: noteToFrequency(root),
    frequencyEnd: noteToFrequency(root - 5),
    duration: 1.55,
    gain: 0.09,
    start: start - now,
    destination: audio.musicGain,
    detune: beat % 2 === 0 ? -7 : 7,
  });
  playTone({
    type: "triangle",
    frequency: noteToFrequency(tension),
    frequencyEnd: noteToFrequency(tension - 7),
    duration: 1.02,
    gain: 0.075,
    start: start - now + 0.08,
    destination: audio.musicGain,
    detune: 13,
  });
  playTone({
    type: "sine",
    frequency: noteToFrequency(chant),
    frequencyEnd: noteToFrequency(chant - 9),
    duration: 0.74,
    gain: 0.06,
    start: start - now + 0.22,
    destination: audio.musicGain,
    detune: beat % 2 === 0 ? -24 : 19,
  });
  playTone({
    type: "triangle",
    frequency: noteToFrequency(root + 12),
    frequencyEnd: noteToFrequency(root + 5),
    duration: 0.42,
    gain: 0.05,
    start: start - now + 0.52,
    destination: audio.musicGain,
    detune: -8,
  });
  if (beat % 2 === 0) {
    playRitualStrike({
      start: start - now + 0.03,
      frequency: 900 - (beat % 3) * 110,
      gain: 0.05,
    });
  } else {
    playRitualStrike({
      start: start - now + 0.18,
      frequency: 620,
      gain: 0.045,
    });
    playNoiseBurst({
      start: start - now + 0.14,
      duration: 0.42,
      gain: 0.05,
      bandpass: 1280,
    });
  }
  audio.nextMusicAt = start + 0.72;
}

function createPlayer() {
  return {
    x: WORLD.width / 2,
    y: WORLD.height - 128,
    radius: 26,
    speed: 255,
    dashSpeed: 395,
    health: MAX_HEALTH,
    facing: 1,
    invulnerable: 0,
    stride: 0,
  };
}

function resetGame() {
  ensureAudioContext();
  state.mode = "playing";
  state.elapsed = 0;
  state.spawnTimer = 0;
  state.hitFlash = 0;
  state.screenShake = 0;
  state.projectiles = [];
  state.particles = [];
  state.player = createPlayer();
  state.touch.moveX = 0;
  state.touch.moveY = 0;
  state.touch.dash = false;
  state.keys.left = false;
  state.keys.right = false;
  state.keys.up = false;
  state.keys.down = false;
  state.keys.dash = false;
  audio.lastBeat = -1;
  audio.nextMusicAt = 0;
  updateHearts();
  updateTimer();
  startOverlay.classList.add("hidden");
  gameOverOverlay.classList.add("hidden");
  playStartSound();
}

function updateHearts() {
  heartsEl.innerHTML = "";
  for (let i = 0; i < MAX_HEALTH; i += 1) {
    const heart = document.createElement("div");
    heart.className = `heart${i >= state.player.health ? " lost" : ""}`;
    heartsEl.appendChild(heart);
  }
}

function updateTimer() {
  timerEl.textContent = `${state.elapsed.toFixed(1)} 秒`;
}

function getDifficulty() {
  return 1 + state.elapsed * 0.055;
}

function spawnGhostBall() {
  const edge = Math.floor(Math.random() * 4);
  const spawnPad = 60;
  let x = WORLD.width / 2;
  let y = WORLD.height / 2;
  if (edge === 0) {
    x = -spawnPad;
    y = Math.random() * WORLD.height * 0.72 + 40;
  } else if (edge === 1) {
    x = WORLD.width + spawnPad;
    y = Math.random() * WORLD.height * 0.72 + 40;
  } else if (edge === 2) {
    x = Math.random() * WORLD.width;
    y = -spawnPad;
  } else {
    x = Math.random() * WORLD.width;
    y = WORLD.height * 0.64 + Math.random() * WORLD.height * 0.18;
  }

  const player = state.player;
  const dx = player.x - x;
  const dy = player.y - y;
  const length = Math.hypot(dx, dy) || 1;
  const difficulty = getDifficulty();
  const speed = 110 + difficulty * 22 + Math.random() * 38;
  state.projectiles.push({
    x,
    y,
    vx: (dx / length) * speed,
    vy: (dy / length) * speed,
    radius: 18 + Math.random() * 6,
    phase: Math.random() * Math.PI * 2,
    rotation: Math.random() * Math.PI * 2,
  });
  if (Math.random() < 0.65) playSpawnSound();
}

function emitImpact(x, y, count, hue) {
  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
    const speed = 30 + Math.random() * 80;
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.3 + Math.random() * 0.35,
      hue,
      size: 2 + Math.random() * 5,
    });
  }
}

function hitPlayer(projectile) {
  if (state.player.invulnerable > 0 || state.mode !== "playing") return;
  playHitSound();
  state.player.health -= 1;
  state.player.invulnerable = 1.2;
  state.hitFlash = 0.28;
  state.screenShake = 10;
  emitImpact(projectile.x, projectile.y, 16, 12);
  updateHearts();
  if (state.player.health <= 0) {
    state.mode = "gameover";
    playGameOverSound();
    finalScore.textContent = `你撐了 ${state.elapsed.toFixed(1)} 秒`;
    gameOverOverlay.classList.remove("hidden");
  }
}

function updatePlayer(dt) {
  const player = state.player;
  const keyX = (state.keys.right ? 1 : 0) - (state.keys.left ? 1 : 0);
  const keyY = (state.keys.down ? 1 : 0) - (state.keys.up ? 1 : 0);
  const inputX = Math.abs(state.touch.moveX) > 0.02 ? state.touch.moveX : keyX;
  const inputY = Math.abs(state.touch.moveY) > 0.02 ? state.touch.moveY : keyY;
  const magnitude = Math.hypot(inputX, inputY);
  if (magnitude > 0.08) {
    const nx = inputX / magnitude;
    const ny = inputY / magnitude;
    const speed = state.touch.dash || state.keys.dash ? player.dashSpeed : player.speed;
    player.x += nx * speed * dt;
    player.y += ny * speed * dt;
    player.facing = nx < -0.02 ? -1 : nx > 0.02 ? 1 : player.facing;
    player.stride += dt * (state.touch.dash ? 14 : 9);
  }

  const pad = player.radius + 18;
  player.x = Math.max(pad, Math.min(WORLD.width - pad, player.x));
  player.y = Math.max(110, Math.min(WORLD.height - 40, player.y));
  player.invulnerable = Math.max(0, player.invulnerable - dt);
}

function updateProjectiles(dt) {
  const difficulty = getDifficulty();
  state.spawnTimer -= dt;
  const spawnDelay = Math.max(0.26, 1.18 - difficulty * 0.08);
  if (state.spawnTimer <= 0) {
    spawnGhostBall();
    if (difficulty > 4 && Math.random() < 0.45) spawnGhostBall();
    state.spawnTimer = spawnDelay;
  }

  const player = state.player;
  state.projectiles = state.projectiles.filter((ball) => {
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.phase += dt * 7;
    ball.rotation += dt * 3;

    const dist = Math.hypot(ball.x - player.x, ball.y - player.y);
    if (dist < ball.radius + player.radius - 6) {
      hitPlayer(ball);
      return false;
    }

    return (
      ball.x > -120 &&
      ball.x < WORLD.width + 120 &&
      ball.y > -120 &&
      ball.y < WORLD.height + 120
    );
  });
}

function updateParticles(dt) {
  state.particles = state.particles.filter((particle) => {
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vx *= 0.98;
    particle.vy *= 0.98;
    particle.life -= dt;
    return particle.life > 0;
  });
}

function update(dt) {
  if (state.mode !== "playing") return;
  state.elapsed += dt;
  state.hitFlash = Math.max(0, state.hitFlash - dt);
  state.screenShake = Math.max(0, state.screenShake - 22 * dt);
  updateTimer();
  updatePlayer(dt);
  updateProjectiles(dt);
  updateParticles(dt);
  updateMusic();
}

function drawBackground() {
  const bg = ctx.createLinearGradient(0, 0, 0, WORLD.height);
  bg.addColorStop(0, "#24112a");
  bg.addColorStop(0.38, "#173a5b");
  bg.addColorStop(1, "#0b141e");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);

  const moon = ctx.createRadialGradient(WORLD.width * 0.5, 96, 12, WORLD.width * 0.5, 96, 180);
  moon.addColorStop(0, "rgba(255, 229, 197, 0.92)");
  moon.addColorStop(0.24, "rgba(255, 184, 138, 0.3)");
  moon.addColorStop(1, "rgba(255, 184, 138, 0)");
  ctx.fillStyle = moon;
  ctx.beginPath();
  ctx.arc(WORLD.width * 0.5, 96, 180, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < 6; i += 1) {
    const x = 28 + i * 72;
    const alpha = 0.18 + (i % 2) * 0.09;
    ctx.fillStyle = `rgba(255, 150, 107, ${alpha})`;
    ctx.fillRect(x, WORLD.height - 200 - (i % 3) * 24, 38, 150 + (i % 3) * 20);
    ctx.fillStyle = "rgba(255, 231, 191, 0.06)";
    ctx.fillRect(x + 8, WORLD.height - 182 - (i % 3) * 24, 6, 12);
    ctx.fillRect(x + 22, WORLD.height - 144 - (i % 3) * 24, 6, 12);
  }

  const ground = ctx.createLinearGradient(0, WORLD.height - 180, 0, WORLD.height);
  ground.addColorStop(0, "rgba(27, 33, 42, 0.15)");
  ground.addColorStop(1, "rgba(10, 11, 15, 0.9)");
  ctx.fillStyle = ground;
  ctx.fillRect(0, WORLD.height - 148, WORLD.width, 148);

  for (let i = 0; i < 3; i += 1) {
    const shrineX = 44 + i * 124;
    ctx.fillStyle = "rgba(48, 23, 28, 0.92)";
    ctx.fillRect(shrineX, WORLD.height - 162, 74, 80);
    ctx.fillStyle = "rgba(255, 196, 137, 0.22)";
    ctx.fillRect(shrineX + 16, WORLD.height - 134, 12, 28);
    ctx.fillRect(shrineX + 44, WORLD.height - 134, 12, 28);
    ctx.strokeStyle = "rgba(255, 185, 122, 0.22)";
    ctx.lineWidth = 2;
    ctx.strokeRect(shrineX, WORLD.height - 162, 74, 80);

    const lantern = ctx.createRadialGradient(
      shrineX + 37,
      WORLD.height - 120,
      6,
      shrineX + 37,
      WORLD.height - 120,
      40,
    );
    lantern.addColorStop(0, "rgba(255, 223, 166, 0.78)");
    lantern.addColorStop(0.45, "rgba(255, 124, 72, 0.24)");
    lantern.addColorStop(1, "rgba(255, 124, 72, 0)");
    ctx.fillStyle = lantern;
    ctx.beginPath();
    ctx.arc(shrineX + 37, WORLD.height - 120, 40, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 24; i += 1) {
    const px = (i * 41 + state.elapsed * 12) % (WORLD.width + 80) - 40;
    const py = 90 + ((i * 37) % 460);
    const radius = 18 + ((i * 13) % 16);
    const mist = ctx.createRadialGradient(px, py, 0, px, py, radius);
    mist.addColorStop(0, "rgba(162, 255, 250, 0.08)");
    mist.addColorStop(1, "rgba(162, 255, 250, 0)");
    ctx.fillStyle = mist;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 4; i += 1) {
    const x = 34 + i * 102 + Math.sin(state.elapsed * 0.7 + i) * 8;
    const y = 154 + i * 86;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(state.elapsed + i) * 0.08);
    ctx.fillStyle = "rgba(252, 235, 196, 0.72)";
    ctx.fillRect(-10, -18, 20, 36);
    ctx.fillStyle = "rgba(208, 52, 34, 0.8)";
    ctx.fillRect(-2, -10, 4, 18);
    ctx.restore();
  }
}

function drawPlayer() {
  const player = state.player;
  ctx.save();
  ctx.translate(player.x, player.y);
  if (player.invulnerable > 0 && Math.floor(player.invulnerable * 10) % 2 === 0) {
    ctx.globalAlpha = 0.5;
  }

  const aura = ctx.createRadialGradient(0, 10, 14, 0, 10, 52);
  aura.addColorStop(0, "rgba(255, 238, 197, 0.18)");
  aura.addColorStop(1, "rgba(255, 238, 197, 0)");
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(0, 10, 52, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#2a201d";
  ctx.beginPath();
  ctx.ellipse(0, 58, 38, 11, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#e6b98a";
  ctx.beginPath();
  ctx.arc(0, -34, 18, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#111417";
  ctx.beginPath();
  ctx.arc(-5, -38, 19, Math.PI * 0.95, Math.PI * 1.95);
  ctx.fill();
  ctx.fillRect(-18, -38, 36, 8);

  ctx.fillStyle = "#f4efe4";
  ctx.beginPath();
  ctx.moveTo(0, -18);
  ctx.lineTo(-22, 18);
  ctx.lineTo(22, 18);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#1f3356";
  ctx.fillRect(-18, 16, 36, 38);

  const stride = Math.sin(player.stride) * 5;
  ctx.strokeStyle = "#15233e";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-8, 54);
  ctx.lineTo(-11 - stride, 82);
  ctx.moveTo(8, 54);
  ctx.lineTo(11 + stride, 82);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-20, -2);
  ctx.lineTo(-36 - stride * 0.4, 28);
  ctx.moveTo(20, -2);
  ctx.lineTo(36 + stride * 0.4, 24);
  ctx.stroke();

  ctx.fillStyle = "#f6eadb";
  ctx.fillRect(-8, -6, 16, 30);
  ctx.fillStyle = "#f7c645";
  ctx.fillRect(-7, -2, 14, 5);

  ctx.fillStyle = "#1a1311";
  ctx.beginPath();
  ctx.arc(-5, -34, 2.3, 0, Math.PI * 2);
  ctx.arc(5, -34, 2.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#744b37";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, -28, 4.5, 0.1, Math.PI - 0.1);
  ctx.stroke();
  ctx.restore();
}

function drawGhostBall(ball) {
  ctx.save();
  ctx.translate(ball.x, ball.y);
  ctx.rotate(Math.sin(ball.rotation) * 0.12);

  const glow = ctx.createRadialGradient(0, 0, 8, 0, 0, ball.radius * 2.2);
  glow.addColorStop(0, "rgba(225, 255, 252, 0.7)");
  glow.addColorStop(0.4, "rgba(121, 255, 241, 0.32)");
  glow.addColorStop(1, "rgba(121, 255, 241, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, ball.radius * 2.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#e9ffff";
  ctx.beginPath();
  ctx.arc(0, -6, ball.radius * 0.74, Math.PI, 0);
  ctx.quadraticCurveTo(ball.radius * 0.76, ball.radius * 0.46, ball.radius * 0.34, ball.radius * 1.18);
  ctx.quadraticCurveTo(0, ball.radius * 0.62 + Math.sin(ball.phase) * 5, -ball.radius * 0.34, ball.radius * 1.18);
  ctx.quadraticCurveTo(-ball.radius * 0.74, ball.radius * 0.44, -ball.radius * 0.74, -6);
  ctx.fill();

  ctx.strokeStyle = "rgba(129, 255, 242, 0.8)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "#13223d";
  ctx.beginPath();
  ctx.arc(-ball.radius * 0.23, -8, 2.8, 0, Math.PI * 2);
  ctx.arc(ball.radius * 0.23, -8, 2.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#13223d";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, -2, 5, 0.2, Math.PI - 0.2);
  ctx.stroke();

  ctx.fillStyle = "#ffdf7e";
  ctx.fillRect(-5, -ball.radius * 1.1, 10, 20);
  ctx.fillStyle = "#ff6d4b";
  ctx.fillRect(-3, -ball.radius * 0.92, 6, 3);
  ctx.restore();
}

function drawParticles() {
  for (const particle of state.particles) {
    ctx.fillStyle = `hsla(${particle.hue}, 95%, 68%, ${particle.life})`;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawDifficultyAura() {
  const difficulty = getDifficulty();
  const aura = Math.min(0.34, difficulty * 0.032);
  ctx.fillStyle = `rgba(255, 73, 36, ${aura})`;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);
}

function render() {
  ctx.save();
  ctx.clearRect(0, 0, WORLD.width, WORLD.height);
  const shake = state.screenShake;
  if (shake > 0) {
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  }
  drawBackground();
  drawDifficultyAura();
  for (const ball of state.projectiles) drawGhostBall(ball);
  drawParticles();
  drawPlayer();
  if (state.hitFlash > 0) {
    ctx.fillStyle = `rgba(255, 236, 220, ${state.hitFlash})`;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
  }
  ctx.restore();
}

function loop(timestamp) {
  if (!loop.last) loop.last = timestamp;
  const dt = Math.min(0.033, (timestamp - loop.last) / 1000);
  loop.last = timestamp;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

function setJoystickPosition(offsetX, offsetY) {
  joystickStick.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
}

function updateJoystick(clientX, clientY) {
  const rect = joystickZone.getBoundingClientRect();
  const stickSize = joystickStick.getBoundingClientRect().width;
  const maxDistance = Math.max(24, (rect.width - stickSize) / 2);
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const center = { x: rect.width / 2, y: rect.height / 2 };
  const dx = localX - center.x;
  const dy = localY - center.y;
  const distance = Math.min(maxDistance, Math.hypot(dx, dy));
  const angle = Math.atan2(dy, dx);
  const norm = distance / maxDistance;
  state.touch.moveX = Math.cos(angle) * norm;
  state.touch.moveY = Math.sin(angle) * norm;
  setJoystickPosition(Math.cos(angle) * distance, Math.sin(angle) * distance);
}

function resetJoystick() {
  state.touch.moveX = 0;
  state.touch.moveY = 0;
  joystickStick.style.transform = "translate(0px, 0px)";
}

function bindControls() {
  joystickZone.addEventListener("pointerdown", (event) => {
    joystickZone.setPointerCapture(event.pointerId);
    updateJoystick(event.clientX, event.clientY);
  });

  joystickZone.addEventListener("pointermove", (event) => {
    if (event.pressure === 0 && event.buttons === 0) return;
    updateJoystick(event.clientX, event.clientY);
  });

  joystickZone.addEventListener("pointerup", resetJoystick);
  joystickZone.addEventListener("pointercancel", resetJoystick);

  const setDash = (active) => {
    state.touch.dash = active;
    dashBtn.classList.toggle("active", active);
    if (active && state.mode === "playing") playDashSound();
  };

  dashBtn.addEventListener("pointerdown", (event) => {
    dashBtn.setPointerCapture(event.pointerId);
    setDash(true);
  });
  dashBtn.addEventListener("pointerup", () => setDash(false));
  dashBtn.addEventListener("pointercancel", () => setDash(false));

  window.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "a") state.keys.left = true;
    if (event.key === "ArrowRight" || event.key === "d") state.keys.right = true;
    if (event.key === "ArrowUp" || event.key === "w") state.keys.up = true;
    if (event.key === "ArrowDown" || event.key === "s") state.keys.down = true;
    if ((event.key === " " || event.key === "Shift") && !state.keys.dash && state.mode === "playing") {
      playDashSound();
    }
    if (event.key === " " || event.key === "Shift") state.keys.dash = true;
  });

  window.addEventListener("keyup", (event) => {
    if (event.key === "ArrowLeft" || event.key === "a") state.keys.left = false;
    if (event.key === "ArrowRight" || event.key === "d") state.keys.right = false;
    if (event.key === "ArrowUp" || event.key === "w") state.keys.up = false;
    if (event.key === "ArrowDown" || event.key === "s") state.keys.down = false;
    if (event.key === " " || event.key === "Shift") state.keys.dash = false;
  });

  soundBtn.addEventListener("click", async () => {
    state.soundEnabled = !state.soundEnabled;
    audio.enabled = state.soundEnabled;
    if (state.soundEnabled) ensureAudioContext();
    setMasterVolume();
    setSoundButton();
  });
}

function renderGameToText() {
  return JSON.stringify({
    coordinateSystem: {
      origin: "top-left",
      xDirection: "right",
      yDirection: "down",
    },
    mode: state.mode,
    soundEnabled: state.soundEnabled,
    elapsed: Number(state.elapsed.toFixed(2)),
    difficulty: Number(getDifficulty().toFixed(2)),
    player: {
      x: Number(state.player.x.toFixed(1)),
      y: Number(state.player.y.toFixed(1)),
      health: state.player.health,
      invulnerable: Number(state.player.invulnerable.toFixed(2)),
    },
    ghostBalls: state.projectiles.slice(0, 8).map((ball) => ({
      x: Number(ball.x.toFixed(1)),
      y: Number(ball.y.toFixed(1)),
      vx: Number(ball.vx.toFixed(1)),
      vy: Number(ball.vy.toFixed(1)),
      r: Number(ball.radius.toFixed(1)),
    })),
  });
}

startBtn.addEventListener("click", resetGame);
restartBtn.addEventListener("click", resetGame);

window.render_game_to_text = renderGameToText;
window.advanceTime = (ms) => {
  const steps = Math.max(1, Math.round(ms / (1000 / 60)));
  for (let i = 0; i < steps; i += 1) update(1 / 60);
  render();
};

bindControls();
updateHearts();
setSoundButton();
render();
requestAnimationFrame(loop);
