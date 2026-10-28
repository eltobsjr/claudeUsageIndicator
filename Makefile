UUID = claude-usage@eltobsjr.gmail.com
EXT  = extension
DEST = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: all install uninstall enable disable schema check test pack clean

all: install

# Instala localmente (link + compila schema)
install: schema
	@rm -rf "$(DEST)"
	@mkdir -p "$(DEST)"
	@cp -r $(EXT)/. "$(DEST)/"
	@glib-compile-schemas "$(DEST)/schemas"
	@chmod +x "$(DEST)/claude-usage-tracker.py"
	@echo "Instalado em $(DEST)"

schema:
	@glib-compile-schemas $(EXT)/schemas

enable:
	@gnome-extensions enable $(UUID)

disable:
	@gnome-extensions disable $(UUID)

uninstall:
	@rm -rf "$(DEST)"
	@echo "Removido."

# Roda o tracker manualmente e imprime resumo
run:
	@python3 $(EXT)/claude-usage-tracker.py --print

# Checagem estática: sintaxe JS/Python/JSON, schema e o tema (todas as paletas e cores de destaque)
check:
	@d=$$(mktemp -d); for f in $$(find $(EXT) -name '*.js'); do \
		cp $$f $$d/x.mjs && node --check $$d/x.mjs || { rm -rf $$d; exit 1; }; done; rm -rf $$d
	@python3 -m py_compile scripts/eltob-setup.py && rm -rf scripts/__pycache__
	@python3 -c "import json; [json.load(open(f)) for f in ('$(EXT)/metadata.json','scripts/options.json','scripts/palettes.json')]"
	@if [ -d $(EXT)/schemas ]; then glib-compile-schemas --strict --dry-run $(EXT)/schemas; fi
	@d=$$(mktemp -d); for p in macchiato frappe mocha; do for a in blue mauve green red; do \
		python3 scripts/eltob-setup.py render --template $(EXT)/stylesheet.tpl.css --out $$d/s.css --palette $$p --accent $$a || exit 1; \
		! grep -q '{{' $$d/s.css || { echo "token sem valor ($$p/$$a)"; exit 1; }; done; done; rm -rf $$d
	@python3 scripts/eltob-setup.py contrast
	@echo "check ok"

# Gera o .zip só da extensão, com o tema padrão (Macchiato/azul) já renderizado
pack:
	@d=$$(mktemp -d); cp -r $(EXT)/. $$d/; rm -f $$d/schemas/gschemas.compiled; \
		python3 scripts/eltob-setup.py render --template $$d/stylesheet.tpl.css --out $$d/stylesheet.css --title "Claude Usage Indicator" && rm $$d/stylesheet.tpl.css; \
		rm -f $(UUID).shell-extension.zip; (cd $$d && zip -qr -FS "$(CURDIR)/$(UUID).shell-extension.zip" .); rm -rf $$d
	@echo "Pacote: $(UUID).shell-extension.zip"

clean:
	@rm -f $(UUID).shell-extension.zip $(EXT)/stylesheet.css $(EXT)/schemas/gschemas.compiled
	@find . -name '__pycache__' -type d -prune -exec rm -rf {} +
