# Futebol de Botão 3D

Simulador de futebol de botão no browser com física real (Cannon.js) e renderização 3D (Three.js).

## Como rodar

Não há build nem instalação. Basta servir os arquivos com qualquer servidor HTTP local.

**Opção 1 — usando `serve` (recomendado):**
```bash
npx serve -p 5500 .
```
Acesse [http://localhost:5500](http://localhost:5500)

**Opção 2 — usando Python:**
```bash
python -m http.server 5500
```

**Opção 3 — VS Code:**  
Instale a extensão [Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) e clique em "Go Live".

> **Importante:** não abra o `index.html` diretamente no browser (`file://`). O jogo usa ES6 modules, que exigem um servidor HTTP.

## Modos de jogo

- **Futebol de Botão** — campo completo, 11 jogadores
- **Society Fut7** — campo reduzido, 7 jogadores
- **Showbol** — campo Fut7 com paredes, 5+1 jogadores

## Controles

- **Hover** na peça do seu time para selecioná-la
- **Clique e arraste** para mirar e carregar o chute
- **Solte** para disparar (quanto mais longo o arraste, mais forte o chute)
- **Scroll** para dar zoom
- Botões de câmera no canto para mudar o ângulo de visão

## Times disponíveis

Flamengo, Palmeiras, Corinthians, Grêmio, Atlético, Cruzeiro, Fluminense, Santos, Botafogo, Vasco, Inter, São Paulo.

## Requisitos

Nenhuma dependência local. As bibliotecas (Three.js e Cannon.js) são carregadas via CDN, então é necessário ter conexão com a internet na primeira vez.
