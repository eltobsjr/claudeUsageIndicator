# Claude Usage Indicator

Uma extensão do **GNOME Shell** que mostra o uso do **Claude Code** em tempo
real na barra superior: porcentagem da janela de sessão de 5h e do limite
semanal, com countdown até o reset. Ao clicar, abre um painel com os detalhes.

> **Mesma fonte que o `/usage` do Claude Code.** Lê os percentuais de uso direto
> do claude.ai (`GET /api/oauth/usage`) usando o token OAuth que o Claude Code já
> guarda em `~/.claude/.credentials.json`. Esse endpoint só devolve estatísticas
> de uso — **não consome tokens**.

---

## Formatos do label na barra superior

Escolha o formato que prefere nas preferências da extensão:

| Formato | Preview |
|---|---|
| **Completo** — percentual + countdown | ![topbar completo](docs/topbar-complete.png) |
| **Compacto** — só percentual | ![topbar compacto](docs/topbar-compact.png) |
| **Barras** — ícones de progresso | ![topbar barras](docs/topbar-bars.png) |

---

## Preferências

<table>
<tr>
<td><b>Exibição</b> — tema, formato do label, posição na barra, ícone, intervalo</td>
<td><b>Uso</b> — dados em tempo real via OAuth</td>
<td><b>Sobre</b></td>
</tr>
<tr>
<td><img src="docs/prefs-display.png" width="200"/></td>
<td><img src="docs/prefs-usage.png" width="200"/></td>
<td><img src="docs/prefs-about.png" width="200"/></td>
</tr>
</table>

---

## Posição na barra

O seletor de posição exibe uma mini barra interativa mostrando exatamente onde o
indicador ficará antes de confirmar a escolha:

![Seletor de posição](docs/prefs-display.png)

| Opção | Resultado na barra |
|---|---|
| **Borda esquerda** | ![topbar borda esquerda](docs/topbar-position-left-edge.png) |
| **Esquerda** | ![topbar esquerda](docs/topbar-position-left.png) |
| **Direita** | Imediatamente à esquerda dos ícones nativos (volume, rede, bateria, menu) |

> Os ícones nativos do GNOME ficam sempre fixos na direita — extensões não podem
> ultrapassá-los. A opção **Direita** coloca o indicador logo à esquerda deles.

A posição é aplicada ao vivo ao mudar — sem precisar reiniciar a extensão.

---

## Temas de cores

As barras de progresso e os rótulos se adaptam ao tema escolhido:

| Tema | Cor principal | Indicado para |
|---|---|---|
| **Automático** | `accent color` do sistema (GNOME 47+) | Qualquer distro |
| **Sistema — Fedora Navy** | `#163570` (azul marinho) | Fedora / GNOME padrão |
| **Catppuccin Macchiato** | `#8aadf4` (azul suave) | Catppuccin |
| **Verde GNOME** | `#26a269` (verde) | GNOME verde |
| **Laranja Ubuntu** | `#e95420` (laranja) | Ubuntu |

---

## Recursos

- **Painel compacto** na barra superior com o percentual real de uso (S/W) —
  sessão de 5h · semana — e countdown até o reset.
- **Dados reais da Anthropic**: % de uso, severidade e horários de reset lidos
  direto do claude.ai via OAuth, sem precisar configurar nada.
- **Popup detalhado** com a sessão de 5h e o limite semanal (mais o limite
  semanal de Opus, nos planos Max).
- **Barras de progresso** que mudam de cor (verde → amarelo → vermelho)
  seguindo a severidade reportada pela própria Anthropic.
- **Plano detectado automaticamente** (Pro / Max) a partir das credenciais OAuth.
- **Resiliente a rate-limit**: a chamada à API é cacheada e com back-off, então
  o indicador nunca mostra valor inventado — só dado real ou "—".

---

## Requisitos

- GNOME Shell 45–50
- `python3`
- Claude Code instalado e em uso (é a fonte dos dados)

---

## Instalação

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

---

## Configuração

Abra as preferências em:

```bash
gnome-extensions prefs claude-usage@eltobsjr.gmail.com
```

Ou pelo menu da extensão → **Preferências**.

- **Exibição** — tema de cores, formato do label, mostrar/ocultar ícone, intervalo de
  atualização. A posição na barra usa um seletor visual com preview interativo da mini barra.
- **Uso** — informativo: os dados de plano e % de uso vêm automaticamente das
  credenciais OAuth do Claude Code, sem configuração manual.

---

## Como funciona

A extensão dispara um pequeno script Python (`claude-usage-tracker.py`) que:

1. Lê o token OAuth de `~/.claude/.credentials.json`,
2. Consulta **% de uso, severidade e horários de reset** via
   `GET /api/oauth/usage` do claude.ai (endpoint de estatísticas — não consome
   tokens),
3. **Cacheia** a resposta e respeita o `retry-after` do rate-limit, servindo o
   último valor bom (marcado como desatualizado) em caso de falha,
4. Grava um resumo em `~/.local/share/claude-usage/usage.json`.

A extensão lê esse JSON e desenha a interface. O intervalo de atualização da UI
é independente da chamada HTTP real — você pode atualizar a tela com frequência
sem martelar a API.

Você também pode usar o tracker sozinho, sem a extensão:

```bash
python3 extension/claude-usage-tracker.py --print
python3 extension/claude-usage-tracker.py --watch 30   # loop a cada 30s
```

---

## Estrutura

```
claude-usage-indicator/
├── extension/
│   ├── extension.js                 # UI do painel + popup
│   ├── prefs.js                     # preferências (libadwaita)
│   ├── metadata.json
│   ├── stylesheet.css               # estilo adaptável ao tema
│   ├── claude-usage-tracker.py      # consulta OAuth + cache/back-off
│   ├── icons/claude-symbolic.svg
│   └── schemas/*.gschema.xml
├── docs/                            # screenshots
├── install.sh
├── Makefile
├── LICENSE
└── README.md
```

---

## Notas

- A **% de uso** da sessão e da semana vem diretamente da Anthropic via OAuth —
  é o mesmo número que o comando `/usage` do Claude Code mostra.
- O endpoint `/api/oauth/usage` é interno do Claude Code e **não é documentado**;
  pode mudar sem aviso. Se isso acontecer, o indicador mostra "—" em vez de erro.

---

## Licença

MIT — veja [LICENSE](LICENSE).
