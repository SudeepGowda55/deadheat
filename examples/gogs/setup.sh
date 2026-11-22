#!/bin/sh
# Fetches Gogs 0.14.4, configures it for local use, and seeds two users, one repository and one wiki page.
# Needs: git, curl, unzip. Checked on macOS arm64; the other release assets are picked by name only.
# Gogs must not already be running on port 3000.
set -e
cd "$(dirname "$0")"
# Gogs 0.14 calls git with options that older versions reject, which turns every second wiki edit into a 500.
git --version | awk '{ split($3, v, "."); if (v[1] < 2 || (v[1] == 2 && v[2] < 43)) { print "Gogs 0.14 needs git 2.43 or newer; this is " $3 ". On macOS: brew install git"; exit 1 } }'
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) asset=darwin_arm64 ;; Darwin-x86_64) asset=darwin_amd64 ;;
  Linux-x86_64) asset=linux_amd64 ;; Linux-aarch64) asset=linux_arm64 ;;
  *) echo "No Gogs build is known for this machine"; exit 1 ;;
esac
[ -x gogs/gogs ] || { curl -sL -o gogs.zip "https://github.com/gogs/gogs/releases/download/v0.14.4/gogs_v0.14.4_$asset.zip"; unzip -q gogs.zip; rm gogs.zip; }
rm -rf gogs/data gogs/repos gogs/custom gogs/log seed
mkdir -p gogs/custom/conf gogs/data gogs/repos
cat > gogs/custom/conf/app.ini <<INI
RUN_USER = $(whoami)
RUN_MODE = prod
[server]
HTTP_ADDR = 127.0.0.1
HTTP_PORT = 3000
DOMAIN = 127.0.0.1
EXTERNAL_URL = http://127.0.0.1:3000/
OFFLINE_MODE = true
DISABLE_SSH = true
[database]
TYPE = sqlite3
PATH = data/gogs.db
[repository]
ROOT = $PWD/gogs/repos
[security]
INSTALL_LOCK = true
SECRET_KEY = example-only-not-a-secret
[auth]
ENABLE_REGISTRATION_CAPTCHA = false
[log]
MODE = file
INI
cd gogs
./gogs web >/dev/null 2>&1 &
server=$!
trap 'kill $server 2>/dev/null' EXIT
until curl -s -o /dev/null http://127.0.0.1:3000/; do sleep 0.3; done
# Users are created after the first start: only the web server builds the full database.
./gogs admin create-user --name manvith --password deadheat1 --email manvith@example.com --admin >/dev/null
./gogs admin create-user --name sudeep --password deadheat1 --email sudeep@example.com >/dev/null
cd ..
# Everything below is done the way a browser would do it: sign in, then post each form with its token.
jar=$(mktemp)
token() { awk '$6 == "_csrf" { print $7 }' "$jar"; }
form() { path=$1; shift; curl -s -b "$jar" -c "$jar" -o /dev/null --data-urlencode "_csrf=$(token)" "$@" "http://127.0.0.1:3000$path"; }
curl -s -c "$jar" -o /dev/null http://127.0.0.1:3000/user/login
form /user/login -d user_name=manvith -d password=deadheat1
curl -s -b "$jar" -c "$jar" -o /dev/null http://127.0.0.1:3000/repo/create
form /repo/create -d user_id=1 -d repo_name=handbook -d auto_init=on -d readme=Default
form /manvith/handbook/settings/collaboration -d collaborator=sudeep
form /manvith/handbook/wiki/_new -d title=Home -d message=First+page --data-urlencode "content=Office hours are 9 to 5."
rm -f "$jar"
kill $server; wait $server 2>/dev/null || true
mkdir seed && cp -R gogs/data seed/data && cp -R gogs/repos seed/repos
echo "Gogs is seeded. Run: deadheat race"
