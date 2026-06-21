# Gulliver — Regras do Jogo & Estado

Implementação completa das regras de Futebol de Botão no `game.js`.

---

## Estado Global (`game.js`)

```js
{
  // Placar
  scores: { yellow: 0, blue: 0 }

  // Posse & turnos
  possession: 'yellow' | 'blue'   // time com a bola
  touches: number                 // toques no turno atual (0–4)
  maxTouches: 4

  // Resolução de chute
  locked: boolean                 // true enquanto chute está resolvendo
  shooter: Player | null          // quem chutou por último
  lastTouchTeam: 'yellow' | 'blue' | null  // último a tocar a bola

  // Bola fora de jogo
  ballDead: boolean               // bola saiu do campo
  restartPending: { team } | null // janela de reposicionamento antes do reinício

  // Relógio
  half: 1 | 2
  timeLeft: number                // segundos (300 por tempo)
  paused: boolean                 // durante overlay
  matchEnded: boolean
}
```

---

## Fluxo da Partida

```
Kickoff (time amarelo)
    ↓
Chute → physics resolve → _resolveShot()
    ↓
Gol?     → flash → celebração → reset campo → posse do adversário
Lateral? → bola na linha → restartPending → reposicionamento → reinício
Escanteio/Tiro de meta → bola no lugar → restartPending → reposicionamento → reinício
Falta?   → bola no local → restartPending (time fouled) → reinício
    ↓
4 toques → troca de posse automática
    ↓
Fim do 1º tempo (timeLeft = 0) → Overlay intervalo
    ↓
2º tempo (kickoff time azul)
    ↓
Fim do 2º tempo → Overlay placar final → "Novo jogo"
```

---

## Regras de Posse & Toques

**Ao resolver um chute** (`_resolveShot()`):

| Situação | Resultado |
|----------|-----------|
| `lastTouchTeam === possession` | Toque válido → `touches++` |
| `touches >= 4` | Troca de posse, `touches = 0` |
| `lastTouchTeam !== possession` | Troca de posse (deflexão) |
| `lastTouchTeam === null` | Troca de posse (chute errou tudo) |

**Janela de reposicionamento do goleiro:**
- Disponível enquanto adversário tem posse
- Fecha no 3º toque do adversário (antes do 4º)
- Goleiro só pode ser arrastado (sem estilingue)
- Drag clamped à área pequena

---

## Saída de Campo & Reinícios

### Gol
- Condição: `|x| > HW` AND `|z| < GW/2 + 0.3`
- Flash amarelo na tela (1.5s)
- Reset completo: todas as peças + bola voltam à formação inicial
- Posse → time que levou o gol (kickoff)

### Lateral (saiu pela linha lateral)
- Condição: `|z| > HH`
- Awarded para o time que **não** tocou por último
- Bola volta na lateral, mesma posição X, ±HH em Z
- `restartPending = { team }` → time pode reposicionar 1 peça livremente

### Escanteio
- Condição: `|x| > HW` AND `|z| >= GW/2 + 0.3` AND defesa tocou por último
- Bola vai para a bandeirinha de escanteio correspondente
- `restartPending = { attacking_team }`

### Tiro de Meta
- Condição: `|x| > HW` AND `|z| >= GW/2 + 0.3` AND ataque tocou por último
- Bola vai para a borda da área pequena correspondente
- `restartPending = { defending_team }`

### Falta
- Condição: `shooter.piece` acertou peça adversária antes de tocar a bola
- Bola reposicionada no local da falta
- `restartPending = { fouled_team }`

### Fluxo de Reinício (todos os tipos exceto gol)
```
1. ballDead = true → bola posicionada no local do reinício
2. restartPending = { team } → HUD mostra status
3. Qualquer peça do time awarded → drag livre (modo reposição, sem impulso)
4. Ao soltar: restartPending = null → jogo retorna ao normal
5. Qualquer peça do time awarded pode chutar o reinício
```

---

## Detecção de Falta (`game.js`)

```
onPlayerHitPlayer(shooter, other):
  SE other.team !== shooter.team:
    SE lastTouchTeam === null:  // bola não foi tocada ainda no chute
      → FALTA: troca posse para other.team, reinício no local
```

---

## Interface de Regras (consumida pelo `input.js`)

```js
game.canDrag(piece)       // → bool: pode arrastar esta peça agora?
game.isReposition(piece)  // → bool: arrastar em modo livre (sem impulso)?
game.isOutOfBounds(piece) // → bool: peça está fora das linhas?
game.onShotFired(piece)   // callback: chute disparado
game.onReposition(piece)  // callback: reposicionamento concluído
```

**`canDrag` permite drag quando:**
- Bola não está morta (`ballDead = false`)
- Jogo não está travado (`locked = false`)
- É a vez do time da peça (`piece.team === possession`)
- OU: é o goleiro e a janela de reposicionamento está aberta

**`isReposition` retorna true quando:**
- É o goleiro do adversário
- `restartPending` está ativo para o time da peça
- A peça está fora do campo (drag de volta)

---

## Relógio

- `game.update(dt)` chamado toda frame com tempo real (não física)
- Continua rodando mesmo durante resolução de chute (`locked = true`)
- Pausa durante overlays (`paused = true`)
- `timeLeft` vai de 300 → 0 por tempo

```
timeLeft === 0 && half === 1  →  Intervalo (overlay), paused = true
timeLeft === 0 && half === 2  →  Fim de jogo, matchEnded = true
```

---

## Formações (`formations.js`)

Time com 11 peças cada (22 total):
- **4-3-3**: 1 goleiro + 4 defensores + 3 meias + 3 atacantes
- Posições espelhadas: time azul é `x * -1` do time amarelo
- Times ficam em lados opostos (amarelo: x > 0, azul: x < 0)
- Kickoff: amarelo começa no centro

---

## Mensagens de Status (PT-BR)

| Estado | Mensagem |
|--------|----------|
| Normal, posse própria | `"Clique e arraste uma peça"` |
| Reinício pendente | `"Reposicione uma peça"` |
| Goleiro reposicionando | `"Goleiro pode se mover"` |
| Chute resolvendo | `"Aguardando..."` |
| Falta | `"Falta! Aguardando..."` |
| Bola morta | `"Bola fora de jogo"` |
