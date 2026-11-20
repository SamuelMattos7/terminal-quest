sed -i 's/^PasswordAuthentication yes/PasswordAuthentication no/' sshd_config
chmod u-s ~/audit/health-tool.txt
chmod go-w ~/audit/queue.txt
scp -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes -i ~/.ssh/bootstrap sshd_config deploy@ssh.penguin.corp:hardening.conf
