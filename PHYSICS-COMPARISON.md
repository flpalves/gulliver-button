# Comparação: Física Cliente vs Servidor

## ✅ Como funciona NO CLIENTE (Offline)

### 1. Inicialização (physics.js)
```javascript
this.world = new CANNON.World();
this.world.gravity.set(0, 0, 0);              // ← GRAVIDADE GLOBAL = 0
this.world.broadphase = new CANNON.SAPBroadphase(this.world);
this.world.solver.iterations = 12;
FIXED_DT = 1/240 (4.166ms)                     // ← MUITO PEQUENO!
```

### 2. Configuração de Materiais
```javascript
friction: 0.6 (piece-piece)
friction: 2.0 (piece-floor)
restitution: 0.2 (piece-piece)
restitution: 0.65 (piece-floor)
```

### 3. Cada frame, no step() - Gravidade aplicada APENAS à bola
```javascript
if (b.isBall) {
  // Aplica gravidade MANUALMENTE
  b.force.y += b.mass * SPHERE_GRAVITY;  // SPHERE_GRAVITY = -45
  
  // Damping dinâmico
  if (b.position.y <= b.ballRadius * 1.15) {
    b.linearDamping = BALL_GROUND_DAMPING (0.82);  // no chão
  } else {
    b.linearDamping = BALL_LIN_DAMPING (0.2);      // no ar
  }
  
  // Spin calculado
  b.angularVelocity = (b.velocity / r) * spin_factor;
}

this.world.step(FIXED_DT);  // ← 1/240
```

### 4. Shot no modo LOCAL (input.js)
```javascript
// Pega o impulso que foi calculado
const impulse = { x: dir.x * impulseMag, y: 0, z: dir.z * impulseMag };

// ZERA velocidade do jogador
piece.physBody.velocity.set(0, 0, 0);

// APLICA impulso no JOGADOR (não na bola!)
piece.physBody.applyImpulse(
  new CANNON.Vec3(impulse.x, impulse.y, impulse.z),
  piece.physBody.position
);

// Notifica game sobre o shot
this.rules.onShotFired(piece, impulse);
```

---

## ❌ Como está NO SERVIDOR (GameRoom.js) - ERRADO!

```javascript
// ERRADO: Gravidade global aplicada!
this.gameState.physics.gravity.set(0, GRAVITY, 0);  // GRAVITY = -80 ← MUITO GRANDE!

// ERRADO: FIXED_DT muito grande
this.gameState.physics.step(TICK_DELTA, deltaTime, 3);  // TICK_DELTA = ?

// ERRADO: Sem gravidade manual na bola
// ERRADO: Sem damping dinâmico
// ERRADO: Sem spin calculado dinamicamente
```

---

## 🔧 O que PRECISA ser corrigido no servidor

1. **Gravidade global deve ser 0**
2. **Gravity aplicada APENAS à bola** (manualmente em cada step)
3. **FIXED_DT deve ser 1/240** (não qualquer outro valor)
4. **Damping dinâmico** baseado se bola está no chão ou no ar
5. **Spin calculado dinamicamente**
6. **Solver iterations = 12**
7. **Broadphase = SAPBroadphase**
8. **Mesmos materiais/friction/restitution**

---

## 📋 Checklist para corrigir

- [ ] Alterar gravidade global para 0
- [ ] Adicionar gravidade manual à bola em cada step
- [ ] Adicionar damping dinâmico
- [ ] Adicionar spin dinâmico
- [ ] Alterar FIXED_DT para 1/240
- [ ] Verificar solver iterations
- [ ] Verificar broadphase
- [ ] Verificar materiais (friction/restitution)

