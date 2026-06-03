#!/usr/bin/env bash
# Instalador do Claude Usage Indicator (extensão GNOME Shell)
set -euo pipefail

UUID="claude-usage@eltobsjr.gmail.com"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/extension"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

echo "==> Instalando Claude Usage Indicator"

# 1) checa dependências
if ! command -v python3 >/dev/null 2>&1; then
    echo "ERRO: python3 não encontrado. Instale com: sudo dnf install python3" >&2
    exit 1
fi
if ! command -v glib-compile-schemas >/dev/null 2>&1; then
    echo "ERRO: glib-compile-schemas não encontrado. Instale glib2-devel / libglib2.0-bin." >&2
    exit 1
fi

# 2) copia arquivos
echo "==> Copiando para $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -r "$SRC/." "$DEST/"

# 3) compila o schema
echo "==> Compilando GSettings schema"
glib-compile-schemas "$DEST/schemas"

# 4) torna o tracker executável
chmod +x "$DEST/claude-usage-tracker.py"

# 5) primeira coleta
echo "==> Gerando dados iniciais"
python3 "$DEST/claude-usage-tracker.py" || true

echo ""
echo "✅ Instalado!"
echo ""
echo "Agora ative a extensão:"
echo "  • Wayland: faça logout/login e rode  gnome-extensions enable $UUID"
echo "  • X11:     pressione Alt+F2, digite 'r', Enter, depois ative"
echo ""
echo "Ou use:  gnome-extensions enable $UUID"
