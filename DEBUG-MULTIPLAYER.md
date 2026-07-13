# Guia de Investigação - Physics não sincroniza

## Checklist de Testes

### 1️⃣ **Verifique se o servidor está rodando e enviando broadcasts**

Abra o console do servidor (Node.js) e procure por:
```
[Broadcast] Yellow: ball=X.XX, players=11
[Broadcast] Blue: ball=X.XX, players=11
```

**Se VER:** O servidor está enviando dados ✅
**Se NÃO VER:** O servidor não está fazendo broadcast ❌

### 2️⃣ **Verifique se o cliente está RECEBENDO o state_update**

Abra DevTools (F12 → Console) e procure por logs que começam com:
```
[Multiplayer] Received state_update from server:
```

**Se VER:** O cliente está recebendo ✅
**Se NÃO VER:** A conexão Socket.io está quebrada ❌

### 3️⃣ **Verifique se o callback onStateUpdated está sendo chamado**

Procure por:
```
[Multiplayer] Calling onStateUpdated callback
```

**Se VER:** O callback está registrado ✅
**Se VER `No onStateUpdated callback set!`:** O callback não foi registrado ❌

### 4️⃣ **Verifique se main.js está recebendo o estado**

Procure por:
```
[Main] onStateUpdated received: {...}
```

Se VER `ballPos: { x: ..., y: ..., z: ... }`, a bola foi serializada ✅

### 5️⃣ **Verifique se game.applyBodyStates está sendo chamado**

Procure por:
```
[Game] applyBodyStates: N bodies
[Game] Ball pos: (X.XX, Y.YY, Z.ZZ)
```

**Se VER:** As posições estão sendo aplicadas ✅
**Se NÃO VER:** Não há bodies para sincronizar ❌

### 6️⃣ **Verifique se as meshes estão sendo renderizadas**

Procure por:
```
[Render] Ball mesh sync: physPos=(X.XX, Y.YY, Z.ZZ), meshPos=(...)
```

**Se VER:** A mesh está sendo sincronizada ✅
**Se NÃO VER:** Pode estar fora da câmera ❌

---

## 🔧 Passos de Teste

1. **Reinicie o servidor:**
   ```bash
   npm start
   ```

2. **Abra DevTools em AMBOS os clientes (F12)**

3. **Jogue em dois clientes diferentes:**
   - Cliente 1 (Yellow): Abra console
   - Cliente 2 (Blue): Abra console

4. **Copie TODOS os logs que vê (especialmente erros em vermelho)**

5. **Cole os logs aqui para análise**

---

## 📊 Possíveis Problemas

### Problema A: "Received state_update" mas sem "applyBodyStates"
→ O callback `onStateUpdated` não foi definido corretamente em main.js

### Problema B: "applyBodyStates" mas meshes não aparecem
→ A posição está sendo sincronizada, mas a mesh não está visível (talvez fora da câmera)

### Problema C: Sem nenhum "state_update"
→ Socket.io não está conectado ou o broadcast falhou

### Problema D: Broadcast no servidor, mas "state_update" no cliente
→ Há um problema na rede ou na emissão

---

## 🎯 Próximas Ações

Após coletar os logs:
1. Compartilhe todos os logs do console (servidor + ambos clientes)
2. Identifique em qual etapa falha
3. Corrigiremos o problema específico

