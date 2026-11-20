sudo useradd -m deploy
sudo install -d -o deploy -g deploy -m 750 /srv/engine
sudo chmod 755 /srv/engine
sudo dpkg -i ~/penguin-inspect.deb
nohup python3 -m http.server 8080 --bind 127.0.0.1 --directory ~/status-site >server.log 2>&1 &
for attempt in {1..15}; do curl -fsS http://127.0.0.1:8080/health.txt && break; sleep .05; done
ssh-keygen -q -t ed25519 -N '' -f ~/.ssh/id_ed25519
ssh-copy-id -f -i ~/.ssh/id_ed25519.pub -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes -o IdentityFile="$HOME/.ssh/bootstrap" deploy@ssh.penguin.corp
scp -o IdentitiesOnly=yes -i ~/.ssh/id_ed25519 handoff.txt deploy@ssh.penguin.corp:handoff.txt
