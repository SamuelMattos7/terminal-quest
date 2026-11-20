sed -i -e 's/^PermitRootLogin yes/PermitRootLogin no/' \
  -e 's/^PasswordAuthentication yes/PasswordAuthentication no/' \
  -e 's/^KbdInteractiveAuthentication yes/KbdInteractiveAuthentication no/' \
  -e 's/^AuthenticationMethods any/AuthenticationMethods publickey/' sshd_config
chmod u-s ~/audit/health-tool.txt
chmod go-w ~/audit/queue.txt
scp -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes -i ~/.ssh/bootstrap sshd_config deploy@ssh.penguin.corp:hardening.conf
