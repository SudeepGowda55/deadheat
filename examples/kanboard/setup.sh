#!/bin/sh
# Fetches Kanboard, starts it once, and seeds two users, one project and one task through its own API.
# Needs: git, php 8.1+ (brew install php), sqlite3, curl.
set -e
cd "$(dirname "$0")"
[ -d kanboard ] || git clone --quiet --depth 1 --branch v1.2.58 https://github.com/kanboard/kanboard.git
rm -f kanboard/data/db.sqlite seed.sqlite
# One process only: with workers, killing the server would leave them running on the port.
php -S 127.0.0.1:8000 -t kanboard >/dev/null 2>&1 &
server=$!
trap 'kill $server' EXIT
until curl -s -o /dev/null http://127.0.0.1:8000/; do sleep 0.3; done
token=$(sqlite3 kanboard/data/db.sqlite "select value from settings where option='api_token'")
rpc() { curl -s -u "jsonrpc:$token" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":$2}" http://127.0.0.1:8000/jsonrpc.php >/dev/null; }
rpc createUser '{"username":"manvith","password":"deadheat1","name":"Manvith","role":"app-admin"}'
rpc createUser '{"username":"sudeep","password":"deadheat1","name":"Sudeep","role":"app-admin"}'
rpc createProject '{"name":"Launch week"}'
rpc addProjectUser '{"project_id":1,"user_id":2,"role":"project-manager"}'
rpc addProjectUser '{"project_id":1,"user_id":3,"role":"project-manager"}'
rpc createTask '{"title":"Send the launch email","project_id":1,"description":"Draft is in the shared folder."}'
cp kanboard/data/db.sqlite seed.sqlite
echo "Kanboard is seeded. Run: deadheat race"
