# Handoff — Futebol de Botão 3D

> Cole este arquivo (ou peça pra ler `HANDOFF.md`) no início de uma nova sessão
> para retomar o projeto exatamente de onde parou.

## O que é o projeto

Jogo de Futebol de Botão em 3D, jogado no navegador. Visão de cima (estilo
mesa de botão), peças deslizam ao serem "estiladas" (clique + arraste = puxar
e soltar, como um estilingue) e colidem com a bola.

Stack: **Three.js r128** (render) + **Cannon.js 0.6.2** (física), carregados
via CDN. Sem build step, sem framework — JS puro com ES Modules.

## Estrutura de arquivos (já modularizada)

```
index.html          shell HTML + HUD + overlay de intervalo/fim de jogo
css/style.css        todo o CSS
js/constants.js      C = constantes de campo/peças/cores
js/scene.js           câmera ortográfica, luzes, toggle de view (top/iso)
js/field.js           grama, marcações, gols
js/player.js          classe Player (peça de jogador ou goleiro)
js/ball.js            classe Ball
js/formations.js      gera as 22 peças em 4-3-3, espelhado
js/physics.js         Physics: mundo Cannon, paredes, colliders, step()
js/input.js           InputHandler: hover + clique-arrasta (estilingue)
js/game.js            ⚠️ AINDA É SÓ PLACEHOLDER (ver abaixo)
js/main.js            init() + loop de animação (fixed-step physics)
.claude/launch.json   roda `npx serve -p 5500 .`
```

Não existe mais um único `index.html` monolítico — isso é resultado de uma
refatoração feita ao longo do projeto. Qualquer instrução antiga que mencione
"tudo em um arquivo `index.html`" está desatualizada.

## Roadmap original (6 partes)

1. ✅ Campo (grama, marcações, gols) — `field.js`
2. ✅ Classes Player/Ball + formação 4-3-3 — `player.js`, `ball.js`, `formations.js`
3. ✅ Física (Cannon.js: paredes, colliders, fricção/restituição, "all at rest") — `physics.js`
4. ✅ Input por estilingue (clique+arraste, força máx., highlight de hover) — `input.js`
5. ✅ `Game` (`js/game.js`): turnos, posse de bola, contador de toques (4 por
   posse), troca de posse ao errar (chute que não toca a bola = turnover
   imediato) ou ao completar o 4º toque, janela de reposicionamento do
   goleiro (aberta enquanto o adversário tem posse e `touches < 3`), trava
   novas jogadas (`locked`) até `physics.allAtRest()`.
6. ✅ Gol (flash + placar + reinício), saída de bola (lateral, tiro de meta,
   escanteio) com reinício via estilingue, cronômetro (2×5 min, overlays de
   intervalo/fim) — `js/game.js`.

**Próximo passo natural: revisão final contra os critérios de aceitação
originais (ver item 2 em "Pendências" abaixo).**

## Como funciona `js/game.js` (Parte 5)

`Game` é construído em `main.js` com `{ players, ball, physics }` e passado
como segundo argumento (`rules`) para `new InputHandler(players, game)`.
`InputHandler` delega toda decisão de jogo a essa interface:

- `game.canDrag(piece)` — peça de campo: só se for do time com `possession` e
  não houver jogada travada (`locked`). Goleiro: só o goleiro do time que
  **não** tem a posse, e só enquanto `touches < 3` (antes do 4º toque do
  adversário).
- `game.isReposition(piece)` — `true` para goleiros: eles nunca dão
  estilingue, só são arrastados livremente (sem impulso) dentro da pequena
  área do próprio time — clamp feito em `InputHandler._clampKeeper()`.
- `game.onShotFired(piece)` — chamado por `InputHandler._onUp()` após aplicar
  o impulso. Trava o jogo (`locked = true`) e zera `ballTouchedThisShot`.
- `physics.onPlayerHitBall` (hook novo em `physics.js`, setado pelo `Game`) —
  disparado pelo listener `collide` da bola; se o corpo que bateu é o do
  `shooter` atual, marca `ballTouchedThisShot = true`.
- `game.update()` — chamado a cada frame em `main.js` (depois de
  `syncMeshes()`). Enquanto `locked` e `physics.allAtRest()`, resolve a
  jogada: toque válido incrementa `touches` (troca posse se chegar a 4);
  chute que não tocou a bola troca a posse na hora, com `touches` voltando a 0.

HUD (`#poss-val`, `#touch-val`, `#status-val`) é atualizado em
`Game._updateHUD()` a cada resolução de jogada.

## Decisões de design e armadilhas já resolvidas (não refazer)

- **Câmera**: duas visões alternáveis via botão `#cam-toggle-btn` — top-down
  puro (`CAM_TILT_TOP = 0`) e isométrica leve (`CAM_TILT_ISO = 22°`),
  controladas por `camTilt` em `scene.js`. A câmera é construída com uma base
  explícita (`right`, `up`, `backward` + `makeBasis`) em vez de `camera.lookAt()`,
  porque `lookAt()` é instável/degenerado quando view-direction é paralela ao
  up vector (caso top-down puro) — causava espelhamento esquerda/direita
  aleatório. Já foi corrigido também um bug de "visão de cabeça para baixo"
  (sinal errado do componente Y do `up`).
- **Cannon.js 0.6.2 `CANNON.Cylinder`**: nesta build específica, o eixo de
  simetria do cilindro é local **Z**, não Y — diferente do que a doc sugere.
  O collider do jogador (peça redonda) é rotacionado -90° em X via
  `body.addShape(shape, offset, shapeQuat)` para compensar. Note também que
  `CANNON.Quaternion.prototype.setFromAxisAngle` muta `this` e retorna
  `undefined` nesta build — nunca encadear em `new CANNON.Quaternion().setFromAxisAngle(...)`,
  sempre em duas linhas.
- **Collider mais alto que a peça visual** (`COL_H = 6` em `physics.js`): a
  bola tem raio relativamente grande comparado à altura real da peça (0.48),
  então um collider raso deixava a bola "passar por cima" da borda e gerar
  normal de contato vertical (lançando a bola pra cima). O collider invisível
  é bem mais alto que a peça (mas `body.position.y` continua na altura visual
  real), forçando todo contato a ocorrer na parede lateral.
- **`FIXED_DT = 1/240`**: necessário porque com impulsos fortes (`MAX_IMPULSE`
  alto) um passo de 1/60 deixava a bola atravessar peças sem detectar colisão
  (tunneling).
- **`INPUT.MAX_IMPULSE = 100`** em `input.js` — valor intencionalmente alto
  (tuning de "force feel"). Não reverter para um valor menor sem o usuário
  pedir explicitamente.
- **Gravidade só na bola** (`PHYS.BALL_GRAVITY = -14`) + chão exclusivo da
  bola (`GROUP.BALL_WALL`): jogadores não têm gravidade (são botões deslizando
  numa mesa plana), mas a bola pode ganhar velocidade vertical residual de
  contatos e precisa de gravidade+piso pra não "flutuar" indefinidamente.
- **Spin da bola é manual**: esta build de Cannon não gera torque de fricção
  em esfera-esfera nem levanta a bola sozinha num toque — ambos os efeitos
  (rolling spin e "hop" vertical proporcional ao impacto) são simulados à mão
  em `physics.js` (`step()` e o listener `collide` em `addBallBody`).

## Grupos de colisão (`GROUP` em physics.js)

```
PLAYER = 1, BALL = 2, BALL_WALL = 8, FAR_WALL = 16
```
**Não existe mais parede bem na linha do campo** (ver "Parte 7" abaixo) —
jogadores e bola saem livremente dos limites lógicos do campo, e isso é
tratado posicionalmente em `Game`, não por contenção física. `BALL_WALL` é o
piso invisível que pega deriva vertical da bola (ver `PHYS.BALL_GRAVITY`);
jogadores não colidem com ele. **Mas existe sim uma parede física bem mais
afastada** — `FAR_WALL` (ver "Parte 8" abaixo), posicionada na borda do que a
câmera mostra (`Physics.setFarWalls`), que impede jogador/bola de saírem da
área visível depois de um chute forte.

## HUD já existe no HTML, só falta ligar ao estado real

- `#sy` / `#sb` — placar amarelo/azul
- `#timer-val` — "1T 05:00" etc.
- `#poss-val` — "🟡 Amarelo" / time com posse
- `#touch-val` — "0 / 4"
- `#status-val` — mensagens de status (hoje mostra "Parte 4 — clique e arraste para cima")
- `#overlay` / `#otitle` / `#osub` / `#osy` / `#osb` / `#obtn` — modal de
  intervalo/fim de jogo, já com listener de clique ligado a
  `game.handleOverlayBtn()` (hoje só fecha o overlay)
- `#gflash` — flash amarelo de tela cheia ao marcar gol (CSS já pronto, classe `.on`)

## Como testar localmente

```
npx serve -p 5500 .
```
(ou usar a config já existente em `.claude/launch.json`)

No fluxo de trabalho anterior, bugs de física/câmera foram diagnosticados com
`preview_eval` (inspecionando `physics.world.contacts`, vértices de shapes,
projeção NDC da câmera etc.) e não só com screenshots — vale manter esse
rigor ao implementar Parte 5/6, especialmente para a lógica de toques/posse
(fácil de ter off-by-one ou de não resetar corretamente entre posses).

## Pendências / próximos passos sugeridos

1. Revisão final contra os 10 critérios de aceitação originais do projeto
   (não estão listados neste handoff — se necessário, perguntar ao usuário
   ou procurar registro anterior da conversa).

## Decisões de design tomadas na Parte 8 (não redefinir sem o usuário pedir)

- **Peça fora de campo continua jogável sem precisar voltar pra dentro**
  (`Game.isReposition` em `game.js`): antes, `isReposition` checava
  `isOutOfBounds(piece)` **primeiro** e retornava `true` incondicionalmente —
  então qualquer peça fora das linhas só podia ser reposicionada livremente
  (sem estilingue), nunca chutada de fato, mesmo estando na vez do seu
  próprio time. Trocado por uma ordem de checagem diferente: primeiro vê se a
  peça seria normalmente elegível pra dar um chute agora mesmo (não tá
  `locked`/`paused`/`matchEnded`/`restartPending`, e é a vez do time dela) —
  se sim, `isReposition` retorna `false` (modo `'shot'`, com linha de
  pontaria e impulso normais) mesmo que ela esteja fora do campo. Só cai no
  modo `'reposition'` (arrasto livre, sem impulso) quando **não** seria
  elegível pra chutar de qualquer forma (ex.: peça do time adversário fora de
  campo, que pode ser arrastada de volta por qualquer um sem contar como
  jogada) — nesse caso ainda preserva o comportamento antigo de "arrastar
  peça perdida de volta". `canDrag` não mudou (continua liberando arrastar
  qualquer peça fora de campo, a qualquer momento, pra poder corrigi-la ou
  agora também chutá-la). Validado via `preview_eval` com `MouseEvent` real:
  peça amarela fora de campo, na vez do amarelo, entrou em `dragMode:
  'shot'` (linha de pontaria visível) e o `mouseup` disparou um impulso real
  (`game.locked` virou `true`, velocidade não-zero aplicada) sem nunca ter
  sido arrastada de volta pra dentro das linhas.
- **Parede física no limite da câmera** (substitui a margem dinâmica da
  câmera — ver bullet superado acima): pedido explícito do usuário de
  recriar uma "barreira invisível como a que existia", só que agora bem mais
  afastada — na borda do que a câmera mostra, não na linha do campo.
  - `scene.js`: a margem da câmera deixou de ser dinâmica (`extraMargin`/
    `setExtraMargin` removidos por completo) e voltou a ser fixa, só que bem
    maior (`MARGIN = 30`, era `BASE_MARGIN = 9`) — generosa o suficiente pra
    dar espaço real de "fora de campo" sem precisar crescer em tempo real,
    já que agora é a parede física que limita até onde algo pode ir, não a
    câmera tentando perseguir a peça mais distante. `viewHalfX`/`viewHalfZ`
    (extents em coordenadas de mundo do que a câmera mostra agora) e
    `onViewChange(fn)` foram adicionados como API pública pra quem precisar
    saber/reagir ao tamanho atual da visão (ver uso em `main.js` abaixo) —
    atualizados toda vez que `makeOrthoCamera()` roda (resize e toggle
    top-down/isométrico).
  - `physics.js`: novo grupo de colisão `GROUP.FAR_WALL = 16` (adicionado ao
    `collisionFilterMask` de jogadores e bola). `Physics.setFarWalls(halfX,
    halfZ)` (re)constrói 4 paredes invisíveis (boxes estáticos) formando um
    perímetro a `WALL_BUFFER` unidades **dentro** da borda informada —
    `WALL_BUFFER = 2.5 * 2 * (C.PLAYER_R + C.PLAYER_RIM)` (~11.25, ou seja,
    "cerca de 2,5x o tamanho do jogador", conforme pedido), pra que a peça
    pare visivelmente antes da borda literal do frustum, nunca cortada pela
    metade. É chamado uma vez em `main.js` logo após criar `Physics` (com os
    `viewHalfX/viewHalfZ` que `initThree()` já calculou) e de novo a cada
    `onViewChange` (resize, toggle de câmera) — mantendo a parede sempre
    alinhada com o que está de fato visível.
  - Validado via `preview_eval`/`CANNON.Vec3`: aplicado um impulso enorme
    (4000) num jogador a partir do centro do campo, registrando a posição X
    máxima atingida a cada passo de física — o jogador parou pouco antes da
    parede (ex.: `maxX ≈ 110.1` contra uma parede em `x ≈ 112.9`), nunca a
    ultrapassando, e voltou quicando pra dentro (restituição normal de
    peça-peça, já que a parede usa `matPiece`).
  - Esse limite agora também é, na prática, o "campo de jogo total" — a
    janela de arrasto do mouse (`_groundPoint()`, limitado pelo frustum da
    câmera) e o limite físico de qualquer chute coincidem, então não existe
    mais a situação de "consigo arrastar pra um lugar que um chute não
    alcançaria" ou vice-versa.

## Decisões de design tomadas na Parte 7 (não redefinir sem o usuário pedir)

- **Removidas as paredes de perímetro** (`physics.js`): `_buildWalls()` agora
  só cria o piso invisível (`GROUP.BALL_WALL`, pega deriva vertical da bola).
  Jogadores e bola podem sair fisicamente dos limites do campo — não há mais
  contenção física, só lógica. `GROUP.PLAYER_WALL` foi removido por completo
  (era código morto depois da mudança), assim como `matWall`,
  `PHYS.RESTITUTION_WALL`/`FRICTION_WALL` e o helper `_addWall()`.
  `floor` ficou maior (`FLOOR_MARGIN = 80` em vez do antigo `m=14`) porque a
  bola agora pode voar bem mais longe do campo antes do reinício (ver abaixo).
- **Bola: reinício com atraso de 1s** (`Game.RESTART_DELAY_MS = 1000`): ao
  detectar saída de bola por lateral/escanteio/tiro de meta (não gol — gol
  continua com seu próprio fluxo de `GOAL_CELEBRATION_MS`), `_checkOutOfPlay`
  captura o ponto exato de saída (`x, z` no instante em que cruzou a linha) e
  chama `_scheduleRestart(fn)`, que trava o jogo (`locked = true`), mostra
  status "Bola fora de campo..." e só executa `_onByline`/`_onThrowIn` (que
  fazem o `_placeBallAndRestart`) depois de `setTimeout(fn, RESTART_DELAY_MS)`.
  Nesse intervalo a bola continua livre, podendo deslizar/quicar bem fora do
  campo antes de ser teleportada de volta pra linha exata por onde saiu.
- **Aviso de jogador fora de campo**: como não há mais parede física para
  jogadores, uma peça pode ser empurrada/arrastada além das linhas. `Game`
  guarda `_isOutOfBounds(piece)` (`|x| > C.HW || |z| > C.HH`, lido direto de
  `piece.physBody.position`) e:
  - `canDrag`/`isReposition` checam isso **antes** de qualquer outra regra —
    uma peça fora do campo pode ser arrastada de volta pelo próprio time a
    qualquer momento, mesmo com `locked = true` (jogada resolvendo, gol
    acontecendo, restart pendente etc.). É reposição livre (sem impulso),
    igual ao mecanismo já usado pro goleiro e pra cobrança de reinício —
    `InputHandler._updateReposition` usa `_clampField` nesse caso (não
    `_clampKeeper`), então arrastar de volta já a prende dentro das linhas.
  - `Game._checkPlayersOutOfBounds()` (chamado a cada frame em `update()`)
    é só uma sinalização de HUD: se alguma peça está fora, mostra
    "⚠️ Jogador fora de campo — arraste-o de volta para o tabuleiro" em
    `#status-val`; quando nenhuma peça está mais fora, restaura o status
    normal via `_updateHUD()`. Usa a flag `_wasOutOfBounds` só pra não
    chamar `_setStatus`/`_updateHUD` toda hora sem necessidade.
  - Esse aviso pode ser sobrescrito no mesmo frame por outro `_setStatus`
    (ex.: "Bola fora de campo...") já que `_checkOutOfPlay` roda antes de
    `_checkPlayersOutOfBounds` em `update()` — não é uma fila de prioridade,
    é só "o que rodou por último nesse frame". Não houve pedido do usuário
    pra resolver esse conflito de prioridade; ajustar se for um problema na
    prática.

- **`_clampField` removido por completo** (não só pulado pra peças "stray"):
  mesmo depois da câmera dinâmica e da suspensão de colisão, o usuário ainda
  via uma "barreira invisível" ao reposicionar — porque a primeira correção
  só liberava o clamp quando a peça **já estava** fora do campo no instante
  em que o drag começava (`this.dragStray`). Reposicionar deliberadamente
  uma peça que começa **dentro** do campo (ex.: durante a cobrança de
  lateral/escanteio/tiro de meta, `restartPending`) continuava clampada pra
  dentro das linhas via `_clampField`. Removido o método inteiro e toda a
  ramificação por `dragStray` — agora `_updateReposition` só clampa o
  goleiro defensivo (`_clampKeeper`, regra de jogo deliberada); qualquer
  outro reposicionamento livre (cobrança de reinício ou ajuste de peça já
  fora) segue o cursor sem limite nenhum, dentro ou fora do campo.
  **Armadilha de teste**: validar isso via `preview_eval` simulando eventos
  reais de mouse (`dispatchEvent(new MouseEvent(...))`) só funciona se a
  malha visual (`piece.group.position`) estiver sincronizada com o corpo de
  física — e como `document.hidden = true` pausa o `requestAnimationFrame`
  nesta sessão (ver caveat de testes na Parte 6), setar só
  `physBody.position` direto deixa `group.position` desatualizado, o que
  faz o raycast de `_pieceAt()` errar a peça e o "drag" nem começar
  (`dragMode` fica `null`) — parecendo um bug que na verdade é só a malha
  visual não ter sido sincronizada. Sempre espelhar manualmente
  `group.position.x/z = physBody.position.x/z` antes de simular cliques
  nesse ambiente de teste específico.
- **[SUPERADO — ver "Parede física no limite da câmera" na Parte 8 abaixo]**
  **Câmera com margem dinâmica** (`scene.js`: `BASE_MARGIN = 9`,
  `extraMargin` mutável, `setExtraMargin(m)`; `main.js`: `strayMargin()`
  chamado a cada frame): a primeira tentativa de permitir reposicionar uma
  peça fora do campo (`_clampField` removido só para esse caso) não
  resolvia o problema de fato — o `_groundPoint()` do drag depende de um
  raycast contra o plano do chão *limitado pelo frustum da câmera atual*; o
  mouse fisicamente não alcança (em coordenadas de mundo) nada além do que a
  câmera mostra. Com `BASE_MARGIN = 9` fixo, um chute forte (`MAX_IMPULSE =
  100`, `LIN_DAMPING = 0.55`) pode levar uma peça ~30 unidades além da linha
  antes de parar — bem mais do que os 9 de margem visível, então a peça
  ficava "fora de alcance" do mouse mesmo sem nenhum clamp de código.
  Resolvido tornando a margem da câmera dinâmica: `main.js` calcula a cada
  frame (`strayMargin()`) o quanto a peça/bola mais distante está além das
  linhas (`+4` de respiro) e chama `scene.setExtraMargin(extra)`, que só
  reconstrói a câmera (`refreshCamera()`) se a mudança for relevante (> 0.5
  unidade, pra não disparar rebuild todo frame por ruído). Em jogo normal
  (nada fora) `extraMargin` fica em 0 e a câmera permanece no enquadramento
  original; só dá zoom-out quando há de fato algo pra resgatar fora do
  campo, e volta ao normal assim que tudo está dentro de novo.
- **Peça totalmente suspensa durante reposicionamento livre** (não só sem
  tocar a bola — sem tocar em **nada**, incluindo outras peças): além de
  zerar `collisionFilterMask` (agora `= 0`, não só excluindo `GROUP.BALL`)
  no início do drag (`InputHandler._onDown`, modo `'reposition'`), a peça
  também é elevada visual e fisicamente (`INPUT.DRAG_LIFT = 4`): tanto
  `piece.physBody.position.y` quanto `piece.group.position.y` (que
  `main.js`'s `syncMeshes()` não sobrescreve — só sincroniza X/Z dos
  jogadores) vão para `restY + DRAG_LIFT` / `DRAG_LIFT`. No `_onUp`, ambos
  voltam ao normal (`restY` / `0`) e a máscara volta a
  `GROUP.PLAYER | GROUP.BALL`, antes de `rules.onReposition(piece)`. Pedido
  explícito do usuário ("a peça não toque em nada... fique ACIMA das
  demais"). Validado via `preview_eval`: arrastei um goleiro repetidamente
  por cima da bola e de outro jogador, confirmando que ambos ficaram com
  posição/velocidade inalteradas durante o drag inteiro.
- **[SUPERADO — ver "`_clampField` removido por completo" mais abaixo]**
  Primeira tentativa: `InputHandler` calculava `this.dragStray =
  rules.isOutOfBounds(piece)` no `_onDown` e só pulava `_clampField` quando
  a peça já estava fora *antes* do drag começar. Não resolveu o problema
  todo (reposicionar deliberadamente uma peça que começa dentro do campo,
  ex. cobrança de reinício, continuava clampada) — `_clampField` e
  `dragStray` foram removidos por completo depois. Ainda válido desse
  histórico: `Game._isOutOfBounds` foi renomeado para `Game.isOutOfBounds`
  (sem `_`) porque passou a ser chamado externamente, fazendo parte da
  interface de regras (`canDrag`/`isReposition`/`isOutOfBounds`) — essa
  parte permanece.
- **Peça "suspensa" durante reposicionamento livre** (`InputHandler._onDown`/
  `_onUp` em `input.js`): qualquer arrasto em modo `'reposition'` (goleiro,
  cobrança de reinício, ou puxar uma peça de volta pro campo) zera
  temporariamente `piece.physBody.collisionFilterMask` para `GROUP.PLAYER`
  (perde a bola do mask) ao entrar no drag, e restaura para
  `GROUP.PLAYER | GROUP.BALL` ao soltar (`_onUp`), antes de chamar
  `rules.onReposition(piece)`. Sem isso, arrastar a peça por cima da bola
  durante o reposicionamento contava como um toque "de graça", fora das
  regras de estilingue — pedido explícito do usuário nesta sessão. Validado
  via `preview_eval` arrastando um goleiro repetidamente por cima da posição
  da bola (`physics.step()` a cada passo) e confirmando velocidade/posição
  da bola inalteradas durante o drag, e voltando a colidir normalmente após
  o release.

## Decisões de design tomadas na Parte 6 (não redefinir sem o usuário pedir)

- Detecção de bola fora de jogo é feita todo frame em `Game._checkOutOfPlay()`
  (não só quando `locked`), lendo `ball.physBody.position` direto — usa um
  guard `ballDead` pra não disparar duas vezes a mesma saída enquanto o
  reinício ainda não foi posicionado.
- **Gol**: `|x| > C.HW` e `|z| < C.GW/2 + 0.3` (margem pra não exigir o centro
  exato da bola dentro da trave). Time que marca = lado em que a bola cruzou
  (`x > 0` → amarelo, já que amarelo ataca o gol em `+HW`; azul defende lá).
  Ao marcar: trava o jogo (`locked = true`), placar incrementa, `#gflash` liga
  por 600 ms, e após 1.5 s (`GOAL_CELEBRATION_MS`) todas as peças e a bola
  voltam pra formação inicial (`Player.reset()`/`Ball.reset()`) com posse pro
  time que **sofreu** o gol (saída de bola padrão do futebol).
- **Saída lateral/linha de fundo**: não há colliders físicos nas traves/gols
  (só visual em `field.js`), então a saída é detectada pela posição lógica
  cruzando a linha, não por colisão. Lateral (`|z| > C.HH`) dá posse ao
  adversário do último time que tocou a bola (`Game.lastTouchTeam`); se
  nenhum time tocou ainda (`null`), mantém a posse atual como fallback.
  Saída pela linha de fundo fora da trave (`|x| > C.HW` e fora da faixa do
  gol) decide entre escanteio (se quem tocou por último foi o time que
  defende aquele lado) ou tiro de meta (se foi o time atacante) — ver
  `Game._onByline()`.
- **Reposicionamento da bola no reinício (lateral/escanteio/tiro de meta)**:
  a bola volta **exatamente** para o ponto da linha por onde saiu — `pz =
  ±C.HH` (mesmo X de saída) no lateral, `px = ±C.HW` (mesmo Z de saída) no
  escanteio/tiro de meta — em vez de um ponto fixo (bandeira de escanteio,
  marca da pequena área etc.). Decisão tomada explicitamente pelo usuário
  nesta sessão, substituindo o comportamento anterior (que usava pontos
  fixos com -0.5 de inset).
- **Reposicionamento livre de peça para cobrança** (`Game.restartPending =
  { team }`, setado em `_placeBallAndRestart`): depois que a bola é colocada
  na linha, o time premiado pode arrastar **qualquer** peça sua livremente
  (sem física de impulso) pra qualquer ponto do campo antes de cobrar —
  reaproveita o mecanismo de "reposition" do goleiro (`canDrag`/
  `isReposition` em `game.js` checam `restartPending` antes da regra normal).
  Ao soltar essa peça (`InputHandler._onUp` → `rules.onReposition(piece)`),
  a janela se fecha (`restartPending = null`) e o jogo volta ao fluxo normal
  de estilingue (qualquer peça do time, inclusive a que acabou de ser
  reposicionada, pode agora dar o chute). Não é obrigatório usar a janela:
  ela só fecha quando uma peça é efetivamente arrastada e soltada.
  `InputHandler._updateReposition` agora distingue dois clamps: a área
  pequena do goleiro defensivo (`_clampKeeper`, só quando `piece.isKeeper &&
  piece.team !== rules.possession`) e um clamp de campo inteiro
  (`_clampField`, margem de `C.PLAYER_R` pra manter a peça dentro das linhas)
  pra qualquer outro caso de reposição livre, incluindo a cobrança de
  reinício.
- **Cronômetro**: roda em `Game.update(dt)`, decrementando `timeLeft` por
  tempo real de frame (não pelo passo fixo da física) sempre que `!paused &&
  !matchEnded` — continua contando mesmo com `locked = true` (jogada
  resolvendo). Ao zerar no 1º tempo, abre overlay de intervalo (`paused =
  true`, `locked = true`); ao zerar no 2º tempo, marca `matchEnded = true` e
  abre overlay de fim de jogo com botão "Novo jogo" em vez de "Continuar".
  `main.js` passa o `frameTime` (já clampado a 0.1 s) do loop de animação
  pra `game.update()`.
- `handleOverlayBtn()` agora ramifica: se `matchEnded`, chama `_fullReset()`
  (zera placar, peças voltam pra formação, posse pro amarelo); senão, reseta
  `timeLeft` pra 5 min e dá kickoff pro adversário de quem tinha a posse no
  momento (não houve pedido explícito de regra de lado/kickoff pro 2º tempo —
  ajustar se o usuário quiser outra convenção, ex.: trocar lados de campo).
- Validado via `preview_eval` chamando `game.update()`/manipulando
  `ball.physBody.position` direto, **não** via screenshot — o browser de
  preview ficou com `document.hidden = true` nesta sessão, o que pausa
  `requestAnimationFrame` no `main.js` (e trava `preview_screenshot`). Se
  isso se repetir, testar a lógica de jogo chamando `game.update(dt)`
  manualmente via eval em vez de depender do loop real.

## Decisões de design tomadas na Parte 5 (não redefinir sem o usuário pedir)

- Cada disparo (estilingue) do time com a posse conta como 1 toque, acerte
  ou erre a bola.
- A posse só é mantida se o **último** jogador a tocar a bola durante a
  resolução da jogada (`Game.lastTouchTeam`, atualizado a cada colisão
  bola↔jogador via `physics.onPlayerHitBall`) for do time que já tinha a
  posse. Isso cobre dois casos com a mesma regra:
  - Disparo que **não toca a bola** (`lastTouchTeam` continua `null`) → turnover
    imediato, mesmo antes do 4º toque.
  - Disparo que toca a bola, mas ela é **desviada por último em peça
    adversária** (ex.: bate no próprio jogador e depois bate/para em um
    jogador do outro time) → turnover imediato, mesmo que o time da posse
    tenha sido quem iniciou o toque (regra de negócio pedida explicitamente
    pelo usuário nesta sessão).
  Em ambos os casos `touches` volta a 0 e a posse troca de time.
- O reposicionamento do goleiro é um arrasto livre (sem física de impulso,
  `InputHandler._updateReposition`) e só é permitido enquanto o time
  adversário está com a posse e `touches < 3` — a janela fecha assim que o
  3º toque é banked, pois o próximo disparo seria o 4º (decisão tomada com o
  usuário via pergunta direta nesta sessão).
- O goleiro nunca dá estilingue — `Game.isReposition()` retorna `true` para
  qualquer peça `isKeeper`.
- A área de arrasto do goleiro é limitada à pequena área do próprio time
  (`InputHandler._clampKeeper`, usa `C.SAD`/`C.SAW`/`C.KEEP_D`/`C.KEEP_W`) —
  escolha de design da implementação, não veio de spec explícita do usuário;
  ajustar se o usuário quiser outro limite (ex.: área grande, ou sem limite).
