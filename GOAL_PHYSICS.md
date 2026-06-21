# Física da Trave e Validação de Gols

## Resumo das Mudanças

Foram implementados três recursos principais no jogo Gulliver:

### 1. **Física Aplicada à Trave** 🎯

A trave agora possui corpos físicos Cannon.js que interagem com a bola:
- **Postes**: Cilindros verticais que funcionam como colisores estáticos
- **Barra Transversal (Crossbar)**: Cilindro horizontal no topo da trave
- **Rede**: Planos invisíveis (frontal, laterais e superior) que funcionam como colisores
- **Características**: Todos são corpos estáticos (não se movem) mas detectam colisões com a bola e jogadores

**Implementação**: 
- Postes e barra: `js/goal.js` - método `_buildPhysics()`
- Rede: `js/goal.js` - método `_addNetBodies()`

### 2. **Validação Robusta de Gols** ✅

Um gol só é válido se a bola passar **dentro da trave sem colidir com postes ou barra**:

**Regras:**
- ✅ **GOL VÁLIDO**: Bola passa através da rede sem bater em postes/crossbar
- ❌ **GOL INVÁLIDO**: Bola bate em post ou crossbar (volta ao jogo com tiro de meta)
- ✅ **GOL PERMITIDO**: Bola pode colidir com a rede (deformação visual)

**Lógica de Detecção:**
1. Bola ultrapassa a linha de gol (`x > HW`)
2. Sistema verifica se estava dentro da zona de gol (`z < GW/2`)
3. Se colidiu com posts/crossbar → GOL INVÁLIDO
4. Se passou limpo ou via rede → GOL VÁLIDO

**Implementação**: 
- Rastreamento: `js/goal.js` - propriedade `ballCollisions`
- Validação: `js/game.js` - método `_checkOutOfPlay()` com verificação `didBallPassCleanly()`

### 3. **Efeitos Visuais de Impacto na Rede** 🌊

Quando a bola bate na rede, um efeito de deformação visual é acionado:
- **Deformação em Ondas**: A rede se deforma em padrão gaussiano ao redor do ponto de impacto
- **Animação Suave**: Duração de 300ms com ease-out para movimento natural
- **Recuperação Automática**: A rede volta à posição original após a animação

**Implementação**: 
- Detecção: `js/goal.js` - método `_onImpact()`
- Animação: `js/goal.js` - método `_updateNetDeformation()`
- Atualização: `js/main.js` - executa `goal.update()` a cada frame

## Arquivos Criados/Modificados

### Novos:
- **js/goal.js** - Classe completa para gerenciar trave com física, colisores e efeitos

### Modificados:
- **js/field.js** - Integração com Goal, passa physics ao construtor, expõe `getGoalByX()`
- **js/main.js** - Atualiza goals a cada frame, passa field ao Game
- **js/game.js** - Validação inteligente de gol com rastreamento de colisões

## Como Testar

### Teste 1: Gol Válido
1. Faça chute em linha reta para a trave
2. A bola deve passar e o gol deve ser marcado
3. Status mostra "GOL do [Time]!"

### Teste 2: Gol Bloqueado
1. Faça chute que bata no poste ou barra
2. A bola volta e o jogo continua
3. Status mostra "Tiro de meta para [Time]"

### Teste 3: Impacto Visual
1. Câmera em vista de gol
2. Faça a bola bater na rede
3. Você verá a deformação em onda na rede

## Detalhes Técnicos

### Colisores da Trave
```
Postes Frontais:     Cilindro(r=0.25, h=3.5) em X=±HW, Z=±GW/2
Barra Transversal:   Cilindro(r=0.25, l=14.5) em Y=GH, rotação em X
Postes Traseiros:    Cilindro(r=0.25, h=3.5) em X=±HW±GD, Z=±GW/2
Rede Frontal:        Box(w=14.5, h=3.5, d=0.2) em X=±HW±GD, Z=0
Rede Laterais:       Box(w=3.0, h=3.5, d=0.2) em X=±HW±GD/2, Z=±GW/2
Rede Superior:       Box(w=3.0, h=0.2, d=14.5) em X=±HW±GD/2, Y=GH
```

### Rastreamento de Colisões
```javascript
// Cada colisão com posts/bars é contada
ballCollisions = { posts: 0, bars: 0, nets: 0 }

// Gol é válido se:
didBallPassCleanly() => posts === 0 && bars === 0
```

### Efeito de Deformação
- Geometria com 4x4 segmentos para deformação suave
- Falloff gaussiano: `exp(-(dist²) / 4)`
- Vértices deslocados radialmente do ponto de impacto
- Restauração automática ao final da animação

### Reset de Colisões
- Reseta quando gol é marcado
- Reseta quando bola é colocada (restart)
- Reseta quando começa novo tempo/jogo

## Comportamento Esperado

| Situação | Resultado | Status |
|----------|-----------|--------|
| Bola passa limpo | GOL ✅ | "GOL do [Time]!" |
| Bola bate em post | Rebote | "Tiro de meta..." |
| Bola bate em barra | Rebote | "Tiro de meta..." |
| Bola bate na rede | Rebote + efeito | Deformação visual |
| Bola sai lateralmente | Lateral | "Lateral para..." |
| Bola sai na fundo (não gol) | Escanteio/Tiro de meta | Conforme regra |

## Próximos Passos (Sugestões)

1. **Efeitos de Som**: SFX para gol, rebote em poste, impacto na rede
2. **Partículas**: Explosão de partículas no impacto
3. **Câmera de Replay**: Replay em câmera lenta após gol
4. **Animação do Poste**: Pequeno balanceio ao impacto
5. **Estatísticas**: Rastrear chutes bloqueados, gols, etc.

## Testado em

- Chrome 127+
- Three.js r128
- Cannon.js 0.6.2
- Resolução: 1920x945+
- Sistema de gol validado com colisões reais
