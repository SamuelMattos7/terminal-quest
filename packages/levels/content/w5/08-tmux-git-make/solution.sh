tmux new-session -d -s ops
cd ~/workbench
git bisect start HEAD "$(git rev-list --max-parents=0 HEAD)"
git bisect run ./check.sh
tux submit "$(git rev-parse refs/bisect/bad)"
git bisect reset
cat > Makefile <<'MAKE'
build: dist/status.txt

dist/status.txt: src/status.txt
	mkdir -p dist
	cp -- $< $@
MAKE
make build
