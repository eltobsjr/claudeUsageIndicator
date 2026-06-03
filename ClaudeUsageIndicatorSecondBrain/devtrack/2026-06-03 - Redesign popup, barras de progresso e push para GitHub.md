# 2026-06-03 — Redesign popup, barras de progresso e push para GitHub

## O que foi feito

### 1. Extensão ativada e funcionando na barra

A extensão foi instalada (`make install`) e ativada com `gnome-extensions enable`. Estava pronta da sessão anterior mas ainda não havia sido ativada. Aparece na barra superior mostrando tokens da sessão.

### 2. Barras de progresso + painel duplo (diário · semanal)

O usuário queria o popup com barras de progresso iguais ao Claude.ai (sessão 55%, semana 6%) e o painel mostrando % diário e semanal + tempo até reset de cada um.

**Mudanças implementadas:**

- **Painel superior**: agora exibe sempre dois valores — `hoje (tokens ou %) + countdown até meia-noite · semana (tokens ou %) + countdown até reset semanal`. Exemplo: `16.2M 11h18m · 90.7M 5d11h`. Quando limites configurados vira `35% 14h · 4% 2d3h`.
- **Popup redesenhado** (novo `MetricRow`): título + "X% usado" à direita, barra de progresso sempre visível abaixo, detalhe `tokens · custo · reqs` em linha menor.
- **Barras sempre visíveis**: quando sem limite configurado, barra cinza mostra o **tempo decorrido da janela** (sessão = % das 5h passadas, hoje = % do dia, semana = % da semana). Quando limite configurado, barra azul/amarela/vermelha mostra % real de tokens.
- **`notify::allocation`** usado no lugar de `notify::width` para relayout da barra — mais confiável no Wayland.

### 3. `daily-token-limit` adicionado

Novo campo nos schemas GSettings, no tracker Python, nas prefs (libadwaita SpinRow) e na sincronização `config.json`. Permite configurar limite diário e ver % de tokens do dia.

O tracker agora também exporta `today.reset_at` (meia-noite do dia seguinte) e `today.pct`.

### 4. git init e primeiro commit

Repositório inicializado. Commit inicial com todos os 16 arquivos do projeto. Remote configurado para `https://github.com/eltobsjr/claudeUsageIndicator.git`. **Push ainda pendente** — requer `gh auth login` (sem sessão autenticada no momento).

### 5. Design completamente reescrito

Por pedido do usuário ("design novo mais compatível e simples"), `extension.js` e `stylesheet.css` foram reescritos do zero:

- Removido `StatRow` antigo, substituído por `MetricRow` mais simples
- Removido `panel-mode` (dropdown de opções) — painel sempre mostra formato duplo
- Removida seção "Total acumulado" do popup
- CSS simplificado: menos classes, herda mais do tema, barras com `transition-duration: 200ms`
- Fonte menor para detalhes, mais espaçamento entre seções

---

## Arquivos modificados

| Arquivo | Mudança |
|---|---|
| `extension/extension.js` | Reescrito: novo `MetricRow`, painel duplo, `notify::allocation`, sem `panel-mode` |
| `extension/stylesheet.css` | Reescrito: design limpo, barras 8px, classes simplificadas |
| `extension/claude-usage-tracker.py` | `daily_token_limit` no config, `today.reset_at` e `today.pct` no output |
| `extension/prefs.js` | SpinRow para `daily-token-limit` na aba Limites |
| `extension/schemas/org.gnome.shell.extensions.claude-usage.gschema.xml` | Chave `daily-token-limit` adicionada |

## Decisões técnicas

### Barras sempre visíveis (tempo vs tokens)
**Contexto:** sem limites configurados, `pct` é null e as barras ficavam ocultas — usuário não via nada.
**Decisão:** quando sem limite, barra cinza mostra tempo decorrido da janela. Isso dá feedback visual imediato sem precisar configurar nada, e muda para azul/colorido automaticamente quando o usuário configurar o limite.

### `notify::allocation` no lugar de `notify::width`
**Contexto:** no Wayland, `notify::width` pode não disparar na alocação inicial do popup, deixando a barra com largura 0.
**Decisão:** `notify::allocation` é mais robusto — dispara sempre que a geometria do widget muda, incluindo a primeira renderização.

### Reescrita completa do JS/CSS
**Contexto:** acúmulo de patches sobre o design original gerou inconsistências. Usuário pediu design novo.
**Decisão:** reescrita limpa em vez de mais patches. Código mais curto e legível.

## Status

- [x] Extensão instalada e ativa na barra
- [x] Painel mostra % diário + semanal + countdowns
- [x] Barras de progresso sempre visíveis (cinza=tempo, azul=tokens)
- [x] `daily-token-limit` implementado (schema + tracker + prefs + sync)
- [x] Design novo reescrito (extension.js + stylesheet.css)
- [x] `make install` executado com novo código
- [ ] **Reiniciar o PC** para o GNOME Shell recarregar o JS no Wayland
- [ ] Verificar popup após restart (barras, layout, contagens)
- [ ] `gh auth login` + `git push` para publicar no GitHub
- [ ] Screenshot em `docs/screenshot.png` após validar o visual
- [ ] Configurar limites em Preferências para ver % real (sessão ~23M tokens, semanal ver Claude.ai)

## Próximos passos

1. **Após reiniciar**: abrir popup e confirmar que as barras aparecem com o novo design. Se algo estiver errado, verificar logs com `journalctl /usr/bin/gnome-shell -f`.
2. **`gh auth login`** (no terminal: `gh auth login`) → depois `git push -u origin main` para publicar no GitHub.
3. Abrir **Preferências** → aba Limites → preencher "Limite da sessão" e "Limite semanal" com valores do plano (visíveis em claude.ai → Plan usage). Com isso as barras virarão azuis com % real.
4. Screenshot do popup funcionando → salvar em `docs/screenshot.png`.
