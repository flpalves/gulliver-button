# Gulliver — Documentação Técnica

Simulador 3D de Futebol de Botão no browser. Física real via Cannon.js, renderização via Three.js, sem build step — ES6 modules puros.

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Renderização | Three.js r128 (CDN) |
| Física | Cannon.js 0.6.2 (CDN) |
| Linguagem | Vanilla JS — ES6 modules |
| Dev server | `npx serve -p 5500 .` |
| Build | Nenhum (browser carrega direto) |

Nenhum `package.json`. Dependências via CDN no `index.html`.

---

## Estrutura de Arquivos

```
gulliver/
├── index.html          # Shell HTML + HUD + overlays modais
├── css/style.css       # Estilos: HUD, canvas, botões, overlays
└── js/
    ├── main.js         # Entry point: init(), loop de animação, physics step
    ├── constants.js    # C = dimensões do campo, peças, cores
    ├── scene.js        # Setup Three.js: câmera, luzes, gerenciamento de vista
    ├── field.js        # Renderização: grama, marcações, gols, redes
    ├── player.js       # Classe Player (botão de campo + goleiro)
    ├── ball.js         # Classe Ball (esfera com física)
    ├── formations.js   # Setup dos times: formação 4-3-3, 22 peças total
    ├── physics.js      # Cannon.js world, bodies, collision groups
    ├── input.js        # Interação mouse: hover, mira de estilingue, arraste goleiro
    └── game.js         # Regras: posse, toques, gols, laterais, reinícios
```

---

## Arquitetura

```
main.js (orquestrador)
  ├─ physics.step()          → fixed timestep 1/240s
  ├─ syncMeshes()            → sincroniza Three.js ← Cannon bodies
  ├─ game.update(dt)         → relógio, reinícios pendentes
  └─ renderer.render()       → frame

Subsistemas (módulos independentes, comunicam via callbacks):
  physics.js   →  dispara onPlayerHitBall / onPlayerHitPlayer
  game.js      →  consome callbacks, atualiza estado
  input.js     →  consulta game.canDrag() / game.isReposition()
```

**Fluxo de dados:**
1. Física resolve colisões → dispara callback `onPlayerHitBall`
2. `game.js` atualiza `lastTouchTeam`, detecta gol/lateral
3. `input.js` checa `game.canDrag(piece)` antes de processar drag
4. `main.js` sincroniza posições visuais → renderiza

---

## Entidades & Modelos

### Player (`player.js`)
```js
class Player {
  team: 'yellow' | 'blue'
  isKeeper: boolean
  initPos: { x, z }         // posição inicial
  group: THREE.Group         // visual (rim + corpo + marcador)
  physBody: CANNON.Body      // corpo de física
  restY: number              // altura em repouso
  highlighted: boolean       // estado hover
}
```
- **Campo**: Cilindro (N=20 lados), massa 4 kg
- **Goleiro**: Box collider, massa 10 kg

### Ball (`ball.js`)
```js
class Ball {
  physBody: CANNON.Body      // esfera
  restY: number              // raio = 0.5
  group: THREE.Group
}
```
- Massa 0.15 kg, gravity −80 (só a bola tem gravidade), linearDamping 0.4

### Constantes de Campo (`constants.js`)
```js
C.FW = 105, C.FH = 68              // campo (metros)
C.GW = 7.32, C.GH = 2.44, C.GD = 3 // gol
C.SAW = 18.32, C.SAD = 5.5         // área pequena
C.BAW = 40.32, C.BAD = 16.5        // grande área
C.PLAYER_R = 2.0, C.PLAYER_H = 0.48
C.KEEP_W = 4.0, C.KEEP_D = 1.2
C.BALL_R = 0.5
C.COL_Y = 0xFFD700   // ouro (time amarelo)
C.COL_B = 0x87CEEB   // azul-céu (time azul)
```

### Physics World (`physics.js`)
```
Grupos de colisão (bitmask):
  GROUP.PLAYER   = 1    // peças de campo + goleiro
  GROUP.BALL     = 2    // bola
  GROUP.BALL_WALL= 8    // chão invisível (só impede deriva Z da bola)
  GROUP.FAR_WALL = 16   // paredes perimetrais fora de câmera

Materiais:
  matPiece:  friction 0.6, restitution 0.2  (peça ↔ peça)
  matFloor:  friction 2.0, restitution 0.65 (bola ↔ chão)
```

---

## Loop Principal (`main.js`)

```js
function animate(now) {
  frameTime = Math.min((now - lastFrameTime) / 1000, 0.1)
  accumulator += frameTime

  // Física: fixed timestep
  while (accumulator >= PHYS.FIXED_DT) {  // PHYS.FIXED_DT = 1/240
    physics.step()
    accumulator -= PHYS.FIXED_DT
  }

  syncMeshes()              // visual ← physics
  game.update(frameTime)    // relógio + estado
  renderer.render(scene, camera)
}
```

Fixed timestep em 1/240 s evita tunneling em chutes com alto impulso.

---

## Física — Comportamentos Especiais

**Spin da bola** (derivado manualmente, Cannon não gera):
```js
ω = (up × v) / r   // a cada step
```

**Bola salta no impacto** — nudge de velocidade vertical proporcional ao impacto, gravidade traz de volta.

**Peças não têm gravidade** — deslizam no plano (velocidade Y sempre zero).

**Filtro de colisão durante reposicionamento** — mask = 0 (peça fantasma, passa por tudo).

---

## Input / Mecânica de Estilingue (`input.js`)

**Dois modos de drag:**

| Modo | Trigger | Comportamento |
|------|---------|--------------|
| `'shot'` | Peça do time com posse, jogo normal | Aplica impulso ao soltar; linha de mira verde→vermelho |
| `'reposition'` | Goleiro adversário, reinício pendente | Arraste livre sem física; peça levanta `DRAG_LIFT=4` unidades |

**Shot:**
- `t = dragDistance / MAX_DRAG`
- `impulse = t × MAX_IMPULSE`
- Drag mínimo de 0.4 unidades para registrar

**Reposition clamps:**
- Goleiro: clamped à área pequena
- Reinício: sem clamp (pode posicionar em qualquer lugar)

---

## HUD (`index.html`)

```
┌─────────────────────────────────────────────────┐
│  🟡 0 × 0 🔵  │ Tempo │ Posse │ Toques │ Status │
└─────────────────────────────────────────────────┘
```

- **Timer**: `"1T 05:00"` / `"2T 03:45"` (minutos decrescentes)
- **Posse**: `"🟡 Amarelo"` / `"🔵 Azul"`
- **Toques**: `"2 / 4"`
- **Status**: mensagens de gameplay em PT-BR

Overlays (modal fullscreen): Intervalo / Fim de Jogo — classes CSS `.on`

---

## Câmera (`scene.js`)

Câmera ortográfica com dois modos:

| Modo | Ângulo | Uso |
|------|--------|-----|
| Top-down | 0° (direto acima) | Visão táticas |
| Isométrico | 22° inclinado | Perspectiva 3D leve |

Construção manual da base da câmera (evita instabilidade do `lookAt` em ângulo 0):
```js
right    = (1, 0, 0)
backward = (0, cos t, sin t)
up       = backward × right
```

---

## Como Rodar

```bash
npx serve -p 5500 .
# http://localhost:5500
```

Sem instalação, sem build. Editar `.js` → refresh no browser.
