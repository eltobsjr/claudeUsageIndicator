# Eltob Indicator Design v1

Padrão visual e de código das extensões GNOME Shell da família *Indicator*
(Celular, Nitro, Claude Usage, Clip Vault, Game Launcher, WhatsApp Bridge).
O mesmo arquivo vive em `docs/DESIGN.md` de cada repositório.

## Paleta — escolhida na instalação (padrão: Catppuccin Macchiato, acento azul)

O `install.sh` oferece Macchiato, Frappé e Mocha e 12 cores de destaque (ou o destaque do GNOME 47+).
A tabela mostra os **papéis**; os hex abaixo são os do padrão. Nenhum hex existe no código das extensões:
`extension/stylesheet.tpl.css` usa tokens (`{{accent}}`, `{{surface0}}`…) e o instalador gera o `stylesheet.css`.

| Papel | Token | Hex |
|---|---|---|
| Fundo de popups, barra | `mantle` | `#1e2030` |
| Janelas | `base` | `#24273a` |
| Cartões, botões | `surface0` | `#363a4f` |
| Hover | `surface1` | `#494d64` |
| Texto | `text` | `#cad3f5` |
| Texto secundário | `subtext0` | `#a5adcb` |
| Texto desativado / dicas | `overlay1` | `#8087a2` |
| **Acento** | `blue` | `#8aadf4` (texto sobre ele: `base`) |
| Títulos de seção | `lavender` | `#b7bdf8` |
| Ok | `green` | `#a6da95` |
| Atenção | `yellow` | `#eed49f` |
| Erro | `red` | `#ed8796` |
| Dado extra (uso raro) | `mauve` | `#c6a0f6` |

Regras:

- Só estes tokens. Nada de cinza ou azul "quase igual".
- O acento é um só (azul). Estado usa ok/atenção/erro, nunca o acento.
- Fundos de estado usam o token com alfa 0,12 a 0,22; o texto usa o token cheio.
- Todo texto sobre `base`/`mantle` precisa de contraste ≥ 4,5 : 1 (os tokens acima passam).
- O destaque vem da escolha do usuário (ou do sistema, se ele pedir). Estado nunca usa o destaque.
- Só paletas escuras: os popups do GNOME Shell são escuros e o CSS só define o que é da extensão.

## Geometria

| Uso | Valor |
|---|---|
| Controles, entradas, botões pequenos | raio 8 px |
| Cartões, seções, botões grandes | raio 12 px |
| Popups e overlays | raio 16 px |
| Pílulas, barras de progresso | raio 100 px |
| Largura do menu | 340 px |
| Recuo horizontal | 14 px |

## Tipografia

Fonte do sistema. Tamanhos em `em`: título 1.1, texto 1.0, secundário 0.82–0.88,
pílulas e rótulos 0.72. Pesos: 500 corpo, 700 rótulos e títulos de seção, 800 títulos e
números em destaque. Números que mudam usam `font-feature-settings: "tnum"`.

## Componentes (prefixo da extensão: `cu-`, `cel-`, `nitro-`, `cv-`, `gl-`, `wab-`)

- `*-head`: avatar ou ícone, título (800) e subtítulo (`subtext0`), pílula de estado à direita.
- `*-pill`: texto 0.72em/700, raio 100, fundo do token a 0,18.
- `*-section`: fundo `surface0` a 0,45, raio 12, título de seção em `lavender`.
- `*-track` / `*-fill`: altura 6–8 px, raio 100, trilho `overlay1` a 0,22.
- `*-btn`: `surface0`, hover `surface1`, foco com anel de 2 px no acento.
- Botão principal: fundo acento, texto `base`, hover `lavender`.

## Código

- ESM (`export default class … extends Extension`), `enable()` e `disable()` simétricos.
- Nenhum timer, sinal ou subprocesso sobrevive ao `disable()`: use `connectObject`/`disconnectObject`,
  guarde todo `GLib.timeout_add*` e remova no `destroy()`.
- Sem polling com o menu fechado. Prefira sinais (GSettings, `Gio.NetworkMonitor`, D-Bus, `inotify`).
- Nada pesado no processo do gnome-shell: rede, disco lento e programas externos rodam em `Gio.Subprocess`
  assíncrono com `Cancellable` e timeout.
- Textos visíveis passam por `_()` e o `metadata.json` declara `gettext-domain`.
- Cores só no `stylesheet.tpl.css` (tokens); o JS aplica classes, nunca `set_style()` com cor nem hex.
- Hardware e nomes de produto vêm do sistema (DMI, `nvidia-smi`), nunca escritos no código.

## Repositório

`extension/` (código; `stylesheet.tpl.css`, nunca `stylesheet.css`), `scripts/` (`eltob-setup.py`, `palettes.json`, `options.json`), `docs/` (DESIGN.md, imagens), `tests/` quando houver backend, `Makefile` com
`install uninstall enable disable check test pack clean`, `install.sh`, `LICENSE`, `README.md`
com as seções Instalação, Uso, Configurações, Desenvolvimento, Licença.
`metadata.json` com `uuid name description version-name shell-version url` (e `settings-schema`/`gettext-domain`).
`CLAUDE.md`, `memory/` e pastas de notas pessoais ficam no `.gitignore`.
