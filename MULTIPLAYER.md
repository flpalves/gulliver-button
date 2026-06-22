# Plano: Modo Multiplayer Online — Gulliver (Futebol de Botão)

## Contexto

O Gulliver é um simulador 3D de futebol de botão que roda 100% no browser (Three.js + Cannon.js, sem bundler). Atualmente dois jogadores compartilham o mesmo dispositivo, alternando o controle de seus times. O objetivo é permitir que cada equipe jogue **de seu próprio dispositivo**, conectados pela internet em tempo real.

O jogo já é **por turnos** (posse alterna a cada 4 ou 12 toques), o que simplifica muito o multiplayer: em vez de sincronizar físicas frame-a-frame, basta sincronizar **na fronteira dos turnos** (quando um chute é disparado e quando a física para).

---

## Arquitetura

**Backend relay via Socket.io + estado autoritativo no cliente que tem a posse.**

```
Jogador A (time amarelo)        Servidor (Node.js)        Jogador B (time azul)
         │                            │                           │
         ├──── create_room ──────────►│                           │
         │◄─── room_created (code) ───┤                           │
         │                            │◄──── join_room (code) ────┤
         │◄─── opponent_joined ───────┤────── room_ready ─────────►│
         │                            │                           │
         │  [turno amarelo — A interage]                          │
         │                            │                           │
         ├──── shot_fired ───────────►│────── shot_fired ─────────►│
         │  {playerIdx, impulse,      │   (relay idêntico)        │
         │   allBodyStates}           │                           │
         │                            │                           │
         │  [ambos rodam física local — mesmo input = mesmo resultado]
         │                            │                           │
         ├──── physics_settled ──────►│────── physics_settled ────►│
         │  {allBodyStates}           │   (sync de segurança)     │
         │                            │                           │
         │  [turno azul — B interage] │                           │
```

**Por que esta abordagem:**
- O Cannon.js com os mesmos inputs produz resultados determinísticos o suficiente para este jogo
- Sincronizar apenas nos eventos discretos (chute, reposicionamento) mantém a latência irrelevante durante a animação da física
- O servidor é simples (relay puro), sem precisar rodar física no server
- Compatível com o projeto atual que não usa bundler (Socket.io via CDN)

---

## Novos Arquivos

### `server.js` — Backend Node.js + Socket.io
- Gerencia salas (criar, entrar com código de 4 letras)
- Relay de eventos entre os 2 jogadores da sala
- Sem estado de jogo — apenas repassa mensagens
- Máximo 2 jogadores por sala

### `js/multiplayer.js` — Cliente multiplayer
- Conexão com o servidor via Socket.io CDN
- Gerencia estado local: `myTeam` (`'yellow'|'blue'`), `roomCode`, `isMyTurn`
- Hooks chamados por `game.js` e `input.js`
- Emite e recebe eventos de rede

---

## Arquivos Modificados

### `index.html`
Adicionar antes do `#menu-overlay`:
1. **Tela de entrada** com dois botões: "Jogar Local" (comportamento atual) e "Jogar Online"
2. **Lobby online**: campo para criar sala (gera código) ou entrar em sala (digita código)
3. **Sala de espera**: exibe o código gerado, aguarda oponente conectar
4. Socket.io via CDN: `<script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>`

### `js/game.js`
- Adicionar referência opcional a `multiplayer` (injetada por `main.js`)
- Em `onShotFired()`: se multiplayer ativo, emitir `shot_fired` com estado de todos os corpos físicos
- Em `_resolveShot()` / `allAtRest()`: emitir `physics_settled` com estado final
- Ao receber `shot_fired` do oponente: aplicar os body states e executar o chute remotamente
- Ao receber `physics_settled`: corrigir posições caso haja divergência

### `js/input.js`
- Em `canDrag(piece)`: bloquear interação se `multiplayer.isActive && !multiplayer.isMyTurn`
- Em `canDrag(piece)`: bloquear peças do time adversário mesmo quando é seu turno

### `js/main.js`
- Novo caminho de inicialização: `initMultiplayer(roomCode, myTeam, gameConfig)`
- Criar e injetar instância de `MultiplayerManager` no `Game` e `InputHandler`

### `package.json`
```json
{
  "dependencies": {
    "express": "^4.18.0",
    "socket.io": "^4.7.5"
  },
  "scripts": {
    "server": "node server.js"
  }
}
```

---

## Eventos Socket.io

| Evento | Direção | Payload |
|--------|---------|---------|
| `create_room` | cliente → servidor | `{ gameConfig }` |
| `room_created` | servidor → cliente | `{ roomCode }` |
| `join_room` | cliente → servidor | `{ roomCode }` |
| `room_ready` | servidor → ambos | `{ yellowSocketId, blueSocketId }` |
| `opponent_disconnected` | servidor → cliente | — |
| `shot_fired` | cliente → servidor → oponente | `{ playerIdx, team, impulse: {x,y,z}, bodyStates: [...] }` |
| `reposition` | cliente → servidor → oponente | `{ playerIdx, team, position: {x,y,z} }` |
| `physics_settled` | cliente → servidor → oponente | `{ bodyStates: [...] }` |
| `game_event` | cliente → servidor → oponente | `{ type: 'goal'\|'throw_in'\|'corner'\|..., data }` |

**`bodyStates`**: array com `{ id, pos: {x,y,z}, vel: {x,y,z}, quat: {x,y,z,w} }` para a bola + todos os jogadores.

---

## Fluxo Detalhado de um Chute Online

1. **Jogador A mira e solta** → `input.js` chama `game.onShotFired(piece, impulse)`
2. **`game.js`** aplica o impulso localmente E emite `shot_fired` com body states atuais
3. **Servidor** faz relay para Jogador B
4. **`multiplayer.js` do B** recebe → aplica body states → aplica mesmo impulso na física local do B
5. **Ambos** rodam a simulação local até `allAtRest()`
6. **Quem tem a posse** (A) emite `physics_settled` com estado final
7. **B** recebe e corrige pequenas divergências de posição

---

## Atribuição de Times

- O **criador da sala** sempre joga com o time **Amarelo** (possui a bola no início)
- O **segundo jogador** sempre joga com o time **Azul**
- Elimina qualquer negociação de turno — simples e direto

---

## Hospedagem do Servidor

O servidor Node.js pode ser hospedado gratuitamente em:
- **Render.com** (free tier, sempre ligado)
- **Railway.app** (free trial)
- **Fly.io** (free tier)

Configuração: porta via `process.env.PORT || 3000`, CORS aberto para o origin do cliente.

---

## O Que NÃO Muda

- Toda a lógica de física, regras, HUD e rendering
- O modo local continua funcionando exatamente igual
- Nenhuma mudança na estrutura de `Game`, `Player`, `Ball`, `Field`

---

## Ordem de Implementação

1. `server.js` + `package.json` (servidor relay básico)
2. `js/multiplayer.js` (conexão + gerenciamento de sala)
3. `index.html` (lobby UI: criar/entrar sala)
4. `js/input.js` (bloqueio de input por turno/time)
5. `js/game.js` (hooks de emissão + recepção de chutes)
6. `js/main.js` (init do modo multiplayer)
7. Testes de integração local (duas abas)

---

## Como Testar

1. `npm install && node server.js` → servidor rodando em `localhost:3000`
2. Abrir `index.html` em duas abas/dispositivos
3. Aba 1: "Jogar Online" → "Criar Sala" → copiar código
4. Aba 2: "Jogar Online" → "Entrar em Sala" → colar código
5. Ambas devem mostrar o campo com o time correto habilitado
6. Disparar chute na aba amarela → animação deve aparecer em ambas
7. Após a física parar, controle passa para a aba azul
8. Testar gol, arremesso lateral, corner — todos os eventos devem sincronizar
