# Claude Usage Indicator

Extensão do **GNOME Shell** que mostra o uso do **Claude Code** em tempo real na
barra superior, com painel detalhado ao clicar. **100% local — não consome
tokens e não faz chamadas de rede.**

## Princípio central

Nunca usar a API da Anthropic para obter uso (gastaria tokens). Todo o uso é
calculado a partir dos arquivos `JSONL` que o Claude Code já grava em
`~/.claude/projects/`. Cada mensagem do assistente tem `timestamp`,
`message.model`, `message.usage` (input/output/cache tokens) e IDs
(`message.id`, `requestId`) para deduplicação.

## Arquitetura

```
JSONL (~/.claude/projects)  →  tracker.py  →  usage.json  →  extension.js (UI)
                                   ↑                              ↓
                              config.json  ←──────────  prefs.js (settings)
```

- **`extension/claude-usage-tracker.py`** — parser em Python. Lê os JSONL (cache
  incremental por `mtime`+`size`), deduplica por `messageId:requestId`, agrega por
  janela de 5h / dia / semana, estima custo por preços públicos por modelo, e
  grava `~/.local/share/claude-usage/usage.json`. Também roda standalone:
  `--print` (resumo no terminal) e `--watch N` (loop a cada N s).
- **`extension/extension.js`** — botão no painel (ícone + label configurável) que
  dispara o tracker periodicamente e lê o `usage.json`; popup com seções
  Sessão(5h)/Hoje/Semana, barras de progresso, quebra por modelo, total e ações.
- **`extension/prefs.js`** — preferências (libadwaita): exibição, limites de
  plano, reset semanal. Grava `~/.local/share/claude-usage/config.json` (lido
  pelo tracker via GSettings).
- **`extension/stylesheet.css`** — design adaptável ao tema via `-st-accent-color`
  (GNOME 47+) com fallbacks; barras mudam de cor ok→warn(70%)→crit(90%).
- **`extension/icons/claude-symbolic.svg`** — ícone *symbolic* (recolore com o tema).
- **`extension/schemas/*.gschema.xml`** — definição das configurações.

## Conceitos de janelas (no tracker)

- **Sessão (5h)**: janela rolante ancorada na 1ª mensagem do bloco; novo bloco
  começa quando passa ≥5h da âncora. `reset = âncora + 5h`.
- **Hoje**: desde a meia-noite local.
- **Semana**: janela do reset configurável (dia da semana + hora).

## Comandos

```bash
make install      # copia p/ ~/.local/share/gnome-shell/extensions + compila schema
make enable       # ativa a extensão
make run          # roda o tracker e imprime o resumo no terminal
make pack         # gera o .zip para o extensions.gnome.org
python3 extension/claude-usage-tracker.py --print   # testar o parser
```

UUID: `claude-usage@eltobsjr.gmail.com`

## Convenções

- Extensão em **ESM** (GNOME 45+): `import ... from 'gi://...'` e
  `resource:///org/gnome/shell/...`. Suporta shell 45–50.
- Estilo deve **herdar do tema** — preferir `-st-accent-color` e classes
  semânticas; evitar cores fixas exceto como fallback.
- Comentários e UI em **português**.
- Custos são **estimativas** (preços públicos da API); limites em tokens são
  configuráveis porque a Anthropic não os divulga.

## Estado atual

Funcional e instalado localmente; validado com dados reais. Pendências:

- [ ] Ativar no Wayland (relogar + `gnome-extensions enable ...`)
- [ ] Screenshot em `docs/screenshot.png` (referenciado no README)
- [ ] `git init` + publicar em `github.com/eltobsjr/claude-usage-indicator`
- [ ] (Opcional) publicar no extensions.gnome.org

## Ambiente do dev

GNOME Shell 50.2, Wayland, Fedora. No Wayland, mudanças na extensão exigem
logout/login para o Shell recarregar.

## SecondBrain

Logs de sessão em `ClaudeUsageIndicatorSecondBrain/devtrack/`. Gerar com a skill
`/devtrack` ao encerrar sessões.
