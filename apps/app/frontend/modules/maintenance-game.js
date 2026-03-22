// ========================================
// MAINTENANCE MINI-GAME: "Ruteplanleggeren"
// Top-down canvas game: drive a service van, collect customers, avoid obstacles
// Polished with particles, combos, smooth movement, screen shake, etc.
// ========================================

(function() {
  var canvas, ctx, animFrame;
  var gameState = 'title'; // title | playing | gameover
  var dpr = 1;
  var W = 320, H = 440;
  var player, markers, obstacles, particles, floatingTexts, buildings;
  var score, highScore, customersCollected, timeAlive, comboCount, comboTimer;
  var obstacleTimer, difficultyTimer;
  var keys = {};
  var touchDir = { x: 0, y: 0 };
  var container = null;
  var keyHandler = null;
  var keyUpHandler = null;
  var shakeAmount = 0;
  var titleTime = 0;
  var gameOverFade = 0;
  var newRecord = false;
  var HS_KEY = 'skyplanner_maintenanceGameHighScore';
  var FONT = '-apple-system,BlinkMacSystemFont,sans-serif';

  // Difficulty scaling
  var BASE_SPEED = 1.6;
  var MAX_SPEED = 3.2;
  var ACCEL = 0.14;
  var FRICTION = 0.85;
  var MARKER_COUNT = 5;

  // Colors
  var COL = {
    bg: '#0a0e17',
    grid: 'rgba(99,102,241,0.06)',
    road: 'rgba(99,102,241,0.12)',
    roadCenter: 'rgba(255,200,50,0.15)',
    van: '#5E81AC',
    vanLight: '#81A1C1',
    vanWindow: '#88C0D0',
    vanWheel: '#2E3440',
    pin: '#A3BE8C',
    pinGlow: 'rgba(163,190,140,0.3)',
    obstacle: '#BF616A',
    obstacleGlow: 'rgba(191,97,106,0.3)',
    accent: '#6366f1',
    accentGlow: 'rgba(99,102,241,0.4)',
    text: '#E5E9F0',
    textDim: '#5c6370',
    textMuted: '#3b4252',
    combo: '#EBCB8B',
    building: '#161b26',
    buildingEdge: '#1e2433'
  };

  // --- Utility ---
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(min, max) { return min + Math.random() * (max - min); }
  function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }
  function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return Math.abs(ax - bx) < (aw + bw) / 2 && Math.abs(ay - by) < (ah + bh) / 2;
  }

  function currentSpeed() {
    return Math.min(MAX_SPEED, BASE_SPEED + score * 0.004);
  }

  // --- Buildings (decorative) ---
  function generateBuildings() {
    buildings = [];
    // Place small buildings in a grid-like pattern, avoiding roads
    var roadH = [128, 288];
    var roadV = [96, 224];
    for (var i = 0; i < 18; i++) {
      var bx = rand(10, W - 10);
      var by = rand(36, H - 10);
      var bw = rand(14, 28);
      var bh = rand(14, 24);
      // Skip if on a road
      var onRoad = false;
      for (var r = 0; r < roadH.length; r++) {
        if (Math.abs(by - roadH[r]) < 18) onRoad = true;
      }
      for (var v = 0; v < roadV.length; v++) {
        if (Math.abs(bx - roadV[v]) < 18) onRoad = true;
      }
      if (!onRoad) buildings.push({ x: bx, y: by, w: bw, h: bh });
    }
  }

  // --- Particles ---
  function spawnParticles(x, y, color, count) {
    for (var i = 0; i < count; i++) {
      particles.push({
        x: x, y: y,
        vx: rand(-2.5, 2.5),
        vy: rand(-2.5, 2.5),
        life: rand(15, 30),
        maxLife: 30,
        size: rand(2, 5),
        color: color
      });
    }
  }

  function spawnDust(x, y, vx, vy) {
    particles.push({
      x: x + rand(-3, 3), y: y + rand(-2, 2),
      vx: -vx * 0.3 + rand(-0.5, 0.5),
      vy: -vy * 0.3 + rand(-0.5, 0.5),
      life: rand(8, 16),
      maxLife: 16,
      size: rand(1.5, 3.5),
      color: 'rgba(99,102,241,0.5)'
    });
  }

  function updateParticles() {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.95;
      p.vy *= 0.95;
      p.life--;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var alpha = p.life / p.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // --- Floating text ---
  function spawnFloatingText(x, y, text, color) {
    floatingTexts.push({ x: x, y: y, text: text, color: color, life: 40, maxLife: 40 });
  }

  function updateFloatingTexts() {
    for (var i = floatingTexts.length - 1; i >= 0; i--) {
      var ft = floatingTexts[i];
      ft.y -= 0.8;
      ft.life--;
      if (ft.life <= 0) floatingTexts.splice(i, 1);
    }
  }

  function drawFloatingTexts() {
    for (var i = 0; i < floatingTexts.length; i++) {
      var ft = floatingTexts[i];
      var alpha = ft.life / ft.maxLife;
      var scale = 0.8 + 0.4 * (1 - alpha);
      ctx.globalAlpha = alpha;
      ctx.font = '700 ' + Math.round(14 * scale) + 'px ' + FONT;
      ctx.textAlign = 'center';
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  // --- Spawn ---
  function spawnMarker() {
    var tries = 0;
    var mx, my;
    do {
      mx = rand(24, W - 24);
      my = rand(44, H - 24);
      tries++;
    } while (tries < 20 && isTooCloseToObstacles(mx, my, 30));
    markers.push({
      x: mx, y: my, r: 9,
      pulse: rand(0, Math.PI * 2),
      spawnAnim: 1.0
    });
  }

  function isTooCloseToObstacles(x, y, minDist) {
    for (var i = 0; i < obstacles.length; i++) {
      if (dist(x, y, obstacles[i].x, obstacles[i].y) < minDist) return true;
    }
    return false;
  }

  function spawnObstacle() {
    var tries = 0;
    var ox, oy;
    var size = rand(16, 24);
    do {
      ox = rand(24, W - 24);
      oy = rand(44, H - 24);
      tries++;
    } while (tries < 30 && (dist(ox, oy, player.x, player.y) < 80 || isTooCloseToObstacles(ox, oy, 40)));
    obstacles.push({
      x: ox, y: oy, w: size, h: size,
      rot: rand(0, Math.PI * 2),
      pulse: rand(0, Math.PI * 2),
      spawnAnim: 1.0
    });
  }

  // --- Reset ---
  function reset() {
    player = { x: W / 2, y: H - 60, w: 24, h: 14, vx: 0, vy: 0, angle: -Math.PI / 2, targetAngle: -Math.PI / 2 };
    markers = [];
    obstacles = [];
    particles = [];
    floatingTexts = [];
    score = 0;
    customersCollected = 0;
    timeAlive = 0;
    comboCount = 0;
    comboTimer = 0;
    obstacleTimer = 0;
    difficultyTimer = 0;
    shakeAmount = 0;
    gameOverFade = 0;
    newRecord = false;
    generateBuildings();
    for (var i = 0; i < MARKER_COUNT; i++) spawnMarker();
  }

  // --- Drawing ---
  function drawBackground() {
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = COL.grid;
    ctx.lineWidth = 1;
    for (var x = 0; x < W; x += 32) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (var y = 0; y < H; y += 32) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Roads
    var roadHY = [128, 288];
    var roadVX = [96, 224];
    ctx.fillStyle = 'rgba(99,102,241,0.04)';
    for (var rh = 0; rh < roadHY.length; rh++) {
      ctx.fillRect(0, roadHY[rh] - 12, W, 24);
    }
    for (var rv = 0; rv < roadVX.length; rv++) {
      ctx.fillRect(roadVX[rv] - 12, 0, 24, H);
    }
    // Road edges
    ctx.strokeStyle = COL.road;
    ctx.lineWidth = 1;
    for (var rh2 = 0; rh2 < roadHY.length; rh2++) {
      ctx.beginPath(); ctx.moveTo(0, roadHY[rh2] - 12); ctx.lineTo(W, roadHY[rh2] - 12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, roadHY[rh2] + 12); ctx.lineTo(W, roadHY[rh2] + 12); ctx.stroke();
    }
    for (var rv2 = 0; rv2 < roadVX.length; rv2++) {
      ctx.beginPath(); ctx.moveTo(roadVX[rv2] - 12, 0); ctx.lineTo(roadVX[rv2] - 12, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(roadVX[rv2] + 12, 0); ctx.lineTo(roadVX[rv2] + 12, H); ctx.stroke();
    }
    // Center dashes
    ctx.strokeStyle = COL.roadCenter;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 8]);
    for (var rh3 = 0; rh3 < roadHY.length; rh3++) {
      ctx.beginPath(); ctx.moveTo(0, roadHY[rh3]); ctx.lineTo(W, roadHY[rh3]); ctx.stroke();
    }
    for (var rv3 = 0; rv3 < roadVX.length; rv3++) {
      ctx.beginPath(); ctx.moveTo(roadVX[rv3], 0); ctx.lineTo(roadVX[rv3], H); ctx.stroke();
    }
    ctx.setLineDash([]);

    // Buildings
    for (var b = 0; b < buildings.length; b++) {
      var bl = buildings[b];
      ctx.fillStyle = COL.building;
      ctx.fillRect(bl.x - bl.w / 2, bl.y - bl.h / 2, bl.w, bl.h);
      ctx.strokeStyle = COL.buildingEdge;
      ctx.lineWidth = 1;
      ctx.strokeRect(bl.x - bl.w / 2, bl.y - bl.h / 2, bl.w, bl.h);
    }
  }

  function drawVan(x, y, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(1, 2, 14, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    // Glow when moving
    var speed = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
    if (speed > 0.5) {
      ctx.shadowColor = COL.accentGlow;
      ctx.shadowBlur = 8 + speed * 2;
    }

    // Body
    var bw = 24, bh = 14;
    ctx.fillStyle = COL.van;
    roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 3);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Roof gradient
    ctx.fillStyle = COL.vanLight;
    roundRect(ctx, -bw / 2 + 2, -bh / 2 + 1, bw - 4, 4, 1.5);
    ctx.fill();

    // Windshield
    ctx.fillStyle = COL.vanWindow;
    ctx.fillRect(bw / 2 - 6, -bh / 2 + 2, 4, bh - 4);

    // Headlights
    ctx.fillStyle = '#EBCB8B';
    ctx.globalAlpha = 0.8;
    ctx.fillRect(bw / 2 - 1, -bh / 2 + 2, 2, 3);
    ctx.fillRect(bw / 2 - 1, bh / 2 - 5, 2, 3);
    ctx.globalAlpha = 1;

    // Taillights
    ctx.fillStyle = '#BF616A';
    ctx.fillRect(-bw / 2 - 1, -bh / 2 + 2, 2, 3);
    ctx.fillRect(-bw / 2 - 1, bh / 2 - 5, 2, 3);

    // Wheels
    ctx.fillStyle = COL.vanWheel;
    ctx.fillRect(-bw / 2 + 1, -bh / 2 - 2, 5, 2.5);
    ctx.fillRect(-bw / 2 + 1, bh / 2 - 0.5, 5, 2.5);
    ctx.fillRect(bw / 2 - 6, -bh / 2 - 2, 5, 2.5);
    ctx.fillRect(bw / 2 - 6, bh / 2 - 0.5, 5, 2.5);

    ctx.restore();
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }

  function drawPin(m, time) {
    var x = m.x, y = m.y, r = m.r;
    var pulse = 1 + Math.sin(m.pulse + time * 0.06) * 0.12;
    var spawnScale = 1 - m.spawnAnim;
    var sz = r * pulse * spawnScale;
    if (sz <= 0) return;

    // Glow
    ctx.shadowColor = COL.pinGlow;
    ctx.shadowBlur = 12;

    // Pin body
    ctx.fillStyle = COL.pin;
    ctx.beginPath();
    ctx.arc(x, y - sz * 0.7, sz * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - sz * 0.35, y - sz * 0.35);
    ctx.lineTo(x + sz * 0.35, y - sz * 0.35);
    ctx.lineTo(x, y + sz * 0.45);
    ctx.closePath();
    ctx.fill();

    // Inner dot
    ctx.fillStyle = '#D8DEE9';
    ctx.beginPath();
    ctx.arc(x, y - sz * 0.7, sz * 0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;

    // Ground shadow
    ctx.fillStyle = 'rgba(163,190,140,0.15)';
    ctx.beginPath();
    ctx.ellipse(x, y + sz * 0.5, sz * 0.5, sz * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawObstacleObj(o, time) {
    var pulse = 1 + Math.sin(o.pulse + time * 0.08) * 0.06;
    var spawnScale = 1 - o.spawnAnim;
    var sw = o.w * pulse * spawnScale;
    var sh = o.h * pulse * spawnScale;
    if (sw <= 0) return;

    ctx.save();
    ctx.translate(o.x, o.y);

    // Glow
    ctx.shadowColor = COL.obstacleGlow;
    ctx.shadowBlur = 10;

    // Warning sign: diamond shape
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = COL.obstacle;
    roundRect(ctx, -sw / 2, -sh / 2, sw, sh, 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Inner warning
    ctx.fillStyle = '#2E3440';
    ctx.font = '700 ' + Math.round(sw * 0.55) + 'px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.rotate(-Math.PI / 4);
    ctx.fillText('!', 0, 0);
    ctx.textBaseline = 'alphabetic';

    ctx.restore();
  }

  function drawHUD(time) {
    // Top bar
    ctx.fillStyle = 'rgba(10,14,23,0.85)';
    roundRect(ctx, 4, 4, W - 8, 30, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(99,102,241,0.15)';
    ctx.lineWidth = 1;
    roundRect(ctx, 4, 4, W - 8, 30, 8);
    ctx.stroke();

    // Score
    ctx.font = '700 14px ' + FONT;
    ctx.fillStyle = COL.text;
    ctx.textAlign = 'left';
    ctx.fillText(score + ' p', 16, 24);

    // Combo indicator
    if (comboCount > 1 && comboTimer > 0) {
      var comboAlpha = Math.min(1, comboTimer / 20);
      ctx.globalAlpha = comboAlpha;
      ctx.fillStyle = COL.combo;
      ctx.font = '700 12px ' + FONT;
      ctx.fillText('x' + comboCount, 70, 24);
      // Combo bar
      var barW = 30;
      var barFill = comboTimer / 90;
      ctx.fillStyle = 'rgba(235,203,139,0.2)';
      ctx.fillRect(92, 17, barW, 5);
      ctx.fillStyle = COL.combo;
      ctx.fillRect(92, 17, barW * barFill, 5);
      ctx.globalAlpha = 1;
    }

    // High score
    ctx.textAlign = 'right';
    ctx.font = '600 11px ' + FONT;
    ctx.fillStyle = '#88C0D0';
    ctx.fillText('Rekord: ' + highScore, W - 14, 23);
    ctx.textAlign = 'left';

    // Customer count (bottom right)
    ctx.fillStyle = 'rgba(10,14,23,0.7)';
    roundRect(ctx, W - 60, H - 26, 56, 22, 6);
    ctx.fill();
    ctx.fillStyle = COL.pin;
    ctx.font = '600 11px ' + FONT;
    ctx.textAlign = 'right';
    ctx.fillText(customersCollected + ' kunder', W - 10, H - 11);
    ctx.textAlign = 'left';
  }

  function drawGameOver(time) {
    gameOverFade = Math.min(1, gameOverFade + 0.04);
    var fade = gameOverFade;

    // Overlay
    ctx.fillStyle = 'rgba(10,14,23,' + (0.85 * fade) + ')';
    ctx.fillRect(0, 0, W, H);

    if (fade < 0.3) return;

    var contentAlpha = (fade - 0.3) / 0.7;
    ctx.globalAlpha = contentAlpha;

    var cy = H / 2 - 20;

    // Title
    ctx.textAlign = 'center';
    ctx.fillStyle = COL.text;
    ctx.font = '700 26px ' + FONT;
    ctx.fillText('Tur over!', W / 2, cy - 50);

    // Score box
    ctx.fillStyle = 'rgba(99,102,241,0.1)';
    roundRect(ctx, W / 2 - 80, cy - 30, 160, 70, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(99,102,241,0.2)';
    ctx.lineWidth = 1;
    roundRect(ctx, W / 2 - 80, cy - 30, 160, 70, 12);
    ctx.stroke();

    ctx.font = '700 32px ' + FONT;
    ctx.fillStyle = '#88C0D0';
    ctx.fillText(score, W / 2, cy + 8);
    ctx.font = '500 12px ' + FONT;
    ctx.fillStyle = COL.textDim;
    ctx.fillText('poeng', W / 2, cy + 26);

    // New record
    if (newRecord) {
      var bounce = 1 + Math.sin(time * 0.1) * 0.08;
      ctx.font = '700 ' + Math.round(16 * bounce) + 'px ' + FONT;
      ctx.fillStyle = COL.combo;
      ctx.fillText('Ny rekord!', W / 2, cy + 60);
    }

    // Stats
    var sy = cy + 85;
    ctx.font = '500 12px ' + FONT;
    ctx.fillStyle = COL.textDim;
    ctx.fillText(customersCollected + ' kunder besøkt', W / 2, sy);
    var secs = Math.floor(timeAlive / 60);
    ctx.fillText(secs + ' sekunder', W / 2, sy + 20);

    // Restart hint
    var hintPulse = 0.5 + Math.sin(time * 0.06) * 0.3;
    ctx.globalAlpha = contentAlpha * hintPulse + 0.4;
    ctx.fillStyle = COL.accent;
    ctx.font = '500 13px ' + FONT;
    ctx.fillText('Trykk for å spille igjen', W / 2, sy + 56);

    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  function drawTitleScreen(time) {
    titleTime++;
    drawBackground();

    // Decorative pins with gentle float
    var pins = [
      { x: 65, y: 100 }, { x: 245, y: 80 }, { x: 160, y: 240 },
      { x: 50, y: 300 }, { x: 270, y: 260 }
    ];
    for (var i = 0; i < pins.length; i++) {
      var pp = pins[i];
      var fakeM = { x: pp.x, y: pp.y + Math.sin(titleTime * 0.03 + i) * 4, r: 10, pulse: i * 1.2, spawnAnim: 0 };
      drawPin(fakeM, titleTime);
    }

    // Animated van driving in a circle
    var vanAngle = titleTime * 0.015;
    var vanX = W / 2 + Math.cos(vanAngle) * 40;
    var vanY = H / 2 + 30 + Math.sin(vanAngle) * 25;
    drawVan(vanX, vanY, vanAngle + Math.PI / 2);

    // Title card
    ctx.fillStyle = 'rgba(10,14,23,0.75)';
    roundRect(ctx, W / 2 - 130, H / 2 - 108, 260, 96, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(99,102,241,0.2)';
    ctx.lineWidth = 1;
    roundRect(ctx, W / 2 - 130, H / 2 - 108, 260, 96, 16);
    ctx.stroke();

    ctx.textAlign = 'center';

    // Logo-like title
    ctx.font = '800 24px ' + FONT;
    ctx.fillStyle = COL.text;
    ctx.fillText('Ruteplanleggeren', W / 2, H / 2 - 72);

    // Subtitle
    ctx.font = '400 13px ' + FONT;
    ctx.fillStyle = COL.textDim;
    ctx.fillText('Samle kunder — unngå hindringer', W / 2, H / 2 - 48);

    // High score
    if (highScore > 0) {
      ctx.font = '600 12px ' + FONT;
      ctx.fillStyle = '#88C0D0';
      ctx.fillText('Rekord: ' + highScore, W / 2, H / 2 - 28);
    }

    // Controls hint
    ctx.font = '400 12px ' + FONT;
    ctx.fillStyle = COL.textDim;
    ctx.fillText('Piltaster eller D-pad for å styre', W / 2, H / 2 + 90);

    // Start prompt (pulsing)
    var startPulse = 0.5 + Math.sin(titleTime * 0.06) * 0.4;
    ctx.globalAlpha = startPulse + 0.3;
    ctx.fillStyle = COL.accent;
    ctx.font = '600 15px ' + FONT;
    ctx.fillText('Trykk for å starte', W / 2, H / 2 + 120);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  // --- Update ---
  function update() {
    if (gameState !== 'playing') return;
    timeAlive++;

    // Input direction
    var dx = 0, dy = 0;
    if (keys.ArrowLeft || keys.a || touchDir.x < 0) dx = -1;
    if (keys.ArrowRight || keys.d || touchDir.x > 0) dx = 1;
    if (keys.ArrowUp || keys.w || touchDir.y < 0) dy = -1;
    if (keys.ArrowDown || keys.s || touchDir.y > 0) dy = 1;

    // Normalize diagonal
    if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }

    var spd = currentSpeed();

    // Smooth acceleration
    player.vx += dx * ACCEL * spd;
    player.vy += dy * ACCEL * spd;

    // Friction when no input
    if (dx === 0) player.vx *= FRICTION;
    if (dy === 0) player.vy *= FRICTION;

    // Clamp velocity
    var vel = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
    if (vel > spd) {
      player.vx = (player.vx / vel) * spd;
      player.vy = (player.vy / vel) * spd;
    }

    player.x += player.vx;
    player.y += player.vy;

    // Rotation towards movement direction
    if (vel > 0.3) {
      player.targetAngle = Math.atan2(player.vy, player.vx);
    }
    // Smooth angle interpolation
    var angleDiff = player.targetAngle - player.angle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    player.angle += angleDiff * 0.15;

    // Clamp to bounds
    player.x = Math.max(player.w / 2, Math.min(W - player.w / 2, player.x));
    player.y = Math.max(36 + player.h / 2, Math.min(H - player.h / 2, player.y));

    // Dust trail
    if (vel > 1.5 && Math.random() < 0.4) {
      spawnDust(player.x - player.vx * 3, player.y - player.vy * 3, player.vx, player.vy);
    }

    // Combo timer
    if (comboTimer > 0) comboTimer--;
    if (comboTimer <= 0) comboCount = 0;

    // Spawn animations
    for (var mi = 0; mi < markers.length; mi++) {
      if (markers[mi].spawnAnim > 0) markers[mi].spawnAnim = Math.max(0, markers[mi].spawnAnim - 0.06);
    }
    for (var oi = 0; oi < obstacles.length; oi++) {
      if (obstacles[oi].spawnAnim > 0) obstacles[oi].spawnAnim = Math.max(0, obstacles[oi].spawnAnim - 0.04);
    }

    // Collect markers
    for (var i = markers.length - 1; i >= 0; i--) {
      var m = markers[i];
      if (m.spawnAnim > 0.5) continue;
      if (dist(player.x, player.y, m.x, m.y) < 20) {
        // Combo
        comboCount++;
        comboTimer = 90;
        var bonus = comboCount > 1 ? comboCount * 5 : 0;
        var points = 10 + bonus;
        score += points;
        customersCollected++;

        // Floating text
        var txt = '+' + points;
        if (comboCount > 1) txt += ' x' + comboCount;
        spawnFloatingText(m.x, m.y - 10, txt, comboCount > 1 ? COL.combo : COL.pin);

        // Particles
        spawnParticles(m.x, m.y, COL.pin, 8);

        // High score
        if (score > highScore) {
          if (!newRecord) newRecord = true;
          highScore = score;
          try { localStorage.setItem(HS_KEY, String(highScore)); } catch(e) {}
        }

        markers.splice(i, 1);
        spawnMarker();
      }
    }

    // Obstacle collision
    for (var j = 0; j < obstacles.length; j++) {
      var o = obstacles[j];
      if (o.spawnAnim > 0.3) continue;
      if (rectsOverlap(player.x, player.y, player.w * 0.8, player.h * 0.8, o.x, o.y, o.w * 0.7, o.h * 0.7)) {
        gameState = 'gameover';
        shakeAmount = 12;
        spawnParticles(player.x, player.y, COL.obstacle, 20);
        spawnParticles(player.x, player.y, COL.combo, 8);
        return;
      }
    }

    // Spawn obstacles (ramp up over time)
    obstacleTimer++;
    var obstacleInterval;
    if (score < 30) {
      obstacleInterval = 99999; // No obstacles yet
    } else if (score < 80) {
      obstacleInterval = 240;
    } else if (score < 200) {
      obstacleInterval = 160;
    } else {
      obstacleInterval = Math.max(70, 140 - Math.floor(score / 10));
    }
    if (obstacleTimer >= obstacleInterval && obstacles.length < 15) {
      obstacleTimer = 0;
      spawnObstacle();
    }

    // Screen shake decay
    if (shakeAmount > 0) shakeAmount *= 0.9;
    if (shakeAmount < 0.2) shakeAmount = 0;

    updateParticles();
    updateFloatingTexts();
  }

  // --- Draw frame ---
  function drawFrame(time) {
    drawBackground();

    // Obstacles
    for (var j = 0; j < obstacles.length; j++) drawObstacleObj(obstacles[j], time);

    // Markers
    for (var i = 0; i < markers.length; i++) drawPin(markers[i], time);

    // Particles (below van)
    drawParticles();

    // Player van
    drawVan(player.x, player.y, player.angle);

    // Floating texts
    drawFloatingTexts();

    // HUD
    drawHUD(time);

    // Game over overlay
    if (gameState === 'gameover') drawGameOver(time);
  }

  // --- Main loop ---
  var frameCount = 0;
  function loop() {
    if (!canvas) return;
    frameCount++;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Death flash
    var flashAlpha = shakeAmount / 12;
    var doFlash = flashAlpha > 0.02;

    update();

    if (gameState === 'title') {
      drawTitleScreen(frameCount);
    } else {
      drawFrame(frameCount);
    }

    // Red flash overlay on death
    if (doFlash) {
      ctx.fillStyle = 'rgba(191,97,106,' + (flashAlpha * 0.45) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    ctx.restore();
    animFrame = requestAnimationFrame(loop);
  }

  function startGame() {
    if (gameState === 'playing') return;
    reset();
    gameState = 'playing';
  }

  // --- Input ---
  function setupKeyboard() {
    keyHandler = function(e) {
      if (!canvas) return;
      keys[e.key] = true;
      if ((e.key === ' ' || e.key === 'Enter') && gameState !== 'playing') {
        e.preventDefault();
        startGame();
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].indexOf(e.key) !== -1) {
        e.preventDefault();
      }
    };
    keyUpHandler = function(e) {
      keys[e.key] = false;
    };
    document.addEventListener('keydown', keyHandler);
    document.addEventListener('keyup', keyUpHandler);
  }

  function createDpad(parent) {
    var SIZE = 120;
    var KNOB = 44;
    var DEAD = 10;
    var wrapper = document.createElement('div');
    wrapper.id = 'mg-dpad';
    wrapper.style.cssText = 'display:flex;justify-content:center;margin-top:14px;user-select:none;-webkit-user-select:none;';

    var base = document.createElement('div');
    base.style.cssText = 'width:' + SIZE + 'px;height:' + SIZE + 'px;border-radius:50%;background:rgba(99,102,241,0.08);border:1.5px solid rgba(99,102,241,0.2);position:relative;touch-action:none;';

    var knob = document.createElement('div');
    knob.style.cssText = 'width:' + KNOB + 'px;height:' + KNOB + 'px;border-radius:50%;background:rgba(99,102,241,0.25);border:1.5px solid rgba(99,102,241,0.4);position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);transition:none;pointer-events:none;';
    base.appendChild(knob);

    var center = SIZE / 2;
    var maxDist = (SIZE - KNOB) / 2;
    var active = false;

    function updateKnob(cx, cy) {
      var dx = cx - center;
      var dy = cy - center;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxDist) { dx = dx / dist * maxDist; dy = dy / dist * maxDist; dist = maxDist; }
      knob.style.left = (center + dx) + 'px';
      knob.style.top = (center + dy) + 'px';
      knob.style.transform = 'translate(-50%,-50%)';

      if (dist < DEAD) {
        touchDir.x = 0; touchDir.y = 0;
      } else {
        touchDir.x = dx / maxDist;
        touchDir.y = dy / maxDist;
      }
    }

    function resetKnob() {
      knob.style.left = '50%';
      knob.style.top = '50%';
      knob.style.transform = 'translate(-50%,-50%)';
      touchDir.x = 0; touchDir.y = 0;
      active = false;
    }

    function getPos(e) {
      var rect = base.getBoundingClientRect();
      var t = e.touches ? e.touches[0] : e;
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    }

    base.addEventListener('touchstart', function(e) {
      e.preventDefault();
      active = true;
      var p = getPos(e);
      updateKnob(p.x, p.y);
      if (gameState !== 'playing') startGame();
    }, { passive: false });

    base.addEventListener('touchmove', function(e) {
      e.preventDefault();
      if (!active) return;
      var p = getPos(e);
      updateKnob(p.x, p.y);
    }, { passive: false });

    base.addEventListener('touchend', function(e) { e.preventDefault(); resetKnob(); }, { passive: false });
    base.addEventListener('touchcancel', function(e) { e.preventDefault(); resetKnob(); }, { passive: false });

    // Mouse fallback
    base.addEventListener('mousedown', function(e) {
      active = true;
      var p = getPos(e);
      updateKnob(p.x, p.y);
      if (gameState !== 'playing') startGame();
    });
    document.addEventListener('mousemove', function(e) {
      if (!active) return;
      var p = getPos(e);
      updateKnob(p.x, p.y);
    });
    document.addEventListener('mouseup', function() { if (active) resetKnob(); });

    wrapper.appendChild(base);
    parent.appendChild(wrapper);
  }

  function setupCanvasTouch() {
    if (!canvas) return;
    canvas.addEventListener('click', function() {
      if (gameState !== 'playing') startGame();
    });
  }

  // --- Global API ---

  window.startMaintenanceGame = function() {
    container = document.getElementById('maintenance-game-container');
    if (!container) return;

    // Hide the play button
    var btn = document.getElementById('maintenance-game-btn');
    if (btn) btn.style.display = 'none';

    highScore = parseInt(localStorage.getItem(HS_KEY) || '0', 10);
    dpr = window.devicePixelRatio || 1;

    // Scale for mobile
    var isMobile = window.innerWidth <= 500;
    if (isMobile) {
      W = Math.min(280, window.innerWidth - 40);
      H = Math.round(W * 1.3);
    }

    canvas = document.createElement('canvas');
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.cssText = 'width:' + W + 'px;height:' + H + 'px;border-radius:14px;border:1px solid rgba(99,102,241,0.15);display:block;margin:0 auto;cursor:pointer;touch-action:none;box-shadow:0 4px 24px rgba(0,0,0,0.3),0 0 48px rgba(99,102,241,0.08);';
    container.appendChild(canvas);

    ctx = canvas.getContext('2d');
    gameState = 'title';
    frameCount = 0;
    titleTime = 0;
    particles = [];
    floatingTexts = [];

    generateBuildings();
    setupKeyboard();
    setupCanvasTouch();
    createDpad(container);

    reset();
    gameState = 'title';
    loop();
  };

  window.destroyMaintenanceGame = function() {
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; }
    if (keyUpHandler) { document.removeEventListener('keyup', keyUpHandler); keyUpHandler = null; }
    canvas = null;
    ctx = null;
    container = null;
    gameState = 'title';
    keys = {};
    touchDir = { x: 0, y: 0 };
  };
})();
