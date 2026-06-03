# 2026-06-03 — Criação do Claude Usage Indicator (extensão GNOME + tracker)

Sessão de implementação: projeto criado do zero em `~/dev/claude-usage-indicator/`.

## O que foi feito

Construímos uma **extensão do GNOME Shell** que mostra o uso do **Claude Code**
em tempo real na barra superior, com painel detalhado ao clicar. Objetivo do
usuário: ver estatísticas de uso resumidas na barra (tokens, custo, % e tempo
até reset diário/semanal) **sem consumir tokens** e de forma **simples**.

Decisão central de arquitetura: em vez de chamar a API da Anthropic (gastaria
tokens), o uso é calculado **100% localmente** a partir dos arquivos de
transcrição `JSONL` que o Claude Code já grava em `~/.claude/projects/`. Cada
mensagem do assistente contém `timestamp`, `message.model` e `message.usage`
(input/output/cache tokens) + IDs (`message.id`, `requestId`) para deduplicação.

Componentes implementados:

1. **Tracker em Python** (`extension/claude-usage-tracker.py`)
   - Lê todos os JSONL com cache incremental por `mtime`+`size`.
   - Deduplica por `messageId:requestId`.
   - Agrega por **janela de sessão de 5h** (rolante, ancorada na 1ª msg do bloco,
     reset = início + 5h), **dia** (desde a meia-noite local) e **semana**
     (janela configurável de reset).
   - Estima **custo** por preços públicos por modelo (Opus/Sonnet/Haiku).
   - Grava resumo em `~/.local/share/claude-usage/usage.json`.
   - Também funciona como CLI: `--print` e `--watch N`.
   - **Validado com dados reais**: sessão 3.3M tokens/$4.75, hoje 1.8M/$3.25,
     semana 75.8M/$43.39, com quebra por modelo.

2. **Extensão GNOME Shell** (ESM, GNOME 45–50)
   - `extension.js`: botão no painel (ícone + label configurável) que dispara o
     tracker periodicamente e lê o `usage.json`; popup com seções Sessão/Hoje/
     Semana, barras de progresso, quebra por modelo, total e ações.
   - `stylesheet.css`: design adaptável ao tema usando `-st-accent-color`
     (GNOME 47+) com fallbacks; barras mudam de cor (ok/warn/crit).
   - `icons/claude-symbolic.svg`: ícone *symbolic* (recolore com o tema).
   - `prefs.js` (libadwaita) + `schemas/*.gschema.xml`: preferências de exibição,
     limites de plano e reset semanal.
   - A extensão grava `config.json` lido pelo tracker (limites/reset).

3. **Empacotamento para distribuição**
   - `install.sh`, `Makefile` (install/enable/pack/run), `README.md`, `LICENSE`
     (MIT), `.gitignore`.
   - `.zip` gerado para o extensions.gnome.org (`make pack`).
   - Instalada localmente e sintaxe JS validada (`gjs -m`).

4. **Organização da memória**
   - A memória do projeto tinha sido criada por engano na pasta de auto-memória
     do projeto do jogo (Isaac), que era o cwd da sessão.
   - Movida só a parte deste projeto para `~/dev/claude-usage-indicator/memory/`
     (a do Isaac permaneceu na pasta do jogo).
   - A pasta espelho de auto-memória do projeto
     (`~/.claude/projects/-home-eltobsjr-dev-claude-usage-indicator/memory`)
     virou um **symlink** para a do repo → fonte única da verdade.

---

## Arquivos criados

| Arquivo | Conteúdo |
|---|---|
| `extension/claude-usage-tracker.py` | Parser dos JSONL → usage.json (sem rede) |
| `extension/extension.js` | UI do painel + popup detalhado |
| `extension/prefs.js` | Preferências (libadwaita) |
| `extension/stylesheet.css` | Estilo adaptável ao tema |
| `extension/metadata.json` | Metadados da extensão (UUID, shell-versions) |
| `extension/icons/claude-symbolic.svg` | Ícone symbolic recolorível |
| `extension/schemas/org.gnome.shell.extensions.claude-usage.gschema.xml` | Settings |
| `install.sh` | Instalador (copia, compila schema, gera dados) |
| `Makefile` | install/enable/disable/pack/run/clean |
| `README.md`, `LICENSE`, `.gitignore` | Doc e distribuição |
| `memory/*` | Memória do projeto (symlinkada para a auto-memória) |

## Decisões técnicas

### Cálculo local em vez de API
**Contexto:** usuário quer monitorar uso sem gastar tokens e de forma simples.
**Alternativas:** API key da Anthropic; sessão do claude.ai; parse local.
**Decisão:** parse local dos JSONL do Claude Code — zero custo, zero rede, e os
dados de tokens são exatos. Custo é estimado pelos preços públicos.

### Limites de plano configuráveis
**Contexto:** a Anthropic não publica os limites exatos em tokens.
**Decisão:** mostrar sempre tokens e custo (exatos); a % é opcional e baseada em
limites configuráveis nas preferências (0 = oculta a %).

### Symlink da auto-memória
**Decisão:** a pasta de auto-memória do projeto aponta (symlink) para
`memory/` dentro do repo, evitando duas cópias divergentes.

## Status

- [x] Tracker Python lendo JSONL, agregando e estimando custo
- [x] Extensão GNOME (painel + popup + barras + por modelo)
- [x] Preferências libadwaita + GSettings schema
- [x] Empacotamento (install.sh, Makefile, README, LICENSE, .zip)
- [x] Instalada localmente e schema compilado
- [x] Memória reorganizada e symlinkada
- [ ] Ativar a extensão (precisa relogar no Wayland + `gnome-extensions enable`)
- [ ] Adicionar screenshot em `docs/`
- [ ] Inicializar git e publicar no GitHub
- [ ] (Opcional) publicar no extensions.gnome.org

## Próximos passos

1. Relogar (Wayland) e rodar `gnome-extensions enable claude-usage@eltobsjr.gmail.com`; abrir o painel e validar a UI ao vivo.
2. Tirar screenshot do painel/popup e colocar em `docs/screenshot.png` (referenciado no README).
3. `git init` no projeto, primeiro commit e criar repo `github.com/eltobsjr/claude-usage-indicator`.
4. Opcional: submeter o `.zip` ao extensions.gnome.org.
