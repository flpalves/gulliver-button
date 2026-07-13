// ─────────────────────────────────────────────
// INTERPOLATION  (Server state smoothing)
// ─────────────────────────────────────────────
// Interpola suavemente entre estados do servidor para evitar "teleports"
// Quando o cliente recebe um novo state_update, mistura com a previsão local

export class InterpolationManager {
  constructor() {
    this.serverStates = new Map();      // { bodyId: { pos, vel, quat, receivedAt } }
    this.interpolationTime = 50;        // ms — quanto tempo para interpolar (1-2 frames)
    this.lastUpdateTime = 0;
  }

  // Registrar novo estado do servidor para um corpo
  recordServerState(bodyId, pos, vel, quat, receivedAt) {
    this.serverStates.set(bodyId, {
      pos: { x: pos.x, y: pos.y, z: pos.z },
      vel: { x: vel.x, y: vel.y, z: vel.z },
      quat: { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
      receivedAt
    });
    this.lastUpdateTime = receivedAt;
  }

  // Calcular posição interpolada entre servidor e previsão local
  // alpha: 0 = posição do servidor, 1 = posição prevista localmente
  getInterpolationAlpha(now) {
    if (this.lastUpdateTime === 0) return 1.0;

    const timeSinceUpdate = now - this.lastUpdateTime;
    // Interpolar ao longo de interpolationTime ms
    // Depois de 50ms, usar 100% a previsão local
    return Math.min(timeSinceUpdate / this.interpolationTime, 1.0);
  }

  // Misturar posição do servidor com previsão local
  // server: posição recebida do servidor
  // local: posição da previsão local (physics.step)
  // alpha: 0 = todo servidor, 1 = toda previsão
  lerpPosition(serverPos, localPos, alpha) {
    return {
      x: serverPos.x + (localPos.x - serverPos.x) * alpha,
      y: serverPos.y + (localPos.y - serverPos.y) * alpha,
      z: serverPos.z + (localPos.z - serverPos.z) * alpha
    };
  }

  // Limpar estados antigos (mais de 500ms)
  cleanup(now) {
    const cutoff = now - 500;
    for (const [id, state] of this.serverStates) {
      if (state.receivedAt < cutoff) {
        this.serverStates.delete(id);
      }
    }
  }
}

// ─────────────────────────────────────────────
// DESYNC DETECTOR  (Detectar quando o servidor discorda)
// ─────────────────────────────────────────────
export class DesyncDetector {
  constructor() {
    this.lastServerStates = new Map();
    this.desyncs = [];
  }

  // Comparar posição recebida com a última conhecida
  // Se muito diferente, o servidor "corrigiu" (dessincronia)
  checkDesync(bodyId, serverPos, threshold = 2.0) {
    const lastState = this.lastServerStates.get(bodyId);
    if (!lastState) {
      this.lastServerStates.set(bodyId, serverPos);
      return false;
    }

    const dx = Math.abs(serverPos.x - lastState.x);
    const dz = Math.abs(serverPos.z - lastState.z);
    const distance = Math.sqrt(dx * dx + dz * dz);

    if (distance > threshold) {
      console.warn(`[Desync] Body ${bodyId} desincronizado: dist=${distance.toFixed(2)}`);
      this.desyncs.push({ bodyId, distance, time: Date.now() });
      return true;
    }

    this.lastServerStates.set(bodyId, serverPos);
    return false;
  }

  // Reportar desyncs recentes
  getRecentDesyncs(withinMs = 1000) {
    const now = Date.now();
    return this.desyncs.filter(d => (now - d.time) < withinMs);
  }
}
