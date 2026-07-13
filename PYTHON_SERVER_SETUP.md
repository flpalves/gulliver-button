# Servidor Python - Guia de Setup

Se você prefere usar Python em vez de Node.js, siga este guia.

## Instalação

### 1. Criar ambiente virtual (opcional, mas recomendado)

```bash
# Windows
python -m venv venv
venv\Scripts\activate

# macOS/Linux
python3 -m venv venv
source venv/bin/activate
```

### 2. Instalar dependências

```bash
pip install -r requirements.txt
```

## Executando o Servidor

```bash
python server_python.py
```

O servidor estará disponível em `http://localhost:3000`

## Testando Multiplayer Localmente

### Passo 1: Abra dois navegadores (ou duas abas/janelas)

**Navegador 1:**
```
http://localhost:3000
```

**Navegador 2:**
```
http://localhost:3000
```

### Passo 2: Navegador 1 (Amarelo)

1. Clique em "🌐 Jogar Online"
2. Escolha os times desejados
3. Clique em "⚽ JOGAR"
4. Clique em "➕ Criar Sala"
5. Copie o código exibido (ex: ABCD)

### Passo 3: Navegador 2 (Azul)

1. Clique em "🌐 Jogar Online"
2. Escolha os mesmos times (ou diferentes)
3. Clique em "⚽ JOGAR"
4. Clique em "🔗 Entrar em Sala"
5. Digite o código copiado
6. Clique em "🔗 Entrar"

### Passo 4: Jogar!

- **Navegador 1 (Amarelo)**: Começa com a posse
- **Navegador 2 (Azul)**: Aguarda seu turno
- Sincronização automática de chutes e posições
- Turnos alternam quando a bola para

## Diferenças entre Node.js e Python

| Aspecto | Node.js | Python |
|---------|---------|--------|
| Performance | Muito rápida | Boa |
| Facilidade | Simples | Simples |
| Dependências | npm | pip |
| Venv | npm ci | pip install |
| Start | `npm run server` | `python server_python.py` |

## Troubleshooting

### "ModuleNotFoundError: No module named 'flask'"

Certifique-se de que ativou o ambiente virtual e instalou as dependências:
```bash
pip install -r requirements.txt
```

### "Address already in use"

Porta 3000 já está em uso. Mate o processo anterior:

**Windows:**
```bash
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

**macOS/Linux:**
```bash
lsof -i :3000
kill -9 <PID>
```

### Conexão recusada

Certifique-se de que o servidor está rodando:
```bash
python server_python.py
```

## Monitoramento

O servidor exibe logs úteis:
```
[ROOM] ABCD created by xyz123 (yellow)
[ROOM] ABCD joined by abc789 (blue)
[SHOT] ABCD - xyz123 fired shot
[PHYSICS] ABCD - xyz123 settled
```

## Diferenças vs server.js

- Usa Flask em vez de Express
- Usa `python-socketio` em vez de Socket.io npm
- Lê o HTML diretamente do disco
- Mesma lógica de relay de eventos
- Mesmos eventos Socket.io

## Para Produção

Para produção, use o server.js (Node.js) ou configure Gunicorn:

```bash
pip install gunicorn
gunicorn --worker-class eventlet -w 1 server_python:app
```

Mas para testes locais, `python server_python.py` é mais que suficiente! 🎮
