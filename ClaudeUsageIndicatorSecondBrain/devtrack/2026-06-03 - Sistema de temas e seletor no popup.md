# 2026-06-03 — Sistema de temas e seletor no popup

## O que foi feito

### 1. Cor do sistema identificada e aplicada

Investigado o arquivo de modificações Fedora em `modificaçoesfedora/2026-06-01.md` para identificar a cor padrão do sistema do usuário. A cor escolhida (paleta "Safira E") é `#163570` — usada no Open Bar tanto para a barra superior (`iscolor`) quanto para os cards ativos (`mscolor`) e dock.

Primeira abordagem: classe utilitária `cu-sys-blue` diretamente nas barras de Hoje e Semana. Substituída pela arquitetura de temas na iteração seguinte.

### 2. Sistema de temas configurável (5 temas)

Implementado suporte a temas de cor com 5 opções, controlado por GSettings (`color-theme`). Cada tema define a cor das barras de progresso (estado ok) e dos rótulos de seção. Estados especiais (warn/crit) continuam amarelo/vermelho em todos os temas via especificidade CSS.

| Tema | Cor da barra | Rótulo |
|---|---|---|
| Automático | `-st-accent-color` (acento GNOME) | padrão |
| Sistema · Fedora Navy | `#163570` | `#6ba3d9` |
| Catppuccin Macchiato | `#8aadf4` | `#8aadf4` |
| Verde GNOME | `#26a269` | `#57e389` |
| Laranja Ubuntu | `#e95420` | `#ff9a6c` |

Barras de tempo (sem limite configurado) usam versão semi-transparente da cor do tema via seletor de 3 classes (especificidade superior ao `.cu-time` genérico).

### 3. Seletor de tema no popup

Adicionado submenu `PopupSubMenuMenuItem` "Tema: X" diretamente no popup, entre os modelos e as ações. Clicar num tema aplica imediatamente via GSettings — sem precisar abrir Preferências. A seleção ativa exibe checkmark (`Ornament.CHECK`). O label do submenu atualiza para "Tema: Sistema", "Tema: Catppuccin" etc. ao mudar.

### 4. Seletor também em Preferências

`ComboRow` adicionado na página Exibição das Preferências (libadwaita), ligado ao mesmo GSettings `color-theme`. As duas interfaces (popup e prefs) ficam em sincronia automaticamente.

### 5. Remote SSH

Remote do repositório migrado de HTTPS para SSH (`git@github.com:eltobsjr/claudeUsageIndicator.git`) para habilitar push sem senha.

---

## Arquivos modificados

| Arquivo | Mudança |
|---|---|
| `extension/stylesheet.css` | Removida classe temporária `cu-sys-blue`; adicionados seletores de tema `cu-tema-X`, barras de tempo temáticas e rótulos coloridos |
| `extension/extension.js` | `MetricRow.setTheme()` aplica/remove classe de tema; `ClaudeIndicator._applyTheme()` e `_updateTemaMenu()`; submenu `_temaMenu` com `_temaItems` e ornamentos |
| `extension/prefs.js` | `ComboRow` de tema na página Exibição |
| `extension/schemas/org.gnome.shell.extensions.claude-usage.gschema.xml` | Enum `color-theme` e chave correspondente com default `'auto'` |

## Decisões técnicas

### Cascata CSS para temas vs estados

**Contexto:** ao aplicar uma classe de tema (`cu-tema-sistema`) e uma classe de estado (`cu-warn`) no mesmo elemento, qual cor vence?

**Decisão:** temas definidos ANTES de warn/crit/time no CSS (mesma especificidade 0,2,0 → último definido ganha). Assim warn/crit sempre vencem o tema. Para barras de tempo temáticas, usa-se seletor de 3 classes (`.cu-tema-X.cu-time`, especificidade 0,3,0) que vence o `.cu-time` genérico sem interferir com warn/crit.

### Classe de tema no fill, não no container

**Alternativa descartada:** aplicar classe no container do popup e usar seletor descendente (`.cu-tema-sistema .cu-bar-fill`). Problemático por conflitos de especificidade.

**Decisão:** aplicar a classe diretamente no `_fill` (St.Widget) e no `_label` (St.Label) de cada row. Mais previsível e sem surpresas de herança.

## Status

- [x] Cor `#163570` aplicada nas barras de Hoje e Semana
- [x] Rótulos de seção coloridos junto com as barras
- [x] 5 temas implementados com CSS correto
- [x] Seletor de tema no popup com checkmark
- [x] Seletor de tema nas Preferências
- [x] Commits e push para GitHub via SSH
- [ ] Ativar no Wayland (relogar + `gnome-extensions enable claude-usage@eltobsjr.gmail.com`)
- [ ] Screenshot em `docs/screenshot.png`

## Próximos passos

1. Fazer logout/login para carregar a versão nova no Wayland e testar o seletor de tema no popup
2. Tirar screenshot com o tema Sistema ativo e salvar em `docs/screenshot.png`
