umask 027
touch new.txt
chmod -R a=rX,u+w archive
stat -c '%a %n' new.txt archive archive/README
