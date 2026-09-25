const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const startScreen = document.getElementById('startScreen');
const startButton = document.getElementById('startButton');
const stageTitle = document.getElementById('stageTitle');
const objectiveText = document.getElementById('objectiveText');
const messageBox = document.getElementById('messageBox');
const keypadOverlay = document.getElementById('keypadOverlay');
const keypadDisplay = document.getElementById('keypadDisplay');

const controls = {
  left: false,
  right: false,
  action: false,
};

const game = {
  stageIndex: 0,
  stage: null,
  cameraX: 0,
  inventory: {
    plank: false,
    key: false,
  },
  player: {
    x: 100,
    y: 0,
    w: 40,
    h: 64,
    speed: 3.7,
    vx: 0,
    facing: 1,
    walkCycle: 0,
    grounded: true,
    bob: 0,
    inFinale: false,
  },
  lastMessageTime: 0,
  keypadInput: '',
  started: false,
  activePrompt: null,
  finalTransition: 0,
  finalClimaxReady: false,
  audio: {
    ctx: null,
    master: null,
    ambient: null,
    ambientGain: null,
    started: false,
    gateOpen: false,
  },
  stageProgress: {
    sawBook: false,
    bridgeFixed: false,
    fusesOn: 0,
  },
};

const stageDefinitions = [
  {
    name: 'The Whispering Woods',
    width: 2300,
    groundY: 620,
    objective: 'Find the wooden plank, unlock the rusted iron door, and keep walking into the light.',
    clue: 'The path is broken. Search the crate for a plank and the birdcage for a key.',
    doorX: 2140,
    doorWidth: 72,
    doorHeight: 120,
    bridgeX: 1050,
    bridgeLength: 220,
    pickups: [
      { id: 'plank', type: 'pickup', x: 520, y: 542, width: 64, height: 36, label: 'Wooden Plank', onPickup: () => { game.inventory.plank = true; showMessage('You found a Wooden Plank.'); } },
      { id: 'key', type: 'pickup', x: 1630, y: 540, width: 34, height: 52, label: 'Rusty Key', onPickup: () => { game.inventory.key = true; showMessage('You found a Rusty Key.'); } },
    ],
    interactables: [
      { id: 'crate', type: 'crate', x: 520, y: 548, width: 120, height: 72, label: 'Abandoned Crate' },
      { id: 'birdcage', type: 'birdcage', x: 1615, y: 500, width: 90, height: 120, label: 'Birdcage' },
      { id: 'bridge', type: 'bridge', x: 1050, y: 570, width: 220, height: 34, label: 'Broken bridge', needs: 'plank' },
    ],
  },
  {
    name: 'The Abandoned Manor',
    width: 2300,
    groundY: 620,
    objective: 'Find and switch on all 3 fuses to restore the manor gate.',
    clue: 'The gate is dead. The hallway hums with three broken switches.',
    doorX: 2140,
    doorWidth: 90,
    doorHeight: 130,
    switches: [
      { id: 'f1', x: 420, y: 430, width: 28, height: 52, active: false },
      { id: 'f2', x: 1080, y: 430, width: 28, height: 52, active: false },
      { id: 'f3', x: 1820, y: 430, width: 28, height: 52, active: false },
    ],
    interactables: [
      { id: 'gate', type: 'gate', x: 2140, y: 500, width: 70, height: 120, label: 'Iron Gate' },
    ],
  },
  {
    name: 'The Forgotten Library',
    width: 2300,
    groundY: 620,
    objective: 'Find the clue in the open book and unlock the library vault door with the code 29.',
    clue: 'The book reveals the answer: Ammu\'s most special day of September...',
    doorX: 2130,
    doorWidth: 86,
    doorHeight: 128,
    interactables: [
      { id: 'book', type: 'book', x: 760, y: 540, width: 120, height: 70, label: 'Open Book' },
      { id: 'door', type: 'door', x: 2130, y: 500, width: 86, height: 120, label: 'Vault Door' },
    ],
  },
  {
    name: 'The Cavern & The Final Door',
    width: 2400,
    groundY: 620,
    objective: 'Sprint to the glowing golden gate and press E to reveal the birthday surprise.',
    clue: 'The darkness is almost over. One last door stands ahead.',
    doorX: 2260,
    doorWidth: 90,
    doorHeight: 150,
    interactables: [
      { id: 'finalDoor', type: 'finalDoor', x: 2260, y: 470, width: 90, height: 150, label: 'Golden Gate' },
    ],
  },
];

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * ratio);
  canvas.height = Math.floor(window.innerHeight * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function setMessage(text, duration = 1800) {
  messageBox.textContent = text;
  messageBox.classList.add('visible');
  game.lastMessageTime = performance.now() + duration;
}

function showMessage(text, duration = 1800) {
  setMessage(text, duration);
}

function hideMessage() {
  messageBox.classList.remove('visible');
}

function updateMessage() {
  if (performance.now() > game.lastMessageTime) {
    hideMessage();
  }
}

function initAudio() {
  if (game.audio.started) {
    return;
  }

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    return;
  }

  const ctxAudio = new AudioCtx();
  const master = ctxAudio.createGain();
  master.gain.value = 0.06;
  master.connect(ctxAudio.destination);

  const droneGain = ctxAudio.createGain();
  droneGain.gain.value = 0.0001;
  droneGain.connect(master);

  const droneOsc = ctxAudio.createOscillator();
  droneOsc.type = 'sine';
  droneOsc.frequency.value = 42;
  droneOsc.connect(droneGain);
  droneOsc.start();

  const filter = ctxAudio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 260;
  filter.Q.value = 0.4;
  droneOsc.connect(filter);
  filter.connect(droneGain);

  game.audio = { ctx: ctxAudio, master, ambient: droneOsc, ambientGain: droneGain, gateOpen: false, started: true };
}

function playTone({ frequency = 220, duration = 0.12, type = 'triangle', gain = 0.09, sweep = 0 }) {
  const { ctx, master } = game.audio;
  if (!ctx || !master) {
    return;
  }

  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  const now = ctx.currentTime;

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, now);
  if (sweep) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, frequency + sweep), now + duration);
  }

  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0006, gain), now + 0.03);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration + 0.05);

  osc.connect(gainNode).connect(master);
  osc.start(now);
  osc.stop(now + duration + 0.08);
}

function playFootstep() {
  if (!game.audio.ctx) {
    return;
  }
  playTone({ frequency: 150 + Math.random() * 35, duration: 0.09, type: 'sine', gain: 0.022, sweep: 18 });
}

function playPickup() {
  if (!game.audio.ctx) {
    return;
  }
  playTone({ frequency: 330, duration: 0.16, type: 'triangle', gain: 0.04, sweep: 60 });
  setTimeout(() => playTone({ frequency: 440, duration: 0.12, type: 'triangle', gain: 0.035, sweep: 70 }), 90);
}

function playDoor() {
  if (!game.audio.ctx) {
    return;
  }
  playTone({ frequency: 140, duration: 0.32, type: 'sine', gain: 0.04, sweep: -30 });
  setTimeout(() => playTone({ frequency: 110, duration: 0.22, type: 'sine', gain: 0.028, sweep: -20 }), 110);
}

function playSwitch() {
  if (!game.audio.ctx) {
    return;
  }
  playTone({ frequency: 540, duration: 0.14, type: 'triangle', gain: 0.03, sweep: 90 });
  setTimeout(() => playTone({ frequency: 640, duration: 0.16, type: 'triangle', gain: 0.025, sweep: 80 }), 90);
}

function playFinalChime() {
  const { ctx, master } = game.audio;
  if (!ctx || !master) {
    return;
  }

  const notes = [392, 523.25, 659.25, 784, 659.25, 523.25];
  notes.forEach((note, index) => {
    setTimeout(() => {
      playTone({ frequency: note, duration: 0.34, type: 'triangle', gain: 0.06, sweep: 25 });
    }, index * 200);
  });
}

function updateAmbientMusic() {
  if (!game.audio.ctx || !game.audio.ambient) {
    return;
  }

  const desired = !game.finalClimaxReady ? 0.016 : 0.0001;
  game.audio.ambientGain.gain.setTargetAtTime(desired, game.audio.ctx.currentTime, 0.7);

  if (game.finalClimaxReady) {
    if (!game.audio.gateOpen) {
      game.audio.gateOpen = true;
      playFinalChime();
    }
  }
}

function startJourney() {
  initAudio();
  if (game.audio.ctx && game.audio.ctx.state === 'suspended') {
    game.audio.ctx.resume();
  }

  game.started = true;
  startScreen.classList.add('hidden');
  showMessage('The journey begins...', 1200);
  if (game.stage) {
    updateObjective();
  }
}

function bindControls() {
  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();

    if (key === ' ' || event.code === 'Space') {
      event.preventDefault();
      if (game.started && !keypadOverlay.classList.contains('hidden')) {
        handleKeypadSubmit();
      } else {
        handleAction();
      }
      return;
    }

    if (key === 'a' || key === 'arrowleft') {
      controls.left = true;
    }
    if (key === 'd' || key === 'arrowright') {
      controls.right = true;
    }
    if (key === 'e') {
      handleAction();
    }

    if (!keypadOverlay.classList.contains('hidden')) {
      if (/^[0-9]$/.test(event.key)) {
        appendKeypadValue(event.key);
      } else if (event.key === 'Backspace') {
        clearKeypadValue();
      } else if (event.key === 'Enter') {
        handleKeypadSubmit();
      }
    }
  });

  window.addEventListener('keyup', (event) => {
    const key = event.key.toLowerCase();
    if (key === 'a' || key === 'arrowleft') controls.left = false;
    if (key === 'd' || key === 'arrowright') controls.right = false;
  });

  document.getElementById('leftButton').addEventListener('pointerdown', () => {
    controls.left = true;
  });
  document.getElementById('leftButton').addEventListener('pointerup', () => {
    controls.left = false;
  });
  document.getElementById('leftButton').addEventListener('pointerleave', () => {
    controls.left = false;
  });

  document.getElementById('rightButton').addEventListener('pointerdown', () => {
    controls.right = true;
  });
  document.getElementById('rightButton').addEventListener('pointerup', () => {
    controls.right = false;
  });
  document.getElementById('rightButton').addEventListener('pointerleave', () => {
    controls.right = false;
  });

  document.getElementById('actionButton').addEventListener('pointerdown', () => {
    handleAction();
  });

  document.querySelectorAll('.digit').forEach((button) => {
    button.addEventListener('click', () => appendKeypadValue(button.textContent));
  });

  document.querySelector('.clear-btn').addEventListener('click', clearKeypadValue);
  document.querySelector('.enter-btn').addEventListener('click', handleKeypadSubmit);

  startButton.addEventListener('click', startJourney);

  window.addEventListener('resize', resizeCanvas);
}

function appendKeypadValue(value) {
  if (game.keypadInput.length >= 2) {
    return;
  }
  game.keypadInput += value;
  updateKeypadDisplay();
}

function clearKeypadValue() {
  game.keypadInput = '';
  updateKeypadDisplay();
}

function updateKeypadDisplay() {
  const displayText = game.keypadInput.padEnd(2, '_');
  keypadDisplay.textContent = `${displayText[0]} ${displayText[1]}`;
}

function handleKeypadSubmit() {
  if (!keypadOverlay.classList.contains('hidden')) {
    if (game.keypadInput === '29') {
      showMessage('The vault door unlocks with a click.', 1400);
      playDoor();
      keypadOverlay.classList.add('hidden');
      game.stageIndex = 3;
      loadStage(3);
      return;
    }

    showMessage('Incorrect code. The clue mentions September 29.', 1800);
    clearKeypadValue();
  }
}

function loadStage(index) {
  game.stageIndex = index;
  const stage = stageDefinitions[index];
  game.stage = stage;
  game.player.x = 110;
  game.player.y = stage.groundY - game.player.h;
  game.cameraX = 0;
  game.finalTransition = 0;
  game.finalClimaxReady = false;
  game.activePrompt = null;

  if (index === 0) {
    game.inventory.plank = false;
    game.inventory.key = false;
    game.stageProgress.bridgeFixed = false;
    game.stageProgress.sawBook = false;
    clearKeypadValue();
  }

  if (index === 2) {
    game.stageProgress.sawBook = false;
    clearKeypadValue();
  }

  if (index === 1) {
    game.stageProgress.fusesOn = 0;
    stage.switches.forEach((switchItem) => {
      switchItem.active = false;
    });
  }

  stageTitle.textContent = `Stage ${index + 1}: ${stage.name}`;
  objectiveText.textContent = stage.objective;
  showMessage(stage.clue, 1500);
}

function updateObjective() {
  const stage = game.stage;
  if (!stage) return;

  if (game.stageIndex === 0) {
    if (!game.inventory.plank) objectiveText.textContent = 'Search the crate for a Wooden Plank and fix the broken bridge.';
    else if (!game.stageProgress.bridgeFixed) objectiveText.textContent = 'The bridge has a gap. Interact with it to fix the crossing.';
    else if (!game.inventory.key) objectiveText.textContent = 'The bridge is fixed. Find the Rusty Key in the birdcage.';
    else objectiveText.textContent = 'Use the key on the iron door at the far end of the woods.';
  }

  if (game.stageIndex === 1) {
    const remaining = 3 - game.stageProgress.fusesOn;
    objectiveText.textContent = remaining > 0 ? `Find and flip the remaining ${remaining} fuse switch${remaining > 1 ? 'es' : ''}.` : 'The gate is powered. Move to the exit.';
  }

  if (game.stageIndex === 2) {
    objectiveText.textContent = game.stageProgress.sawBook ? 'The clue says September 29. Enter the code to unlock the vault door.' : 'Open the book for a clue and then unlock the vault.';
  }

  if (game.stageIndex === 3) {
    objectiveText.textContent = 'Rush to the golden gate and press E when you reach it.';
  }
}

function isNear(x, y, width, height) {
  return Math.abs(game.player.x + game.player.w / 2 - (x + width / 2)) < 90 &&
    Math.abs((game.player.y + game.player.h / 2) - (y + height / 2)) < 150;
}

function handleAction() {
  if (!game.started || !game.stage) {
    return;
  }

  if (game.stageIndex === 0) {
    const crate = { x: 520, y: 548, width: 120, height: 72 };
    const birdcage = { x: 1615, y: 500, width: 90, height: 120 };
    const bridge = { x: 1050, y: 570, width: 220, height: 34 };

    if (isNear(crate.x, crate.y, crate.width, crate.height)) {
      if (!game.inventory.plank) {
        game.inventory.plank = true;
        playPickup();
        showMessage('You found a Wooden Plank.', 1400);
      } else {
        showMessage('You already took the plank.', 1200);
      }
      updateObjective();
      return;
    }

    if (isNear(birdcage.x, birdcage.y, birdcage.width, birdcage.height)) {
      if (!game.inventory.key) {
        game.inventory.key = true;
        playPickup();
        showMessage('A Rusty Key drops from the birdcage.', 1400);
      } else {
        showMessage('The birdcage is empty now.', 1200);
      }
      updateObjective();
      return;
    }

    if (isNear(bridge.x, bridge.y, bridge.width, bridge.height)) {
      if (!game.inventory.plank) {
        showMessage('The bridge is broken. Maybe there is something useful nearby.', 1400);
      } else {
        game.stageProgress.bridgeFixed = true;
        playDoor();
        showMessage('The bridge is fixed. You can cross safely.', 1400);
      }
      updateObjective();
      return;
    }

    if (isNear(2140, 500, 72, 120)) {
      if (!game.inventory.key) {
        showMessage('The iron door needs a Rusty Key.', 1400);
      } else {
        showMessage('The iron door swings open. The woods fade behind you!', 1500);
        playDoor();
        game.stageIndex = 1;
        loadStage(1);
      }
      return;
    }
  }

  if (game.stageIndex === 1) {
    const gateX = 2140;
    const switches = game.stage.switches;
    let nearbySwitch = null;

    for (const sw of switches) {
      if (isNear(sw.x, sw.y, sw.width, sw.height)) {
        nearbySwitch = sw;
        break;
      }
    }

    if (nearbySwitch) {
      if (!nearbySwitch.active) {
        nearbySwitch.active = true;
        game.stageProgress.fusesOn += 1;
        playSwitch();
        showMessage('Fuse restored. Power returns to the gate.', 1200);
      } else {
        showMessage('This fuse is already glowing.', 900);
      }
      updateObjective();
      return;
    }

    if (isNear(gateX, 500, 90, 130)) {
      if (game.stageProgress.fusesOn < 3) {
        showMessage('The gate is still powered down. Turn on all 3 fuses first.', 1500);
      } else {
        showMessage('The gate unlocks with a hiss. The manor doors give way.', 1600);
        playDoor();
        game.stageIndex = 2;
        loadStage(2);
      }
      return;
    }
  }

  if (game.stageIndex === 2) {
    const book = { x: 760, y: 540, width: 120, height: 70 };
    const door = { x: 2130, y: 500, width: 86, height: 120 };

    if (isNear(book.x, book.y, book.width, book.height)) {
      game.stageProgress.sawBook = true;
      showMessage('Open book: "Ammu\'s most special day of September..."', 2200);
      updateObjective();
      return;
    }

    if (isNear(door.x, door.y, door.width, door.height)) {
      if (!game.stageProgress.sawBook) {
        showMessage('The vault door hums quietly. There must be a clue nearby.', 1400);
      } else {
        keypadOverlay.classList.remove('hidden');
        game.keypadInput = '';
        updateKeypadDisplay();
        showMessage('Enter the 2-digit vault code.', 1000);
      }
      return;
    }
  }

  if (game.stageIndex === 3) {
    const finalDoor = { x: 2260, y: 470, width: 90, height: 150 };
    if (isNear(finalDoor.x, finalDoor.y, finalDoor.width, finalDoor.height)) {
      triggerFinale();
    } else {
      showMessage('The golden gate is still ahead.', 900);
    }
  }
}

function triggerFinale() {
  game.finalClimaxReady = true;
  game.player.inFinale = true;
  game.finalTransition = 1;
  setTimeout(() => {
    showMessage('A warm light breaks through the darkness...', 2200);
    playFinalChime();
  }, 300);
}

function createPlayerSprite() {
  const p = game.player;
  const phase = Math.sin(p.walkCycle * 1.6) * 5;
  const walkSwing = Math.sin(p.walkCycle * 2.2) * 4;

  ctx.save();
  ctx.translate(p.x - game.cameraX, p.y);

  if (p.facing < 0) {
    ctx.scale(-1, 1);
    ctx.translate(-p.w, 0);
  }

  const glow = ctx.createRadialGradient(24, 18, 6, 24, 18, 30);
  glow.addColorStop(0, 'rgba(255, 221, 120, 0.95)');
  glow.addColorStop(0.45, 'rgba(255, 185, 90, 0.38)');
  glow.addColorStop(1, 'rgba(255, 185, 90, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(22, 18, 28, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(22, 68, 16, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // flowing hair/back
  ctx.fillStyle = '#24171a';
  ctx.beginPath();
  ctx.moveTo(14, 8);
  ctx.quadraticCurveTo(5, 18, 8, 30);
  ctx.quadraticCurveTo(15, 36, 28, 32);
  ctx.quadraticCurveTo(34, 17, 28, 7);
  ctx.closePath();
  ctx.fill();

  // face
  ctx.fillStyle = '#f5d4b7';
  ctx.beginPath();
  ctx.arc(22, 18, 11, 0, Math.PI * 2);
  ctx.fill();

  // eyes
  ctx.fillStyle = '#1d1d26';
  ctx.fillRect(18, 18, 2, 2);
  ctx.fillRect(24, 18, 2, 2);

  ctx.strokeStyle = '#cf7c7c';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(22, 22, 5, 0.25, Math.PI - 0.25);
  ctx.stroke();

  // trench coat / jacket
  ctx.fillStyle = '#4e5368';
  ctx.beginPath();
  ctx.moveTo(12, 28);
  ctx.lineTo(32, 28);
  ctx.lineTo(36, 58);
  ctx.lineTo(8, 58);
  ctx.closePath();
  ctx.fill();

  // scarf
  ctx.fillStyle = '#d779a8';
  ctx.fillRect(16, 28, 10, 8);
  ctx.fillRect(18, 34, 6, 12);

  // coat lapel detail
  ctx.fillStyle = '#f0d7ee';
  ctx.beginPath();
  ctx.moveTo(22, 28);
  ctx.lineTo(28, 40);
  ctx.lineTo(18, 40);
  ctx.closePath();
  ctx.fill();

  // arms
  ctx.fillStyle = '#f2d4b6';
  ctx.fillRect(9, 30 + phase * 0.65, 5, 18);
  ctx.fillRect(32, 30 - phase * 0.65, 5, 18);
  ctx.fillRect(9, 46 + phase * 0.25, 5, 5);
  ctx.fillRect(32, 46 - phase * 0.25, 5, 5);

  // skirt / lower layer
  ctx.fillStyle = '#d7d6f8';
  ctx.beginPath();
  ctx.moveTo(12, 42);
  ctx.lineTo(30, 42);
  ctx.lineTo(34, 60);
  ctx.lineTo(9, 60);
  ctx.closePath();
  ctx.fill();

  // legs
  ctx.fillStyle = '#2b2330';
  ctx.fillRect(15, 56 + walkSwing * 0.3, 6, 14);
  ctx.fillRect(25, 56 - walkSwing * 0.3, 6, 14);

  // boots
  ctx.fillStyle = '#995b5d';
  ctx.fillRect(13, 69 + walkSwing * 0.2, 8, 5);
  ctx.fillRect(25, 69 - walkSwing * 0.2, 8, 5);

  ctx.restore();
}

function drawStageBackground(stageIndex) {
  const w = canvas.width;
  const h = canvas.height;
  const worldX = -game.cameraX;

  const skyPalette = [
    ['#0c1220', '#1d2432', '#2d2e46'],
    ['#101b2b', '#1b2336', '#2c2e43'],
    ['#111827', '#1e2238', '#3a2a4f'],
    ['#ffe8d7', '#f7d1a6', '#ecb3af']
  ];
  const [top, mid, bottom] = skyPalette[stageIndex] || skyPalette[0];
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, top);
  gradient.addColorStop(0.6, mid);
  gradient.addColorStop(1, bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  const moonX = w * 0.78;
  const moonY = h * 0.16;
  if (stageIndex < 3) {
    ctx.fillStyle = 'rgba(212, 228, 255, 0.8)';
    ctx.beginPath();
    ctx.arc(moonX, moonY, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(212, 228, 255, 0.18)';
    ctx.beginPath();
    ctx.arc(moonX, moonY, 52, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 34; i++) {
    const x = (((i * 174) - worldX * 0.18) % (w + 160)) - 80;
    const y = 32 + (i * 25) % (h * 0.45);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, y, 2, 2);
  }

  for (let i = 0; i < 24; i++) {
    const buildingX = ((i * 180) - worldX * 0.35) % (w + 260);
    const height = 90 + (i % 5) * 60;
    const width = 80 + (i % 4) * 26;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(12, 17, 24, 0.9)' : 'rgba(21, 26, 33, 0.9)';
    ctx.fillRect(buildingX, 420 - height, width, height);
    ctx.fillStyle = 'rgba(90, 110, 155, 0.2)';
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 4; col++) {
        const bx = buildingX + 10 + col * 18;
        const by = 430 - height + 12 + row * 18;
        ctx.fillRect(bx, by, 8, 12);
      }
    }
  }

  for (let i = 0; i < 9; i++) {
    const x = (i * 260) - (worldX * 0.6) % 260;
    ctx.fillStyle = 'rgba(255, 210, 118, 0.12)';
    ctx.beginPath();
    ctx.arc(x + 70, 220, 70, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    const x = ((i * 140) - worldX * 0.9) % (w + 180);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 30, h);
    ctx.stroke();
  }

  drawRain();
}

function drawRain() {
  ctx.strokeStyle = 'rgba(168, 192, 255, 0.2)';
  ctx.lineWidth = 1.1;
  for (let i = 0; i < 80; i++) {
    const x = ((i * 57) + performance.now() * 0.15 + game.cameraX * 0.4) % (canvas.width + 80) - 40;
    const y = ((i * 37) + performance.now() * 0.45) % (canvas.height + 80) - 20;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 5, y + 18);
    ctx.stroke();
  }
}

function drawForest(stageIndex) {
  const baseY = game.stage.groundY;
  for (let i = 0; i < 18; i++) {
    const x = ((i * 220) - (game.cameraX * 0.7)) % (canvas.width + 240);
    const treeX = x + 50;
    ctx.fillStyle = 'rgba(9, 14, 18, 0.9)';
    ctx.fillRect(treeX, baseY - 180, 14, 180);
    ctx.beginPath();
    ctx.fillStyle = 'rgba(18, 24, 28, 0.85)';
    ctx.arc(treeX + 8, baseY - 180, 48, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFog() {
  for (let i = 0; i < 14; i++) {
    const x = ((i * 220) - (game.cameraX * 0.4)) % (canvas.width + 260);
    const y = 180 + (i % 5) * 42;
    ctx.fillStyle = 'rgba(160, 182, 255, 0.09)';
    ctx.beginPath();
    ctx.ellipse(x, y, 170, 52, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawManor() {
  const baseY = game.stage.groundY;
  ctx.fillStyle = 'rgba(19, 21, 29, 0.9)';
  ctx.fillRect(0, baseY - 260, canvas.width + 200, 320);

  for (let i = 0; i < 24; i++) {
    const x = ((i * 170) - game.cameraX * 0.7) % (canvas.width + 280);
    ctx.fillStyle = '#121720';
    ctx.fillRect(x, baseY - 260, 24, 260);
    ctx.fillStyle = '#303a48';
    ctx.fillRect(x - 8, baseY - 220, 40, 70);
  }
}

function drawLibrary() {
  const baseY = game.stage.groundY;
  ctx.fillStyle = 'rgba(19, 18, 24, 0.92)';
  ctx.fillRect(0, baseY - 260, canvas.width + 100, 260);
  for (let i = 0; i < 16; i++) {
    const x = ((i * 160) - game.cameraX * 0.6) % (canvas.width + 220);
    ctx.fillStyle = '#2f2a3a';
    ctx.fillRect(x, baseY - 250, 12, 220);
  }

  for (let i = 0; i < 55; i++) {
    const x = (Math.sin(i * 2.7) * 50 + i * 30 + (game.cameraX * 0.7)) % (canvas.width + 40);
    const y = (i * 13 + (game.cameraX * 0.15)) % (canvas.height * 0.7);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(x, y, 2, 2);
  }
}

function drawCavern() {
  const baseY = game.stage.groundY;
  ctx.fillStyle = '#080d13';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#1b2731';
  ctx.fillRect(0, baseY - 260, canvas.width + 260, 260);
  for (let i = 0; i < 20; i++) {
    const x = ((i * 180) - game.cameraX * 0.75) % (canvas.width + 260);
    ctx.fillStyle = '#111d27';
    ctx.fillRect(x, baseY - 260, 26, 220);
  }
  for (let i = 0; i < 10; i++) {
    const x = ((i * 220) + game.cameraX * 0.2) % (canvas.width + 240);
    ctx.fillStyle = 'rgba(251, 153, 92, 0.09)';
    ctx.beginPath();
    ctx.arc(x, 160 + i * 24, 86, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGround() {
  const { groundY } = game.stage;
  const skyHeight = canvas.height;

  const roadGrad = ctx.createLinearGradient(0, groundY, 0, skyHeight);
  roadGrad.addColorStop(0, '#1d1e26');
  roadGrad.addColorStop(0.4, '#0d1016');
  roadGrad.addColorStop(1, '#07090d');
  ctx.fillStyle = roadGrad;
  ctx.fillRect(0, groundY, canvas.width, skyHeight - groundY);

  for (let x = -40; x < canvas.width + 120; x += 52) {
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(x, groundY + 18, 44, 2);
  }

  for (let x = -20; x < canvas.width + 120; x += 120) {
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(x + 22, groundY + 42, 60, 2);
    ctx.fillRect(x + 22, groundY + 72, 60, 2);
  }

  ctx.fillStyle = 'rgba(150, 175, 245, 0.10)';
  for (let i = 0; i < 14; i++) {
    const x = i * 100 + (game.cameraX * 0.25) % 120;
    ctx.fillRect(x, groundY + 10, 50, 2);
  }

  if (game.stageIndex === 0) {
    ctx.strokeStyle = '#9e8b73';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(1100, 620);
    ctx.lineTo(1150, 620);
    ctx.lineTo(1210, 620);
    ctx.stroke();

    const bridgeVisible = game.stageProgress.bridgeFixed || game.player.x > 1280;
    if (!bridgeVisible) {
      ctx.fillStyle = 'rgba(34, 28, 24, 0.9)';
      ctx.fillRect(1128, 604, 132, 30);
    }
  }

  if (game.stageIndex === 1) {
    ctx.fillStyle = '#232832';
    ctx.fillRect(0, groundY, canvas.width, 14);
  }
}

function drawWorldObjects() {
  const stage = game.stage;

  if (!stage || !game.started) return;

  const worldOffset = -game.cameraX;

  if (stageIndexIs(0)) {
    drawForest(0);
    const crate = { x: 520, y: 548, width: 120, height: 72 };
    drawCrate(crate.x + worldOffset, crate.y, crate.width, crate.height);

    const cage = { x: 1615, y: 500, width: 90, height: 120 };
    drawBirdCage(cage.x + worldOffset, cage.y, cage.width, cage.height);

    if (!game.inventory.plank) {
      drawPickupSprite(520 + worldOffset, 560, 32, 20, '#d29b5e', 'wood');
    }
    if (!game.inventory.key) {
      drawPickupSprite(1635 + worldOffset, 525, 22, 38, '#a0a2ab', 'key');
    }

    const bridge = { x: 1100, y: 570, width: 230, height: 34 };
    drawBridge(bridge.x + worldOffset, bridge.y, bridge.width, bridge.height, game.stageProgress.bridgeFixed || game.player.x > 1300 ? true : false);

    drawDoor(2140 + worldOffset, 500, 72, 120, !game.inventory.key, 'Rusty Iron Door');
  }

  if (stageIndexIs(1)) {
    drawManor();
    for (const sw of stage.switches) {
      drawFuse(sw.x + worldOffset, sw.y, sw.width, sw.height, sw.active);
    }
    drawGate(2140 + worldOffset, 500, 90, 130, game.stageProgress.fusesOn >= 3);
  }

  if (stageIndexIs(2)) {
    drawLibrary();
    drawOpenBook(760 + worldOffset, 540, 120, 70);
    drawVaultDoor(2130 + worldOffset, 500, 86, 120, false);
  }

  if (stageIndexIs(3)) {
    drawCavern();
    drawGoldenDoor(2260 + worldOffset, 470, 90, 150);
  }
}

function stageIndexIs(index) {
  return game.stageIndex === index;
}

function drawCrate(x, y, width, height) {
  ctx.fillStyle = '#5d3a1a';
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = '#7b4d22';
  ctx.fillRect(x + 8, y + 8, width - 16, height - 16);
  ctx.strokeStyle = '#312214';
  ctx.strokeRect(x + 10, y + 10, width - 20, height - 20);
  ctx.fillStyle = '#3b2614';
  ctx.fillRect(x + 14, y + 22, 18, 18);
  ctx.fillRect(x + width - 32, y + 22, 18, 18);
}

function drawBirdCage(x, y, width, height) {
  ctx.strokeStyle = '#542f1a';
  ctx.lineWidth = 4;
  ctx.strokeRect(x, y, width, height);
  ctx.strokeStyle = '#a99d7b';
  ctx.beginPath();
  ctx.moveTo(x + 8, y + 8);
  ctx.lineTo(x + width - 8, y + height - 18);
  ctx.moveTo(x + width - 8, y + 8);
  ctx.lineTo(x + 8, y + height - 18);
  ctx.stroke();
  ctx.fillStyle = '#e7d3a5';
  ctx.fillRect(x + width / 2 - 8, y + 30, 16, 26);
}

function drawPickupSprite(x, y, width, height, color, type) {
  if (type === 'wood') {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = '#5a2b0a';
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 4, y + 4, width - 8, height - 8);
  } else if (type === 'key') {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + width / 2, y + 10, 8, 0, Math.PI * 2);
    ctx.arc(x + width / 2, y + 10, 2, 0, Math.PI * 2, true);
    ctx.fill();
    ctx.fillRect(x + width / 2 - 2, y + 10, 4, 22);
    ctx.fillRect(x + width / 2 - 10, y + 24, 20, 4);
  }
}

function drawBridge(x, y, width, height, repaired) {
  ctx.fillStyle = repaired ? '#7e5537' : '#473427';
  ctx.fillRect(x, y, width, height);
  if (!repaired) {
    ctx.fillStyle = '#2b1f1b';
    ctx.fillRect(x + 40, y - 10, 20, 56);
    ctx.fillRect(x + 120, y - 10, 18, 56);
    ctx.strokeStyle = '#8d6a49';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y + 16);
    ctx.lineTo(x + width, y + 16);
    ctx.stroke();
  }
}

function drawDoor(x, y, width, height, locked, label) {
  ctx.fillStyle = locked ? '#4b515d' : '#7d8ca5';
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = '#29333a';
  ctx.fillRect(x + 14, y + 18, width - 28, height - 22);
  ctx.fillStyle = '#d7dfe9';
  ctx.fillRect(x + width * 0.5 - 4, y + height * 0.38, 8, 25);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.fillRect(x + 8, y + 12, width - 16, 8);

  if (locked) {
    ctx.fillStyle = '#f5df7c';
    ctx.fillRect(x + width * 0.2, y + 20, 10, 10);
    ctx.fillRect(x + width * 0.7, y + 20, 10, 10);
  }
}

function drawFuse(x, y, width, height, active) {
  const pulse = 0.5 + Math.sin(performance.now() * 0.006) * 0.4;
  const glow = active ? '#d5ffe9' : '#cfe3ff';

  if (!active) {
    ctx.fillStyle = 'rgba(255, 215, 120, 0.1)';
    ctx.beginPath();
    ctx.arc(x + width / 2, y + height / 2, 34 + pulse * 8, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = active ? '#78f7ad' : '#4b4e52';
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = active ? '#d5ffe9' : glow;
  ctx.fillRect(x + 5, y + 10, width - 10, height - 18);
  ctx.fillStyle = active ? '#ffeb99' : '#7b86a4';
  ctx.fillRect(x + width / 2 - 5, y - 18, 10, 18);
  ctx.fillStyle = active ? '#fff1b0' : '#f7d27d';
  ctx.fillRect(x + width / 2 - 8, y - 28, 16, 9);
}

function drawGate(x, y, width, height, active) {
  ctx.fillStyle = active ? '#a7b8d9' : '#2b3138';
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = active ? '#f7d678' : '#4e5f7c';
  ctx.fillRect(x + 20, y + 20, width - 40, height - 40);
  if (!active) {
    ctx.fillStyle = '#5a6874';
    ctx.fillRect(x + width / 2 - 7, y + 24, 14, height - 48);
  }
}

function drawOpenBook(x, y, width, height) {
  ctx.fillStyle = '#d5c59d';
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = '#9f865d';
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, width, height);
  ctx.strokeStyle = '#755b38';
  ctx.beginPath();
  ctx.moveTo(x + width / 2, y + 10);
  ctx.lineTo(x + width / 2, y + height - 10);
  ctx.stroke();
  ctx.fillStyle = '#8b6b40';
  ctx.fillRect(x + 16, y + 18, width - 32, 10);
  ctx.fillRect(x + 16, y + 36, width - 32, 10);
}

function drawVaultDoor(x, y, width, height, unlocked) {
  drawDoor(x, y, width, height, !unlocked, 'Vault Door');
}

function drawGoldenDoor(x, y, width, height) {
  ctx.fillStyle = '#7a5d1f';
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = '#f7d678';
  ctx.fillRect(x + 14, y + 18, width - 28, height - 20);
  ctx.fillStyle = '#f8f0b6';
  ctx.fillRect(x + 18, y + 22, width - 36, height - 28);
  ctx.fillStyle = '#b8861e';
  ctx.fillRect(x + width / 2 - 4, y + 18, 8, height - 22);
}

function drawParticles() {
  for (let i = 0; i < 18; i++) {
    const x = ((i * 147) + (game.cameraX * 0.35) + 57) % (canvas.width + 40);
    const y = 50 + ((i * 93 + performance.now() * 0.02) % 280);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(x, y, 2, 2);
  }
}

function drawLanternGlow() {
  const hero = game.player;
  const px = hero.x - game.cameraX + hero.w / 2;
  const py = hero.y + hero.h / 2;

  const warmGlow = ctx.createRadialGradient(px, py, 10, px, py, 260);
  warmGlow.addColorStop(0, 'rgba(255, 241, 180, 0.95)');
  warmGlow.addColorStop(0.25, 'rgba(255, 196, 92, 0.52)');
  warmGlow.addColorStop(0.7, 'rgba(120, 130, 220, 0.14)');
  warmGlow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = warmGlow;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const shadowOverlay = ctx.createRadialGradient(px, py, 110, px, py, 540);
  shadowOverlay.addColorStop(0, 'rgba(0,0,0,0)');
  shadowOverlay.addColorStop(1, 'rgba(0,0,0,0.72)');
  ctx.fillStyle = shadowOverlay;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawInteractionPrompt(label, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(14, 18, 28, 0.7)';
  ctx.fillRect(-44, -18, 88, 30);
  ctx.strokeStyle = 'rgba(255, 224, 160, 0.9)';
  ctx.strokeRect(-44, -18, 88, 30);
  ctx.fillStyle = '#f9e6b1';
  ctx.font = 'bold 12px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(label, 0, 6);
  ctx.restore();
}

function drawFinaleScene() {
  const t = game.finalTransition;

  if (t <= 0) return;

  const warm = ctx.createLinearGradient(0, 0, 0, canvas.height);
  warm.addColorStop(0, '#ffe7e7');
  warm.addColorStop(0.35, '#fff2d2');
  warm.addColorStop(1, '#ffe3c8');
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 80; i++) {
    const x = (i * 73 + (performance.now() * 0.08)) % (canvas.width + 100) - 50;
    const y = (i * 27 + performance.now() * (0.07 + i * 0.001)) % (canvas.height + 120);
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 110, 150, 0.8)' : 'rgba(255,245,180,0.8)';
    ctx.fillRect(x, y, 8, 8);
  }

  for (let i = 0; i < 22; i++) {
    const x = 100 + i * 48;
    const y = 80 + (i % 3) * 26 + (Math.sin((performance.now() * 0.002) + i) * 14);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillRect(x, y, 3, 40);
    ctx.beginPath();
    ctx.fillStyle = i % 2 === 0 ? '#ffc0d6' : '#fff1a8';
    ctx.arc(x + 1.5, y - 8, 8, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = '#404d52';
  ctx.fillRect(0, canvas.height - 160, canvas.width, 160);

  ctx.fillStyle = '#e9d1c4';
  ctx.fillRect(canvas.width / 2 - 34, canvas.height / 2 - 20, 68, 110);
  ctx.fillStyle = '#5c3f2a';
  ctx.fillRect(canvas.width / 2 - 52, canvas.height / 2 - 90, 104, 72);
  ctx.fillStyle = '#f6d9a4';
  ctx.fillRect(canvas.width / 2 - 18, canvas.height / 2 - 68, 36, 24);

  ctx.fillStyle = '#ffb7c5';
  ctx.fillRect(canvas.width / 2 - 70, canvas.height / 2 - 80, 28, 30);
  ctx.fillRect(canvas.width / 2 + 42, canvas.height / 2 - 80, 28, 30);

  ctx.fillStyle = '#5e7e57';
  ctx.fillRect(canvas.width / 2 - 90, canvas.height / 2 + 40, 24, 38);
  ctx.fillRect(canvas.width / 2 + 66, canvas.height / 2 + 40, 24, 38);

  ctx.fillStyle = '#f8d46d';
  ctx.fillRect(canvas.width / 2 + 90, canvas.height / 2 - 35, 44, 30);
  ctx.fillStyle = '#d4ed9d';
  ctx.fillRect(canvas.width / 2 + 100, canvas.height / 2 - 28, 14, 18);

  ctx.fillStyle = '#f7dcb1';
  ctx.fillRect(canvas.width / 2 - 100, canvas.height / 2 + 20, 40, 90);
  ctx.fillStyle = '#3e2c24';
  ctx.fillRect(canvas.width / 2 - 118, canvas.height / 2 + 25, 80, 55);

  ctx.fillStyle = '#f5dba7';
  ctx.fillRect(canvas.width / 2 - 40, canvas.height / 2 + 20, 80, 28);

  ctx.fillStyle = '#ff7ea4';
  ctx.fillRect(canvas.width / 2 + 90, canvas.height / 2 + 5, 14, 22);
  ctx.fillRect(canvas.width / 2 + 115, canvas.height / 2 + 5, 14, 22);
  ctx.fillStyle = '#7ecfa2';
  ctx.fillRect(canvas.width / 2 + 92, canvas.height / 2 - 15, 10, 16);
  ctx.fillRect(canvas.width / 2 + 117, canvas.height / 2 - 15, 10, 16);

  const bannerY = 90;
  ctx.fillStyle = 'rgba(255,255,255,0.58)';
  ctx.fillRect(canvas.width / 2 - 370, bannerY, 740, 78);
  ctx.fillStyle = '#f57fa9';
  ctx.font = 'bold 42px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('HAPPY BIRTHDAY AMMU! ❤️ (Sept 29)', canvas.width / 2, bannerY + 52);

  ctx.fillStyle = '#2c2745';
  ctx.font = '20px Arial';
  ctx.fillText('Dear Ammu, you conquered every dark path and solved every puzzle. No matter how dark or scary the road gets in life, I will always be right here waiting for you with love and flowers. Happy Birthday!', canvas.width / 2, canvas.height - 70, 760);
}

function render() {
  const stage = game.stage;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!game.started) {
    drawStageBackground(0);
    drawWorldObjects();
    return;
  }

  const stageIndex = game.stageIndex;
  drawStageBackground(stageIndex);
  drawParticles();
  drawGround();
  drawWorldObjects();

  if (!game.player.inFinale) {
    drawLanternGlow();
  }

  if (game.player.inFinale) {
    drawFinaleScene();
  }

  if (stage && !game.player.inFinale) {
    createPlayerSprite();

    let promptTarget = null;
    if (stageIndex === 0) {
      if (!game.inventory.plank && isNear(520, 548, 120, 72)) promptTarget = 'E • Crate';
      else if (!game.inventory.key && isNear(1615, 500, 90, 120)) promptTarget = 'E • Birdcage';
      else if (!game.stageProgress.bridgeFixed && isNear(1050, 570, 220, 34)) promptTarget = 'E • Repair bridge';
      else if (game.inventory.key && isNear(2140, 500, 72, 120)) promptTarget = 'E • Enter gate';
    }

    if (stageIndex === 1) {
      const nearbySwitch = stage.switches.find((sw) => isNear(sw.x, sw.y, sw.width, sw.height));
      if (nearbySwitch) promptTarget = 'E • Fuse';
      else if (game.stageProgress.fusesOn >= 3 && isNear(2140, 500, 90, 130)) promptTarget = 'E • Exit gate';
    }

    if (stageIndex === 2) {
      if (isNear(760, 540, 120, 70)) promptTarget = 'E • Open book';
      else if (isNear(2130, 500, 86, 120)) promptTarget = 'E • Vault door';
    }

    if (stageIndex === 3 && isNear(2260, 470, 90, 150)) promptTarget = 'E • Final door';

    if (promptTarget) {
      drawInteractionPrompt(promptTarget, game.player.x - game.cameraX + 26, game.player.y - 24);
    }

    if (stageIndex === 0 && game.inventory.plank) {
      ctx.fillStyle = 'rgba(195, 245, 188, 0.8)';
      ctx.fillRect(canvas.width - 180, 80, 150, 32);
      ctx.fillStyle = '#0d1a14';
      ctx.font = '16px Arial';
      ctx.fillText('Plank found', canvas.width - 110, 100);
    }

    if (stageIndex === 1 && game.stageProgress.fusesOn > 0) {
      ctx.fillStyle = 'rgba(192, 210, 255, 0.78)';
      ctx.fillRect(canvas.width - 195, 120, 160, 32);
      ctx.fillStyle = '#0e1720';
      ctx.font = '16px Arial';
      ctx.fillText(`Fuses: ${game.stageProgress.fusesOn}/3`, canvas.width - 110, 140);
    }
  }
}

function updatePlayer() {
  const p = game.player;
  const stage = game.stage;
  if (!stage || p.inFinale) {
    return;
  }

  let moveDir = 0;
  if (controls.left) moveDir -= 1;
  if (controls.right) moveDir += 1;
  if (moveDir !== 0) {
    p.facing = moveDir;
    p.x += moveDir * p.speed;
    p.walkCycle += 0.24;
    if (Math.floor(p.walkCycle) % 10 === 0) {
      playFootstep();
    }
  } else {
    p.walkCycle += 0.04;
  }

  if (stageIndexIs(0) && !game.stageProgress.bridgeFixed) {
    const gapStart = 1100;
    const gapEnd = 1330;
    if (p.x > gapStart && p.x < gapEnd) {
      p.x = gapStart - 6;
    }
  }

  p.x = Math.max(60, Math.min(stage.width - p.w, p.x));
  p.y = stage.groundY - p.h;

  game.cameraX = Math.max(0, Math.min(stage.width - canvas.width, p.x - canvas.width * 0.35));
}

function update() {
  updateMessage();
  if (game.started) {
    updatePlayer();
    updateAmbientMusic();
  }

  if (game.finalClimaxReady && !game.player.inFinale) {
    game.finalTransition += 0.02;
    if (game.finalTransition >= 1) {
      game.player.inFinale = true;
      game.finalTransition = 1;
    }
  }

  render();
  requestAnimationFrame(update);
}

window.addEventListener('load', () => {
  resizeCanvas();
  bindControls();
  loadStage(0);
  updateKeypadDisplay();
  update();
});
