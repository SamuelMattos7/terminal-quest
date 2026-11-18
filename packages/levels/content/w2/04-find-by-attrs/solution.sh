find ~/cache -type f -empty
find ~/cache -type f -mtime +7
find ~/cache -type f -empty -exec rm -- {} +
find ~/cache -type f -mtime +7 -exec rm -- {} +
