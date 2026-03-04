# orchestro

minimalist container deployment for people who want stuff to just work.

### local
git clone https://github.com/timuzkas/orchestro.git
docker-compose up --build
open http://localhost:3000

### vps
you need docker and a reverse proxy.

1. copy docker-compose.example.yml to docker-compose.yml.
2. set your public api domain in NEXT_PUBLIC_API_URL.
3. set API_USER and API_PASS for basic auth.
4. run docker-compose up -d.

#### api via systemd
if you want to run the api directly on the host (recommended for docker socket access):
1. build it: `cd api && go build -o main .`
2. edit `orchestro-api.service` with your paths/user.
3. `sudo cp orchestro-api.service /etc/systemd/system/`
4. `sudo systemctl enable --now orchestro-api`

### things to know
- logs need websockets. if using cloudflare, turn them on in the dashboard.
- volumes need absolute paths (e.g. /home/ubuntu/data).
- backups and data management are in beta.

mit license.
