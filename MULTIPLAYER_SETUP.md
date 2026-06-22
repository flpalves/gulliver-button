# Multiplayer Setup - Gulliver Button Soccer

## Instalação e Execução

### 1. Instalar dependências
```bash
npm install
```

### 2. Iniciar o servidor
```bash
npm run server
```

O servidor estará disponível em `http://localhost:3000`

### 3. Acessar o jogo
Abra em dois navegadores (ou duas abas):
- Navegador 1 (Jogador 1 - Amarelo): `http://localhost:3000`
- Navegador 2 (Jogador 2 - Azul): `http://localhost:3000`

## Fluxo de Jogo Multiplayer

### Criar Sala
1. Clique em "🌐 Jogar Online"
2. Clique em "➕ Criar Sala"
3. Aguarde a conexão
4. Copie o código da sala (ex: ABCD)

### Entrar na Sala
1. Clique em "🌐 Jogar Online"
2. Clique em "🔗 Entrar em Sala"
3. Digite o código da sala
4. Clique em "🔗 Entrar"

### Jogar
- **Jogador Amarelo (Criador da sala)**: Começa com a posse da bola
- **Jogador Azul (Segundo jogador)**: Aguarda seu turno
- O turno alterna automaticamente após a bola parar
- Apenas o jogador com a posse pode mover suas peças
- Bloqueia interação com peças do adversário

## Arquitetura

### Backend (server.js)
- Servidor Express + Socket.io
- Gerencia salas (código de 4 letras)
- Faz relay de eventos entre os dois jogadores
- Sem estado de jogo (apenas relay puro)

### Cliente (js/multiplayer.js)
- Gerencia conexão Socket.io
- Sincroniza turno e posse
- Emite e recebe eventos de jogo

### Eventos Socket.io

| Evento | Direção | Descrição |
|--------|---------|-----------|
| `create_room` | Cliente → Servidor | Cria nova sala |
| `room_created` | Servidor → Cliente | Sala criada com código |
| `join_room` | Cliente → Servidor | Entra em sala existente |
| `room_ready` | Servidor → Ambos | Sala pronta, jogo pode começar |
| `shot_fired` | Cliente → Servidor → Oponente | Chute disparado com impulse e estado físico |
| `physics_settled` | Cliente → Servidor → Oponente | Bola parou, mudança de turno |
| `opponent_disconnected` | Servidor → Cliente | Oponente desconectou |

## Testando Localmente

### Com duas abas do mesmo navegador
1. Abra `http://localhost:3000` em duas abas
2. Aba 1: Criar sala
3. Aba 2: Entrar na sala com o código
4. Ambas devem sincronizar o jogo

### Com dois dispositivos
1. Substitua `localhost` pelo IP da máquina do servidor
2. Ex: `http://192.168.1.100:3000`

## Hospedagem em Produção

O servidor pode ser hospedado em:
- **Render.com** (free tier)
- **Railway.app** (free trial)
- **Fly.io** (free tier)
- **Heroku** (pago)

Configure a porta via variável de ambiente `PORT`:
```bash
PORT=3000 npm run server
```

## Troubleshooting

### Conexão recusada
- Verifique se o servidor está rodando: `npm run server`
- Verifique se a porta 3000 não está em uso

### Código inválido ao entrar
- Verifique se o código tem exatamente 4 letras
- Código é case-insensitive (ABCD = abcd)
- A sala pode ter sido removida (timeout)

### Bola não sincroniza
- Ambos os clientes devem estar com a mesma configuração de jogo
- Verifique latência de rede (deve ser < 100ms para melhor experiência)
- Física determinística depende de timing sincronizado

### Oponente não consegue se mover
- Verifique se é o turno dele (HUD deve indicar a posse)
- Clientes em multiplayer: não podem mover peças do adversário
- Apenas o jogador com posse pode disparar chutes

## Desenvolvimento

### Adicionar novas funcionalidades
- Eventos de rede em `js/multiplayer.js`
- Sincronização em `js/game.js` via `_onRemoteShotFired` e `_onPhysicsSettled`
- Relay no servidor em `server.js`

### Arquivos principais
- `server.js` - Backend
- `js/multiplayer.js` - Cliente multiplayer
- `js/game.js` - Lógica de jogo com hooks multiplayer
- `js/input.js` - Controle com bloqueio por turno
- `js/main.js` - Inicialização com suporte multiplayer
