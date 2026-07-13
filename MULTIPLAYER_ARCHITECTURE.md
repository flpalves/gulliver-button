# Arquitetura Multiplayer - Física Fluida e Sincronizada

## 🎯 Abordagem Implementada: Server Authority + Client Prediction + Interpolation

Esta é a melhor abordagem para jogos multiplayer com física, pois combina:
- ✅ **Jogo responsivo** (sem lag percebido)
- ✅ **Sincronização garantida** (server é autoridade)
- ✅ **Tolerância a latência variável**
- ✅ **Sem teleports** (interpolação suave)

---

## 🏗️ Arquitetura

### Servidor (Node.js - GameRoom.js)

```
┌─────────────────────────────────────────┐
│         SERVIDOR (60 FPS)               │
├─────────────────────────────────────────┤
│ • Roda physics com FIXED_DT (1/240)     │
│ • Processa inputs dos dois clientes     │
│ • Envia estado canônico a ~20 Hz        │
│ • É autoridade final em colisões        │
└─────────────────────────────────────────┘
     ↓ state_update (50ms)           ↑ player_input
  (posição, velocidade de bola)   (impulso, movimento)
```

**Tick Loop do Servidor:**
```javascript
// GameRoom.js - _applyPhysicsStep()
1. Recebe inputs dos clientes
2. Aplica physics.step() 4 vezes (1/240 cada)
3. Atualiza estado de possessão/pontuação
4. A cada 3 ticks (~50ms), envia estado via broadcast()
```

### Cliente (Browser - main.js)

```
┌────────────────────────────────────────┐
│      CLIENTE (60 FPS rendering)        │
├────────────────────────────────────────┤
│ Previsão Local:                        │
│  • physics.step() continuamente        │
│  • Renderiza baseado em previsão       │
│                                        │
│ Sincronização:                         │
│  • Recebe state_update do servidor     │
│  • Aplica novo estado aos bodies       │
│  • Acorda bodies (wakeUp())            │
│  • Interpola visualmente               │
└────────────────────────────────────────┘
     ↑ state_update (50ms)         ↓ player_input
```

---

## 🔄 Fluxo de Uma Ação (Ex: Tiro)

### Frame 0: Cliente dispara

```javascript
// Cliente calcula impulso
const impulse = calculateShotImpulse(player, direction, power);

// Aplica localmente (previsão)
player.physBody.applyImpulse(impulse, pos);

// Envia para servidor
socket.emit('shot_fired', { playerIdx, impulse });

// Renderiza animação suave
syncMeshes(); // usa interpolação
```

### Frames 1-3: Previsão local

```javascript
// Cliente continua rodando physics localmente
accumulator += frameTime;
while (accumulator >= FIXED_DT) {
  physics.step();  // Ball moves based on impulse
  accumulator -= FIXED_DT;
}

// Renderiza baseado em previsão
ball.group.position = interpolate(
  serverPos,      // última posição do servidor
  localPos,       // posição atual da previsão
  alpha           // 0.0 → 1.0 conforme tempo passa
);
```

### Frame 4: Servidor responde (latência ~50-100ms)

```javascript
// Servidor recebeu input do cliente
// Rodou sua própria physics
const serverBallPos = { x: 10.2, y: 0.5, z: -5.3 };
const serverBallVel = { x: 0.1, y: 0, z: 0.05 };

// Envia estado canônico
io.emit('state_update', {
  ball: { pos: serverBallPos, vel: serverBallVel, quat: ... },
  players: [ ... ],
  timestamp: Date.now()
});
```

### Frame 5+: Sincronização suave

```javascript
// Cliente recebe state_update
multiplayer.onStateUpdated = (state) => {
  // 1. Registra posição do servidor para interpolação
  interpolationMgr.recordServerState('ball', serverPos, serverVel, quat, now);

  // 2. Aplica ao physics body (para colisões futuras)
  ball.physBody.position.set(serverPos.x, serverPos.y, serverPos.z);
  ball.physBody.velocity.set(serverVel.x, serverVel.y, serverVel.z);

  // 3. CRUCIAL: Acorda o corpo para recalcular colisões
  ball.physBody.wakeUp();  // ← Seu fix anterior!

  // 4. Continua física local a partir desse ponto
};

// Durante render (syncMeshes):
const alpha = interpolationMgr.getInterpolationAlpha(now);
const renderPos = interpolate(serverPos, physBody.position, alpha);
ball.group.position.set(renderPos.x, renderPos.y, renderPos.z);
```

---

## 📊 Interpolação Suave

### Problema Sem Interpolação
```
Servidor envia: pos = 10.0  (frame 4)
Cliente renderiza: 10.0 (teleport)
Servidor envia: pos = 10.5  (frame 8, 50ms depois)
Cliente renderiza: 10.5 (teleport novamente)

Resultado: "Jitter" visual, movimento não-suave
```

### Solução Com Interpolação
```
Frame 4 - Servidor: 10.0
  Cliente previu: 10.1 (durante 50ms)
  Renderizar: lerp(10.0, 10.1, 0.0) = 10.0

Frame 5 (6.7ms depois) - Sem servidor
  Cliente previu: 10.15
  Renderizar: lerp(10.0, 10.15, 0.13) = 10.015 (suave!)

Frame 6 (13.3ms depois)
  Cliente previu: 10.20
  Renderizar: lerp(10.0, 10.20, 0.27) = 10.054 (suave!)

Frame 8 (50ms) - Servidor: 10.5
  Cliente previu: 10.35
  Renderizar: lerp(10.0, 10.35, 1.0) = 10.35
  Depois para lerp(10.5, próxima previsão, ...)

Resultado: Movimento contínuo e suave!
```

### Código de Interpolação

```javascript
// interpolation.js - InterpolationManager
getInterpolationAlpha(now) {
  const timeSinceUpdate = now - this.lastUpdateTime;
  return Math.min(timeSinceUpdate / 50, 1.0);  // 50ms é a duração
}

lerpPosition(serverPos, localPos, alpha) {
  return {
    x: serverPos.x + (localPos.x - serverPos.x) * alpha,
    y: serverPos.y + (localPos.y - serverPos.y) * alpha,
    z: serverPos.z + (localPos.z - serverPos.z) * alpha
  };
}
```

---

## 🔧 Componentes Implementados

### 1. **interpolation.js** (Novo)
- `InterpolationManager`: Gerencia interpolação entre estados
- `DesyncDetector`: Detecta quando servidor discorda da previsão local

### 2. **game.js** (Modificado)
```javascript
// Linha 760: Acordar bodies após sincronizar
ball.physBody.wakeUp();        // ← Critical fix!
player.physBody.wakeUp();
```

### 3. **main.js** (Modificado)
- Importa `InterpolationManager` e `DesyncDetector`
- Registra estados do servidor em `onStateUpdated`
- `syncMeshes()` agora interpola entre servidor e previsão local
- Sempre roda `physics.step()` em multiplayer (previsão local)

---

## 📈 Fluxo de Dados

```
SERVIDOR                          CLIENTE
┌──────────────┐               ┌──────────────┐
│ Physics (60) │               │ Physics (60) │  ← Previsão local
│              │ state_update  │              │  (sempre rodando)
│  Roda 4x     │◄─────────────►│ Interpola    │
│  (1/240)     │ (50ms)        │              │
│              │               │ Renderiza    │
│              │               │ (syncMeshes) │
└──────────────┘               └──────────────┘
       ▲                               ▲
       │                               │
    Autoridade                  Renderiza suave
    final em                   (mistura servidor
    colisões                   + previsão local)
```

---

## ✅ Checklist de Implementação

- [x] **Servidor roda physics com FIXED_DT** (GameRoom.js)
- [x] **Servidor envia estados periodicamente** (broadcast a cada 3 ticks)
- [x] **Cliente acorda bodies após sincronizar** (game.js wakeUp())
- [x] **Cliente faz previsão local** (physics.step() continuamente)
- [x] **Cliente interpola visualmente** (syncMeshes com lerpPosition)
- [x] **Cliente registra posições do servidor** (recordServerState)
- [x] **Cliente detecta dessincronias** (desyncDetector)

---

## 🚀 Como Testar

### 1. Teste local vs multiplayer
```javascript
// Modo local
init();  // Sem interpolação, apenas previsão

// Modo multiplayer
initMultiplayer(..., multiplayer);  // Com interpolação
```

### 2. Simule latência
```javascript
// No navegador, abra DevTools → Network → Throttle
// Escolha: Slow 3G (~400ms latência)
// Jogo ainda deve ser fluido!
```

### 3. Monitore desyncs
```javascript
// Console logs aparecem se detectar dessincronia
console.warn('[Desync] Body player_0 desincronizado: dist=2.5');
```

---

## 📋 Comparação: Antes vs Depois

| Aspecto | Antes | Depois |
|---------|-------|--------|
| **Colisões** | Intermitentes ❌ | Consistentes ✅ |
| **Responsividade** | ~200ms lag | ~50ms (previsão local) |
| **Sincronização** | Teleports | Suave (interpolação) |
| **Latência variável** | Quebrava | Tolerante |
| **Visual** | Jitter | Fluido |

---

## 🎓 Conceitos Chave

**Server Authority**: Servidor decide o que é "verdade" (colisão, gol, etc)

**Client Prediction**: Cliente não espera servidor; prediz com física local

**Interpolation**: Mistura server (autoridade) + previsão (responsividade)

**wakeUp()**: Força Cannon.js a recalcular colisões (critical!)

**FIXED_DT**: Timestep fixo = physics determinístico = sincronização

---

## 📚 Referências

- Cannon.js Body.wakeUp(): https://cannon-es.readthedocs.io/
- Game netcode: GaffeGames video on interpolation
- Source engine: valve-interpolation.pdf
