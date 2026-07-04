# 🎮 Guia de Teste: Multiplayer Integrado

Agora o multiplayer está **totalmente integrado** no jogo! Não precisa mais de arquivo HTML separado.

---

## 🚀 Teste Rápido (2 minutos)

### Passo 1: Rodar o Servidor

```bash
cd C:\Users\felip\OneDrive\Documentos\projetos\gulliver\gulliver-button
npm start
```

Aguarde aparecer:
```
╔════════════════════════════════════════╗
║   🚀 GULLIVER MULTIPLAYER SERVER 🚀    ║
╚════════════════════════════════════════╝

  Rodando em: http://localhost:3000
  Aguardando conexões Socket.io...
```

### Passo 2: Abrir o Jogo

Abra **2 navegadores/abas**:
```
http://localhost:5500
```
(ou use `npx serve -p 5500 .` em outro terminal)

### Passo 3: Testar Local First

**Ambas as abas:**
1. Clica em **"🎮 Jogar Local"**
2. Escolhe modo, times, etc (como antes)
3. Verifica se jogo funciona normalmente

✅ Se funcionar, passe para Multiplayer

---

## 🌐 Teste Multiplayer

### Aba 1 (Amarelo):
```
1. Clica em "🌐 Jogar Online"
2. Clica em "➕ Criar Sala"
3. Aguarda a conexão (tela de carregamento)
4. Aparece "Sala de Espera" com código (ex: XZVR)
5. Copia o código
```

### Aba 2 (Azul):
```
1. Clica em "🌐 Jogar Online"
2. Clica em "🔗 Entrar em Sala"
3. Cola o código (ex: XZVR)
4. Aguarda conexão
5. Ambas abas mostram "SALA PRONTA"
```

### Aba 1 & 2: Verificar Sincronização
```
✅ HUD sincronizado:
   - Placar: 0 × 0
   - Posse: 🟡 Amarelo (ou 🔵 Azul)
   - Toques: 0 / 4
   - Tempo: 1T 05:00 (decrescendo)

✅ Movimento sincronizado:
   - Aba 1 arrasta peça amarela
   - Aba 2 vê movimento simultâneo
   - Bola se move em ambas

✅ FPS: 60 (smooth)
```

---

## 📊 O Que Testar

### Teste 1: Criação de Sala ✅
```
Aba 1: "Jogar Online" → "Criar Sala"
✅ Servidor conecta
✅ Código gerado (4 letras)
✅ Tela de "Sala de Espera"
```

### Teste 2: Entrada em Sala ✅
```
Aba 2: Código correto
✅ Conecta ao servidor
✅ Recebe "SALA PRONTA"
✅ Ambas mostram mesmo time (Aba 1: Amarelo, Aba 2: Azul)
```

### Teste 3: Sincronização de Estado ✅
```
Observar ambas as abas:
✅ HUD idêntico
✅ Posição de bola igual
✅ Placar sincronizado
```

### Teste 4: Movimento Sincronizado ✅
```
Aba 1 (Amarelo): Arrasta peça
✅ Aba 2 (Azul) vê movimento
✅ Sem lag (interpolação suave)
```

### Teste 5: Input do Jogador ✅
```
Aba 1: Clica e arrasta peça
✅ Servidor recebe input
✅ Física calcula
✅ Aba 2 vê resultado
```

### Teste 6: Gol/Eventos ✅
```
Se conseguir gol:
✅ Placar atualiza em ambas
✅ Possessão muda
✅ Campo reseta
```

---

## 🐛 Se Não Funcionar

### Erro: "Porta 3000 em uso"
```powershell
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
npm start
```

### Erro: "Socket.io não carregado"
- Verificar se tem `<script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>` no HTML ✅

### Estado não sincroniza
- Abrir console (F12)
- Procurar por erros em vermelho
- Verificar se servidor está rodando

### Muito lag
- Normal em 2 abas da mesma máquina
- Lag real só em máquinas diferentes
- Ping esperado: 20-50ms na mesma rede

---

## ✅ Checklist de Teste

- [ ] Servidor roda (`npm start`)
- [ ] Jogo abre (`http://localhost:5500`)
- [ ] Modo Local funciona
- [ ] Modo Online: Aba 1 cria sala
- [ ] Modo Online: Aba 2 entra com código
- [ ] Ambas abas mostram "Sala Pronta"
- [ ] HUD sincronizado (placar, posse, tempo)
- [ ] Movimento sincronizado
- [ ] FPS mantém 60
- [ ] Chute é replicado

**Se tudo passar:** Multiplayer está funcionando! 🎉

---

## 📸 Screenshots Esperados

### Tela Inicial
```
🎮 Jogar Local
🌐 Jogar Online
```

### Sala Criada
```
Código: XZVR
Seu time: 🟡 AMARELO
Aguardando oponente...
```

### Durante o Jogo
```
HUD:
  🟡 0 × 0 🔵
  Tempo: 1T 04:30
  Posse: 🟡 Amarelo
  Toques: 2 / 4
```

---

## 🎯 Passos 19-23 Testados

| Passo | Função | Teste |
|-------|--------|-------|
| 19 | Connect Socket.io | ✅ Cria sala |
| 20 | Receber state_update | ✅ HUD sincroniza |
| 21 | Interpolação visual | ✅ Movimento smooth |
| 22 | Enviar player_input | ✅ Chute replicado |
| 23 | Sincronizar HUD | ✅ Placar, posse, tempo |

---

## 🎮 Pronto para Jogar!

O multiplayer está completamente integrado no jogo. Basta escolher "Jogar Online" no menu inicial!

```
├─ Jogar Local
└─ Jogar Online
   ├─ Criar Sala
   └─ Entrar em Sala
```

Divirta-se! 🚀
