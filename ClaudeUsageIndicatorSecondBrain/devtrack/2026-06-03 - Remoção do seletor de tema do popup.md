# 2026-06-03 — Remoção do seletor de tema do popup

## O que foi feito

O seletor de tema ("Tema: Sistema >") que estava visível no popup da extensão foi removido. A configuração de tema agora fica exclusivamente em **Preferências > Exibição > Tema de cores**, que já existia e estava funcional.

A decisão foi tomada porque o popup deve ser uma visualização de consumo, não um painel de configuração. Ter o seletor em dois lugares gerava redundância e poluía a interface principal.

---

## Arquivos modificados

| Arquivo | Mudança |
|---|---|
| `extension/extension.js` | Removido bloco do `PopupSubMenuMenuItem` de tema (linhas com `_temaMenu`, `_temaItems`, loop de itens) e o método `_updateTemaMenu` junto com sua chamada em `_applyTheme` |

## Status

- [x] Seletor de tema removido do popup
- [x] Seletor mantido apenas em Preferências > Exibição
- [ ] Relogar no Wayland para aplicar a mudança na extensão instalada
