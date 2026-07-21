# Suporte Mobile — Checklist de Planejamento

Levantamento do que falta para o jogo funcionar bem em celulares/tablets.
Baseado no estado atual do código (`index.html`, `js/scene.js`, `js/input.js`, `css/style.css`).

Status: 🔲 não iniciado · 🟡 em andamento · ✅ concluído

---

## 1. Fundamentos de viewport/PWA

- ✅ Adicionada `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">` + meta tags `mobile-web-app-capable`/`theme-color` em `index.html`
- ✅ `touch-action: none` no `<canvas>` e em `html, body`
- ✅ Bloqueado pull-to-refresh e overscroll (`overscroll-behavior: none` no body)
- 🟡 Orientação: não foi travada — optou-se por layout responsivo (portrait/landscape) via breakpoints CSS em vez de forçar landscape. Falta validar em portrait real
- 🔲 (Opcional) `manifest.json` + ícones para "adicionar à tela inicial" — não incluído, fora do escopo desta rodada

## 2. Gestos de toque no campo

- ✅ **Pinch-to-zoom**: `initTouchGestures()` em `js/scene.js` detecta 2 dedos e ajusta `zoomFactor` pela distância entre eles
- ✅ **Pan com 2 dedos**: mesmo handler move `panX/panZ` a partir do deslocamento do ponto médio entre os dois toques
- ✅ **Pan com 1 dedo fora de qualquer peça**: `InputHandler._onDown` (`js/input.js`) agora retorna se iniciou um drag; se o toque não caiu sobre uma peça arrastável, o dedo passa a mover a câmera (`panByPixels`, exportado de `js/scene.js`) em vez de não fazer nada
- ✅ Conflito resolvido: `multiTouchActive` (exportado de `scene.js`) é checado em `input.js` para ignorar/abortar o drag de peça assim que um 2º dedo toca a tela
- ✅ `InputHandler` agora ignora `touchstart`/`touchmove` com mais de 1 toque ativo (evita drag acidental durante pinch/pan)
- ✅ Double-tap (single-finger, <300ms) chama `resetView()` — mesmo efeito do botão "⌂"

## 3. Layout / espaço de tela

- ✅ HUD compactado em telas <380px (`@media (max-width: 380px)` em `css/style.css`): altura menor, fontes/ícones reduzidos
- ✅ Safe-area (`env(safe-area-inset-*)`) aplicado no HUD, `#canvas-wrap`, `#cam-btns` e `#zoom-btns`
- ✅ Botões flutuantes (`#cam-btns`, `#zoom-btns`) aumentados para 44px mínimo de toque
- ✅ Breakpoint `@media (max-width: 640px)` empilha `.menu-vs-section` verticalmente, quebra `.setting-tabs` em várias linhas e garante 44px de altura mínima nos botões dos menus
- ✅ `#room-code-input`: `font-size: 16px` (evita zoom automático do iOS ao focar) + `scrollIntoView` ao focar
- 🔲 Câmera ortográfica em `makeOrthoCamera` ainda não foi validada/calibrada para aspect ratios de portrait extremos (ex. 9:19) — precisa teste em device real

## 4. Performance mobile

- ✅ Cap de `devicePixelRatio` agora é adaptativo: 2 (desktop), 1.5 (mobile), 1.25 (mobile com ≤4 cores lógicos — `isLowEndDevice` em `js/scene.js`)
- ✅ Shadow map adaptativo: 2048 (desktop), 1024 (mobile), 512 (low-end) — e sombra desativada inteiramente em `isLowEndDevice`
- ✅ Antialias desativado em `isLowEndDevice`
- 🟡 Detecção é heurística (touch + `hardwareConcurrency`, sem API de GPU tier confiável no browser) — falta validar taxa de FPS real em device médio/fraco

## 5. Multiplayer/conectividade mobile

- ✅ Reconexão automática do Socket.io já existente (`reconnection`/`reconnectionAttempts` em `multiplayer.js`) — não precisou de mudança
- ✅ `visibilitychange`/`pagehide` adicionados em `js/multiplayer.js`: loga a transição para segundo plano e mostra um toast "🔌 Reconectando..." se o app voltar ao primeiro plano ainda desconectado
- 🔲 Falta validar comportamento real em iOS/Android com o app suspenso por período longo (o servidor pode expirar a sala antes da volta)

## 6. Testes

- 🔲 Testar em pelo menos: Safari iOS (iPhone), Chrome Android, um tablet
- 🔲 Testar os 3 modos de câmera (overview / gol esquerdo / gol direito) com gestos touch em cada
- 🔲 Testar fluxo completo de multiplayer (criar sala, entrar por código, jogar) em mobile
