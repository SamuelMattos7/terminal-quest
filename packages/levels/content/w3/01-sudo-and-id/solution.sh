id
sudo -l
code=$(sudo cat /root/access-code.txt)
tux submit "$code"
