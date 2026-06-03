# Claude Usage Indicator

Uma extensão do **GNOME Shell** que mostra o uso do **Claude Code** em tempo real
na barra superior: porcentagem da sessão de 5h, uso de hoje e da semana.
Ao clicar, abre um painel com estatísticas detalhadas.

> 🔒 **100% local.** Lê os arquivos de transcrição que o Claude Code já grava no
> seu disco (`~/.claude/projects`) e as credenciais OAuth que o próprio Claude
> Code armazena em `~/.claude/.credentials.json`. **Nenhum dado sai da máquina e
> nenhum token é consumido.**

## ✨ Recursos

- **Painel compacto** na barra superior com percentual real de uso (S/H/W) —
  sessão de 5h · hoje · semana — com countdown até o reset.
- **Dados reais da Anthropic**: % de uso e horários de reset lidos diretamente
  da API do claude.ai via OAuth, sem precisar configurar nada.
- **Popup detalhado** com:
  - Sessão de 5h (janela rolante) + contagem regressiva
  - Uso de hoje + tokens e custo
  - Uso da semana + contagem regressiva
  - Quebra por modelo (Opus / Sonnet / Haiku)
- **Barras de progresso** que mudam de cor (verde → amarelo → vermelho)
  conforme você se aproxima do limite.
- **Plano detectado automaticamente** (Pro / Max) na aba do popup.
- **Design adaptável ao tema**: usa a *accent color* do sistema (GNOME 47+) com
  vários temas extras (Catppuccin, Verde GNOME, Laranja Ubuntu…).
- **Estimativa de custo** pelos preços públicos da API por modelo.

## 📦 Requisitos

- GNOME Shell 45–50
- `python3`
- Claude Code instalado e em uso (é a fonte dos dados)

## 🚀 Instalação

```bash
git clone https://github.com/eltobsjr/claudeUsageIndicator.git
cd claudeUsageIndicator
./install.sh
gnome-extensions enable claude-usage@eltobsjr.gmail.com
```

No **Wayland** é preciso fazer **logout/login** após instalar para o GNOME Shell
recarregar as extensões. No **X11**, basta `Alt+F2` → `r` → Enter.

### Via Makefile

```bash
make install   # copia e compila o schema
make enable    # ativa a extensão
make run       # roda o tracker e imprime o resumo no terminal
make pack      # gera o .zip para o extensions.gnome.org
```

## ⚙️ Configuração

Abra as preferências (`gnome-extensions prefs claude-usage@eltobsjr.gmail.com`
ou pelo menu da extensão → **Preferências**):

- **Exibição** — tema de cores, formato do label na barra, mostrar/ocultar ícone,
  intervalo de atualização.

Não há nada para configurar manualmente sobre limites ou plano — tudo é detectado
automaticamente via credenciais OAuth do Claude Code.

## 🧠 Como funciona

O Claude Code grava cada sessão em arquivos `JSONL` dentro de
`~/.claude/projects/`. A extensão dispara um pequeno script Python
(`claude-usage-tracker.py`) que:

1. Lê esses arquivos (com cache incremental por `mtime`),
2. Deduplica por `messageId:requestId`,
3. Agrega por janela de 5h, dia e semana,
4. Busca **% de uso real e horários de reset** via `GET /api/oauth/usage` do
   claude.ai, usando o token OAuth armazenado em `~/.claude/.credentials.json`,
5. Estima o custo pelos preços públicos por modelo,
6. Grava um resumo em `~/.local/share/claude-usage/usage.json`.

A extensão lê esse JSON e desenha a interface.

Você também pode usar o tracker sozinho, sem a extensão:

```bash
python3 extension/claude-usage-tracker.py --print
python3 extension/claude-usage-tracker.py --watch 30   # loop a cada 30s
```

## 📁 Estrutura

```
claude-usage-indicator/
├── extension/
│   ├── extension.js                 # UI do painel + popup
│   ├── prefs.js                     # preferências (libadwaita)
│   ├── metadata.json
│   ├── stylesheet.css               # estilo adaptável ao tema
│   ├── claude-usage-tracker.py      # parser dos JSONL + consulta OAuth
│   ├── icons/claude-symbolic.svg
│   └── schemas/*.gschema.xml
├── install.sh
├── Makefile
├── LICENSE
└── README.md
```

## ⚠️ Notas

- Os **custos são estimativas** baseadas nos preços públicos da API; planos de
  assinatura (Pro/Max) têm faturamento diferente. Útil como referência relativa.
- A **% de uso** da sessão e da semana vem diretamente da Anthropic. O "hoje"
  não tem equivalente na API, então exibe tokens e custo sem percentual.

## 📄 Licença

MIT — veja [LICENSE](LICENSE).
