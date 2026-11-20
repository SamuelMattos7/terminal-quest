tmux new-session -d -s ops
cd ~/workbench
tux submit "$(git rev-parse HEAD)"
cat > Makefile <<'MAKE'
build: dist/status.txt

dist/status.txt: src/status.txt
	mkdir -p dist
	cp -- $< $@
MAKE
make build
