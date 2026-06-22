import { C, GAME_MODES } from './constants.js';

// ─────────────────────────────────────────────
// GAME  (turns, possession, touch counter, goalkeeper window,
//        goals, out-of-bounds restarts, clock, overlays)
// ─────────────────────────────────────────────
const DEFAULT_TEAM_LABEL = { yellow: '🟡 Amarelo', blue: '🔵 Azul' };

// Rule modes
const RULE_MODES = {
  FOUR_TOUCHES: '4-toques',
  TWELVE_TOUCHES: '12-toques'
};

const HALF_SECONDS = 5 * 60; // fallback default
const GOAL_CELEBRATION_MS = 1500;
const RESTART_DELAY_MS = 1000;   // ball keeps flying free for 1s after leaving play, then snaps back
const FLASH_MS = 600;

export class Game {
  constructor({ players, ball, physics, field = null, ruleMode = RULE_MODES.FOUR_TOUCHES, gameMode = GAME_MODES.STANDARD, halfSeconds = HALF_SECONDS, teamNames = DEFAULT_TEAM_LABEL, multiplayer = null }) {
    this.players = players;
    this.ball = ball;
    this.physics = physics;
    this.field = field;
    this.ruleMode = ruleMode;
    this.gameMode = gameMode;
    this.halfSeconds = halfSeconds;
    this.teamLabel = teamNames;
    this.multiplayer = multiplayer;

    // Rule configuration
    this.maxTouches = ruleMode === RULE_MODES.TWELVE_TOUCHES ? 12 : 4;
    this.maxConsecutiveTouchesPerPlayer = ruleMode === RULE_MODES.TWELVE_TOUCHES ? 3 : null;
    this.keeperWindowTouches = ruleMode === RULE_MODES.TWELVE_TOUCHES ? 12 : 3;

    this.scores = { yellow: 0, blue: 0 };
    this.possession = 'yellow';
    this.touches = 0;
    this.lastShooter = null;        // Player who last shot in this possession
    this.shooterTouchCount = 0;     // How many times the last shooter has shot in a row (12-touch mode)
    this.locked = false;            // true while a fired shot is still resolving (or a goal/restart is settling)
    this.shooter = null;            // Player currently resolving a shot
    this.lastTouchTeam = null;      // team of whichever player last touched the ball this shot
    this.ballDead = false;          // true between a ball leaving play and its restart being placed
    this.restartPending = null;     // { team } — set after a throw-in/corner/goal-kick is placed,
                                    // until that team freely repositions one piece to take the kick

    this.half = 1;
    this.timeLeft = halfSeconds;
    this.paused = false;            // true while an overlay (half-time/full-time) is shown
    this.matchEnded = false;
    this._wasOutOfBounds = false;   // tracks the player-out-of-bounds warning so it can clear itself
    this.halfStartTeam = 'yellow';  // tracks which team started the current half
    this.keeperTouchedBall = false;   // true if any keeper touched the ball during current play
    this.throwInKickPending = false;  // true while waiting for the first kick after a throw-in
    this.isDirectFromThrowIn = false; // true while a throw-in kick is in flight
    this._turnTimerInterval = null;
    this._turnTimeLeft = null;
    this._inRepoPhase = false;

    this._kickSound = new Audio('assets/kick.mp3');
    this._kickSound.volume = 0.7;
    this._lastKickTime = 0;
    this._refereeSound = new Audio('assets/referee.mp3');
    this._refereeSound.volume = 0.8;
    this._goalSound = new Audio('assets/goal.mp3');
    this._goalSound.volume = 1.0;

    physics.onPlayerHitBall = (playerBody) => {
      const player = this.players.find(p => p.physBody === playerBody);
      if (player) {
        this.lastTouchTeam = player.team;
        if (player.isKeeper) this.keeperTouchedBall = true;
      }
      const now = performance.now();
      if (now - this._lastKickTime > 120) {
        this._lastKickTime = now;
        this._kickSound.currentTime = 0;
        this._kickSound.play().catch(() => {});
      }
    };

    physics.onPlayerHitPlayer = (bodyA, bodyB, cx, cz) => {
      // Foul: shooter's piece hit an opponent before the ball was touched.
      if (!this.locked || !this.shooter || this.ballDead) return;
      if (this.paused || this.matchEnded) return;
      if (this.lastTouchTeam !== null) return; // ball already touched — not a foul

      const playerA = this.players.find(p => p.physBody === bodyA);
      const playerB = this.players.find(p => p.physBody === bodyB);
      if (!playerA || !playerB) return;

      const isShooterA = playerA === this.shooter;
      const isShooterB = playerB === this.shooter;
      if (!isShooterA && !isShooterB) return; // active shooter not involved

      const other = isShooterA ? playerB : playerA;
      if (other.team === this.shooter.team) return; // teammate, not a foul

      // FOUL confirmed
      this.ballDead = true;
      const foulTeam = this._opponent(this.shooter.team);
      this._scheduleRestart(() => this._onFoul(cx, cz, foulTeam), 'Falta! Aguardando...');
    };

    document.getElementById('obtn').addEventListener('click', () => this.handleOverlayBtn());

    // Multiplayer callbacks
    if (this.multiplayer) {
      this.multiplayer.onRemoteShotFired = (payload) => this._onRemoteShotFired(payload);
      this.multiplayer.onPhysicsSettled = (payload) => this._onPhysicsSettled(payload);
      this.multiplayer.onGameStateUpdated = (data) => this._onGameStateUpdated(data);
    }

    this._updateHUD();
    this._updateTimerHUD();
    this._updateScoreHUD();
  }

  // ── Rules interface consumed by InputHandler ──
  canDrag(piece) {
    // A piece that wandered off the field (no perimeter walls anymore) can
    // always be dragged back in by its own team, regardless of whose turn
    // it is or whether a shot is resolving.
    if (this.isOutOfBounds(piece)) return true;
    if (this.locked || this.paused || this.matchEnded) return false;
    // Goalkeepers can be repositioned at any time during the game.
    if (piece.isKeeper) return true;
    // Restart pending (throw-in/corner/goal-kick/foul): the awarded team may
    // freely reposition up to 2 pieces before taking the kick.
    if (this.restartPending) return piece.team === this.restartPending.team;
    return piece.team === this.possession;
  }

  isReposition(piece) {
    if (this.restartPending && piece.team === this.restartPending.team) return true;
    if (piece.isKeeper) return true;   // keepers never take slingshot shots — reposition only
    // A piece that wandered off the field stays normally shootable on its
    // own team's turn — there's no requirement to drag it back inside the
    // lines before "playing" with it again. Only fall back to a free
    // reposition (no aim line, no impulse) when it *wouldn't* otherwise be
    // a legal shot right now (not this team's turn, a shot is still
    // resolving, etc.) — that's the case where canDrag's out-of-bounds
    // bypass let anyone grab it just to nudge it, not to shoot it.
    const isShotEligible = !this.locked && !this.paused && !this.matchEnded &&
      !this.restartPending && piece.team === this.possession;
    if (isShotEligible) return false;
    return this.isOutOfBounds(piece);
  }

  // Part of the rules interface — used above by canDrag/isReposition, and
  // by _checkPlayersOutOfBounds below for the HUD warning. Purely a
  // field-lines check; staying out past the lines no longer disables a
  // piece in any way (see isReposition) — physics.js's far wall is what
  // actually stops something from going further than the camera shows.
  isOutOfBounds(piece) {
    const { x, z } = piece.physBody.position;
    return Math.abs(x) > C.HW || Math.abs(z) > C.HH;
  }

  onShotFired(piece, impulse = null) {
    this._stopTurnTimer();
    this.locked = true;
    this.shooter = piece;
    this.lastTouchTeam = null;
    this.keeperTouchedBall = false;
    this.isDirectFromThrowIn = this.throwInKickPending;
    this.throwInKickPending = false;

    // Multiplayer: emit shot to server
    if (this.multiplayer && this.multiplayer.isActive && impulse) {
      const bodyStates = this._captureBodyStates();
      const playerIdx = this.players.indexOf(piece);
      this.multiplayer.emitShotFired(playerIdx, impulse, bodyStates);
    }

    this._setStatus('Resolvendo jogada...');
  }

  onReposition(piece) {
    // Keeper repositions are always free and never consume restart slots.
    if (piece.isKeeper) return;
    // Free placement — doesn't touch possession/turn state, except it
    // consumes reposition slots from the restart window.
    if (this.restartPending && piece.team === this.restartPending.team) {
      this.restartPending.repositionsLeft--;
      if (this.restartPending.repositionsLeft <= 0) {
        this.restartPending = null;
        this._updateHUD();
      } else {
        this._updateHUD(`Reposicione mais ${this.restartPending.repositionsLeft} jogador(es) livremente`);
      }
    }
  }

  // ── Called once per frame from main.js, with the real elapsed seconds ──
  update(dt) {
    if (!this.paused && !this.matchEnded) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this._onHalfEnd();
      }
      this._updateTimerHUD();
    }

    if (this.locked && !this.ballDead && this.physics.allAtRest()) this._resolveShot();
    if (!this.matchEnded) this._checkOutOfPlay();
    this._checkPlayersOutOfBounds();
    // While a restart is pending (set piece being set up), keep all players
    // frozen so physics collisions between packed pieces don't make them drift.
    if (this.restartPending) this._freezePlayers();
  }

  // ── Pieces leaving the field (no perimeter walls anymore) ──
  // Purely a HUD nudge: canDrag/isReposition already let either team drag
  // a stray piece back in at any time (see isOutOfBounds above) — this
  // just surfaces a status message so it's obvious a piece needs fixing.
  _checkPlayersOutOfBounds() {
    const stray = this.players.some(p => this.isOutOfBounds(p));
    if (stray && !this._wasOutOfBounds) {
      this._wasOutOfBounds = true;
      this._setStatus('⚠️ Jogador fora de campo — arraste-o de volta para o tabuleiro');
    } else if (!stray && this._wasOutOfBounds) {
      this._wasOutOfBounds = false;
      this._updateHUD();
    }
  }

  _resolveShot() {
    // Possession only survives if the *last* player to touch the ball this
    // play belongs to the team that already had the ball — covers both
    // whiffing entirely (lastTouchTeam stays null) and the shot deflecting
    // off an opponent's piece on the way (lastTouchTeam flips to them).

    if (this.lastTouchTeam === this.possession) {
      // Valid touch — ball touched by team with possession
      this.touches++;

      if (this.ruleMode === RULE_MODES.TWELVE_TOUCHES) {
        // Track consecutive touches by same player
        if (this.lastShooter === this.shooter) {
          this.shooterTouchCount++;
        } else {
          this.lastShooter = this.shooter;
          this.shooterTouchCount = 1;
        }

        // Check if player exceeded max consecutive touches
        if (this.shooterTouchCount > this.maxConsecutiveTouchesPerPlayer) {
          this._switchPossession();
        } else if (this.touches >= this.maxTouches) {
          this._switchPossession();
        }
      } else {
        // 4-touch mode
        if (this.touches >= this.maxTouches) this._switchPossession();
      }
    } else {
      // Invalid touch (missed the ball or deflected by opponent)
      this._switchPossession();
    }

    this.locked = false;
    this.shooter = null;

    // Multiplayer: emit physics settled so server can process game rules
    if (this.multiplayer && this.multiplayer.isActive) {
      const bodyStates = this._captureBodyStates();
      const lastTouchTeam = this.lastTouchTeam;
      const playerIdx = this.players.indexOf(this.shooter);
      this.multiplayer.emitPhysicsSettled(bodyStates, lastTouchTeam, playerIdx);
    }

    // Ball stopped in the small area, or in the big area after a keeper touch:
    // the possession team may reposition one player before the next shot.
    if (this._isBallInSmallArea() || (this._isBallInBigArea() && this.keeperTouchedBall)) {
      this.restartPending = { team: this.possession, repositionsLeft: 1 };
      this._updateHUD('Bola na área — reposicione um jogador para tocar a bola');
    } else {
      this._updateHUD();
    }
  }

  _switchPossession() {
    this.possession = this._opponent(this.possession);
    this.touches = 0;
    this.lastShooter = null;
    this.shooterTouchCount = 0;
  }

  _opponent(team) {
    return team === 'yellow' ? 'blue' : team === 'blue' ? 'yellow' : null;
  }

  // ── Ball leaving play (goal, sideline, byline) ──
  // With no perimeter walls, the ball keeps sailing past the line under its
  // own momentum instead of bouncing off something right at the edge. The
  // exact exit point (x, z) is captured the instant it crosses — *then* the
  // restart is scheduled a beat later, while the ball is left free to keep
  // flying/rolling off the field in the meantime (see _scheduleRestart).
  _checkOutOfPlay() {
    if (this.ballDead) return;
    const { x, y, z } = this.ball.physBody.position;

    if (Math.abs(x) > C.HW) {
      // Goal zone: ball must be between posts (Z) AND below crossbar (Y)
      if (Math.abs(z) < C.GW / 2 + 0.3 && y <= C.GH) {
        this.ballDead = true;
        const scoringTeam = x > 0 ? 'yellow' : 'blue';
        const goal = this.field ? this.field.getGoalByX(x) : null;
        const isValidGoal = !goal || goal.didBallPassCleanly();

        if (isValidGoal && this.isDirectFromThrowIn) {
          this.isDirectFromThrowIn = false;
          this._scheduleRestart(() => this._onByline(x, z), 'Gol direto de lateral — tiro de meta!');
        } else if (isValidGoal) {
          this._onGoal(scoringTeam);
        } else {
          this._scheduleRestart(() => this._onByline(x, z));
        }
      } else if (this.gameMode !== GAME_MODES.SHOWBOL) {
        // In showbol the byline boards physically prevent the ball from reaching here
        this.ballDead = true;
        this._scheduleRestart(() => this._onByline(x, z));
      }
      return;
    }

    if (Math.abs(z) > C.HH) {
      if (this.gameMode === GAME_MODES.SHOWBOL) return;  // lateral boards handle it physically
      this.ballDead = true;
      this._scheduleRestart(() => this._onThrowIn(x, z));
    }
  }

  // Locks play and holds the captured exit point for RESTART_DELAY_MS
  // before snapping the ball back onto the line — gives the ball time to
  // visibly leave the field first instead of teleporting back instantly.
  _scheduleRestart(fn, statusMsg = 'Bola fora de campo...') {
    this._stopTurnTimer();
    this.locked = true;
    this._setStatus(statusMsg);
    setTimeout(fn, RESTART_DELAY_MS);
  }

  _onGoal(team) {
    this._stopTurnTimer();
    this.locked = true;
    this.scores[team]++;
    this._updateScoreHUD();
    this._flashGoal();
    this._goalSound.currentTime = 0;
    this._goalSound.play().catch(() => {});
    this._setStatus(`GOL do ${this.teamLabel[team]}!`);

    // Reset collision tracking for both goals
    if (this.field) {
      this.field.goals.forEach(goal => goal.resetCollisionTracking());
    }

    setTimeout(() => {
      this._resetKickoff(this._opponent(team));
      this.ballDead = false;
      this.locked = false;
    }, GOAL_CELEBRATION_MS);
  }

  _playRefereeSound() {
    this._refereeSound.currentTime = 0;
    this._refereeSound.play().catch(() => {});
  }

  _onThrowIn(x, z) {
    // Ball goes back exactly onto the sideline, at the same X it crossed.
    const restartTeam = this._opponent(this.lastTouchTeam) ?? this.possession;
    const px = Math.min(Math.max(x, -C.HW), C.HW);
    const pz = z > 0 ? C.HH : -C.HH;
    this._playRefereeSound();
    this._placeBallAndRestart(px, pz, restartTeam, `Lateral para o ${this.teamLabel[restartTeam]}`);
    this.throwInKickPending = true; // direct goal from this kick is not allowed
  }

  _onByline(x, z) {
    const defendingTeam = x > 0 ? 'blue' : 'yellow';
    const attackingTeam = this._opponent(defendingTeam);
    const concededByDefender = this.lastTouchTeam === defendingTeam;
    const restartTeam = concededByDefender ? attackingTeam : defendingTeam;

    let px, pz, msg;
    if (concededByDefender) {
      // Corner kick: ball at the corner flag (intersection of goal line and touch line)
      px = x > 0 ? C.HW : -C.HW;
      pz = z >= 0 ? C.HH : -C.HH;
      msg = `Escanteio para o ${this.teamLabel[restartTeam]}`;
    } else {
      // Goal kick: ball at the centre of the front edge of the defending team's small area
      px = x > 0 ? C.HW - C.SAD : -C.HW + C.SAD;
      pz = 0;
      msg = `Tiro de meta para o ${this.teamLabel[restartTeam]}`;
    }
    this._playRefereeSound();
    this._placeBallAndRestart(px, pz, restartTeam, msg);
  }

  _freezePlayers() {
    this.players.forEach(p => {
      p.physBody.velocity.set(0, 0, 0);
      p.physBody.angularVelocity.set(0, 0, 0);
    });
  }

  _onFoul(x, z, foulTeam) {
    this._refereeSound.currentTime = 0;
    this._refereeSound.play().catch(() => {});
    this._placeBallAndRestart(x, z, foulTeam, `Falta para o ${this.teamLabel[foulTeam]}`);
  }

  // Push every player that is closer than MIN_RESTART_DIST to the ball outward.
  // Each player is moved radially away from the ball — toward the nearest point
  // on the exclusion circle from where they already stand, so they end up as
  // close as possible to their original position.
  _enforceMinimumDistance(ballX, ballZ) {
    const minDist = C.MIN_RESTART_DIST;
    this.players.forEach(player => {
      const pos = player.physBody.position;
      const dx = pos.x - ballX;
      const dz = pos.z - ballZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist >= minDist) return;

      // Radial push: ball → player direction. Fall back to own-goal axis only
      // when the player is sitting exactly on top of the ball.
      let nx, nz;
      if (dist < 0.01) {
        nx = player.team === 'yellow' ? -1 : 1;
        nz = 0;
      } else {
        nx = dx / dist;
        nz = dz / dist;
      }

      const newX = ballX + nx * minDist;
      const newZ = ballZ + nz * minDist;

      player.physBody.position.x = newX;
      player.physBody.position.z = newZ;
      player.physBody.velocity.set(0, 0, 0);
      player.physBody.angularVelocity.set(0, 0, 0);
      // Sync visual immediately so there is no one-frame lag
      player.group.position.x = newX;
      player.group.position.z = newZ;
    });
  }

  _placeBallAndRestart(x, z, team, msg) {
    this.ball.group.position.set(x, this.ball.restY, z);
    this.ball.group.rotation.set(0, 0, 0);
    this.ball.mesh.quaternion.set(0, 0, 0, 1);
    const body = this.ball.physBody;
    body.position.set(x, this.ball.restY, z);
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
    body.quaternion.set(0, 0, 0, 1);

    // Reset collision tracking for both goals when ball is placed
    if (this.field) {
      this.field.goals.forEach(goal => goal.resetCollisionTracking());
    }

    this.possession = team;
    this.touches = 0;
    this.locked = false;
    this.ballDead = false;
    this.keeperTouchedBall = false;
    this.throwInKickPending = false; // will be re-set by _onThrowIn after this call if needed
    this.restartPending = { team, repositionsLeft: 2 };
    this._enforceMinimumDistance(x, z);
    this._updateHUD(`${msg} — reposicione até 2 jogadores livremente`);
  }

  _resetKickoff(possessionTeam) {
    this.players.forEach(p => p.reset());
    this.ball.reset();

    // Reset collision tracking for both goals when ball is reset
    if (this.field) {
      this.field.goals.forEach(goal => goal.resetCollisionTracking());
    }

    this.possession = possessionTeam;
    this.touches = 0;
    this.keeperTouchedBall = false;
    this.throwInKickPending = false;
    this.isDirectFromThrowIn = false;
    this.restartPending = null;
    this._updateHUD();
  }

  _isBallInSmallArea() {
    const { x, z } = this.ball.physBody.position;
    return Math.abs(x) > C.HW - C.SAD && Math.abs(x) <= C.HW && Math.abs(z) < C.SAW / 2;
  }

  _isBallInBigArea() {
    const { x, z } = this.ball.physBody.position;
    return Math.abs(x) > C.HW - C.BAD && Math.abs(x) <= C.HW && Math.abs(z) < C.BAW / 2;
  }

  _flashGoal() {
    const el = document.getElementById('gflash');
    el.classList.add('on');
    setTimeout(() => el.classList.remove('on'), FLASH_MS);
  }

  // ── Clock / half-time / full-time ──
  _onHalfEnd() {
    this._stopTurnTimer();
    this.locked = true;
    this.paused = true;
    if (this.half === 1) {
      this.half = 2;
      this._showOverlay('INTERVALO', 'Placar parcial');
    } else {
      this.matchEnded = true;
      this._showOverlay('FIM DE JOGO', 'Placar final');
    }
  }

  _showOverlay(title, sub) {
    document.getElementById('otitle').textContent = title;
    document.getElementById('osub').textContent = sub;
    document.getElementById('osy').textContent = this.scores.yellow;
    document.getElementById('osb').textContent = this.scores.blue;
    document.getElementById('obtn').textContent = this.matchEnded ? 'Novo jogo' : 'Continuar';
    document.getElementById('overlay').classList.add('on');
  }

  handleOverlayBtn() {
    document.getElementById('overlay').classList.remove('on');
    if (this.matchEnded) {
      this._fullReset();
    } else {
      this.timeLeft = this.halfSeconds;
      this.paused = false;
      this.halfStartTeam = this._opponent(this.halfStartTeam);
      this._resetKickoff(this.halfStartTeam);
    }
    this._updateTimerHUD();
    this._updateHUD();
  }

  _fullReset() {
    this._stopTurnTimer();
    this._inRepoPhase = false;
    this.scores = { yellow: 0, blue: 0 };
    this.half = 1;
    this.timeLeft = this.halfSeconds;
    this.matchEnded = false;
    this.paused = false;
    this.locked = false;
    this.ballDead = false;
    this.keeperTouchedBall = false;
    this.throwInKickPending = false;
    this.isDirectFromThrowIn = false;
    this.restartPending = null;
    this.halfStartTeam = 'yellow';
    this._resetKickoff('yellow');
    this._updateScoreHUD();
  }

  _setStatus(msg) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const existing = container.querySelector('.toast-pill');
    if (existing && existing.dataset.msg === msg) return;
    if (existing) existing.remove();
    let cls = 'toast-pill';
    if (msg.includes('GOL')) cls += ' toast-goal';
    else if (msg.includes('⚠️') || msg.includes('fora de campo') || msg.includes('⏱')) cls += ' toast-warning';
    const pill = document.createElement('div');
    pill.className = cls;
    pill.dataset.msg = msg;
    pill.dataset.baseMsg = msg;
    container.appendChild(pill);
    if (this._turnTimeLeft !== null) {
      this._updateTurnTimerDisplay();
    } else {
      pill.textContent = msg;
    }
  }

  _updateHUD(customStatus) {
    document.getElementById('poss-val').textContent = this.teamLabel[this.possession];
    document.getElementById('touch-val').textContent = `${this.touches} / ${this.maxTouches}`;
    this._setStatus(customStatus || `Vez do ${this.teamLabel[this.possession]} — clique e arraste uma peça`);
    if (!this.locked && !this.paused && !this.matchEnded) {
      if (this.restartPending) {
        this._inRepoPhase = true;
        this._startRepositionTimer();
      } else if (!customStatus) {
        if (this._inRepoPhase) {
          this._inRepoPhase = false;
          this._startTurnTimer();
        } else if (!this._turnTimerInterval) {
          this._startTurnTimer();
        }
      } else {
        this._stopTurnTimer();
      }
    } else {
      this._stopTurnTimer();
    }
  }

  _startTurnTimer() {
    this._stopTurnTimer();
    this._turnTimeLeft = 10;
    this._updateTurnTimerDisplay();
    this._turnTimerInterval = setInterval(() => {
      this._turnTimeLeft--;
      if (this._turnTimeLeft <= 0) {
        this._stopTurnTimer();
        this._onTurnTimeout();
      } else {
        this._updateTurnTimerDisplay();
      }
    }, 1000);
  }

  _stopTurnTimer() {
    if (this._turnTimerInterval) {
      clearInterval(this._turnTimerInterval);
      this._turnTimerInterval = null;
    }
    this._turnTimeLeft = null;
  }

  _updateTurnTimerDisplay() {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const pill = container.querySelector('.toast-pill');
    if (!pill) return;
    const t = this._turnTimeLeft;
    const color = t <= 3 ? '#ffb347' : '#7eb8ff';
    pill.innerHTML = `${pill.dataset.baseMsg} <span style="color:${color};font-weight:bold;margin-left:8px">${t}s</span>`;
    if (t <= 3) pill.classList.add('toast-warning');
    else pill.classList.remove('toast-warning');
  }

  _startRepositionTimer() {
    this._stopTurnTimer();
    this._turnTimeLeft = 5;
    this._updateTurnTimerDisplay();
    this._turnTimerInterval = setInterval(() => {
      this._turnTimeLeft--;
      if (this._turnTimeLeft <= 0) {
        this._stopTurnTimer();
        this._onRepositionTimeout();
      } else {
        this._updateTurnTimerDisplay();
      }
    }, 1000);
  }

  _onRepositionTimeout() {
    this._inRepoPhase = false;
    this.restartPending = null;
    this._updateHUD();
  }

  _onTurnTimeout() {
    this._switchPossession();
    this.locked = true;
    document.getElementById('poss-val').textContent = this.teamLabel[this.possession];
    document.getElementById('touch-val').textContent = `${this.touches} / ${this.maxTouches}`;
    this._setStatus(`⏱ Tempo esgotado! Vez do ${this.teamLabel[this.possession]}`);
    setTimeout(() => {
      this.locked = false;
      this._updateHUD();
    }, 1500);
  }

  _updateScoreHUD() {
    document.getElementById('sy').textContent = this.scores.yellow;
    document.getElementById('sb').textContent = this.scores.blue;
  }

  _updateTimerHUD() {
    const m = Math.floor(this.timeLeft / 60);
    const s = Math.floor(this.timeLeft % 60);
    const half = this.half === 1 ? '1T' : '2T';
    document.getElementById('timer-val').textContent =
      `${half} ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  _captureBodyStates() {
    const states = [];

    // Ball
    states.push({
      id: 'ball',
      pos: { x: this.ball.physBody.position.x, y: this.ball.physBody.position.y, z: this.ball.physBody.position.z },
      vel: { x: this.ball.physBody.velocity.x, y: this.ball.physBody.velocity.y, z: this.ball.physBody.velocity.z },
      quat: { x: this.ball.physBody.quaternion.x, y: this.ball.physBody.quaternion.y, z: this.ball.physBody.quaternion.z, w: this.ball.physBody.quaternion.w }
    });

    // Players
    this.players.forEach((p, idx) => {
      states.push({
        id: `player_${idx}`,
        pos: { x: p.physBody.position.x, y: p.physBody.position.y, z: p.physBody.position.z },
        vel: { x: p.physBody.velocity.x, y: p.physBody.velocity.y, z: p.physBody.velocity.z },
        quat: { x: p.physBody.quaternion.x, y: p.physBody.quaternion.y, z: p.physBody.quaternion.z, w: p.physBody.quaternion.w }
      });
    });

    return states;
  }

  applyBodyStates(states, syncVelocity = true) {
    if (!states || !Array.isArray(states)) return;

    states.forEach(state => {
      if (state.id === 'ball' && this.ball) {
        this.ball.physBody.position.set(state.pos.x, state.pos.y, state.pos.z);
        if (syncVelocity) {
          this.ball.physBody.velocity.set(state.vel.x, state.vel.y, state.vel.z);
        }
        this.ball.physBody.quaternion.set(state.quat.x, state.quat.y, state.quat.z, state.quat.w);
      } else if (state.id.startsWith('player_')) {
        const idx = parseInt(state.id.split('_')[1]);
        const player = this.players[idx];
        if (player) {
          player.physBody.position.set(state.pos.x, state.pos.y, state.pos.z);
          if (syncVelocity) {
            player.physBody.velocity.set(state.vel.x, state.vel.y, state.vel.z);
          }
          player.physBody.quaternion.set(state.quat.x, state.quat.y, state.quat.z, state.quat.w);
        }
      }
    });
  }

  _onRemoteShotFired(payload) {
    if (!this.multiplayer || !this.multiplayer.isActive) return;

    // Sync body positions (NOT velocities - impulse will be applied next)
    this.applyBodyStates(payload.bodyStates, false);

    // Apply the impulse to the remote player's piece
    const piece = this.players[payload.playerIdx];
    if (piece && payload.impulse) {
      piece.physBody.velocity.x = payload.impulse.x;
      piece.physBody.velocity.y = payload.impulse.y;
      piece.physBody.velocity.z = payload.impulse.z;
    }
  }

  _onPhysicsSettled(payload) {
    if (!this.multiplayer || !this.multiplayer.isActive) return;

    // Sync final state including velocities (physics has settled)
    this.applyBodyStates(payload.bodyStates, true);
  }

  _onGameStateUpdated(data) {
    if (!this.multiplayer || !this.multiplayer.isActive) return;

    const { gameState } = data;

    // Sync game state from server
    this.possession = gameState.possession;
    this.touches = gameState.touches;
    this.locked = gameState.locked;

    // Sync body positions from server (for the player NOT currently controlling physics)
    // Only sync positions, not velocities (velocities are calculated locally)
    if (gameState.bodyStates && !data.isMyTurn) {
      this.applyBodyStates(gameState.bodyStates, false);
    }

    // Update HUD to reflect server state
    this._updateHUD();
  }
}

export { RULE_MODES };
