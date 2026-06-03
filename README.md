# Claude Usage Indicator

Uma extensão do **GNOME Shell** que mostra o uso do **Claude Code** em tempo real
na barra superior: tokens, custo estimado, janela de sessão de 5h e reset semanal.
Ao clicar, abre um painel com estatísticas detalhadas.

> 🔒 **100% local.** Lê apenas os arquivos de transcrição que o Claude Code já
> grava no seu disco (`~/.claude/projects`). **Não faz chamadas de rede e não
> consome tokens.**

![placeholder](docs/screenshot.png)

## ✨ Recursos

- **Painel compacto** na barra superior, configurável: tokens da sessão,
  porcentagem, custo do dia, ou tempo até o reset.
- **Popup detalhado** com:
  - Sessão de 5h (janela rolante) + contagem regressiva até o reset
  - Uso de hoje
  - Uso da semana + contagem regressiva até o reset semanal
  - Quebra por modelo (Opus / Sonnet / Haiku)
  - Total acumulado
- **Barras de progresso** que mudam de cor (verde → amarelo → vermelho)
  conforme você se aproxima do limite.
- **Design adaptável ao tema**: usa a *accent color* do sistema (GNOME 47+) e
  funciona em temas claros, escuros e personalizados.
- **Estimativa de custo** com base nos preços públicos da API.

## 📦 Requisitos

- GNOME Shell 45–50
- `python3`
- Claude Code instalado e em uso (é a fonte dos dados)

## 🚀 Instalação

### Via script

```bash
git clone https://github.com/eltobsjr/claude-usage-indicator.git
cd claude-usage-indicator
./install.sh
gnome-extensions enable claude-usage@eltobsjr.gmail.com
```

No **Wayland** é preciso fazer logout/login após instalar. No **X11**, basta
recarregar o Shell (`Alt+F2` → `r` → Enter).

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

- **Exibição** — o que mostrar na barra, mostrar/ocultar ícone, intervalo de
  atualização.
- **Limites** — limites aproximados de tokens do seu plano (para ver a % de
  uso) e quando sua semana reinicia. A Anthropic não publica os limites exatos,
  então deixe em `0` para ver apenas tokens e custo.

## 🧠 Como funciona

O Claude Code grava cada sessão em arquivos `JSONL` dentro de
`~/.claude/projects/`. Cada mensagem do assistente inclui os tokens usados
(`input`, `output`, `cache`). A extensão dispara um pequeno script Python
(`claude-usage-tracker.py`) que:

1. Lê esses arquivos (com cache incremental por `mtime`),
2. Deduplica por `messageId:requestId`,
3. Agrega por janela de 5h, dia e semana,
4. Estima o custo pelos preços públicos por modelo,
5. Grava um resumo em `~/.local/share/claude-usage/usage.json`.

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
│   ├── claude-usage-tracker.py      # parser dos JSONL (sem rede)
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
- Os **limites em tokens** não são divulgados oficialmente pela Anthropic; por
  isso são configuráveis e opcionais.

## 📄 Licença

MIT — veja [LICENSE](LICENSE).
# claudeUsageIndicator
