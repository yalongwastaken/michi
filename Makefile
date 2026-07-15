# Michi — task runner for the two-package repo (client + server).
# Requires Node >= 22.12 and npm. Run `make` or `make help` for the list.

.DEFAULT_GOAL := help
.PHONY: help install dev server client build start test test-server test-client test-smoke format lint clean distclean backup sample seed

## help: list the available targets
help:
	@echo "Michi — make targets:"
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## /  /'

## install: install dependencies (root tooling + client + server)
install:
	npm install
	cd server && npm install
	cd client && npm install

## dev: run backend (:4001) and frontend (:5174) together, hot-reloading
dev:
	@echo "Starting server (:4001) + client (:5174) — Ctrl-C to stop both"
	@trap 'kill 0' INT TERM; \
	( cd server && npm run dev ) & \
	( cd client && npm run dev ) & \
	wait

## server: run only the backend API (dev, hot-reload) on :4001
server:
	cd server && npm run dev

## client: run only the frontend (Vite dev server) on :5174
client:
	cd client && npm run dev

## build: build the client into client/dist (served by the backend in prod)
build:
	cd client && npm run build

## start: production mode — build the client, then serve everything from :4001
start: build
	cd server && npm start

## test: run all unit tests + the render smoke (server + client)
test: test-server test-client test-smoke

## test-server: run the engine / db / planner / insights / suggest unit tests
test-server:
	cd server && npm test

## test-client: run the client lib unit tests
test-client:
	cd client && npm test

## test-smoke: headless render walk-through of the whole UI
test-smoke:
	cd client && npm run test:smoke

## format: auto-format the whole repo with Prettier
format:
	npm run format

## lint: lint the whole repo with ESLint (use `npm run lint:fix` to auto-fix)
lint:
	npm run lint

## backup: WAL-safe snapshot of the SQLite database into ./backups (timestamped, keeps last 14)
backup:
	@mkdir -p backups
	node --experimental-sqlite server/backup.js backups/michi-$$(date +%F).db
	@ls -1t backups/michi-*.db 2>/dev/null | tail -n +15 | xargs -r rm -f
	@echo "backed up → backups/michi-$$(date +%F).db (keeping the 14 most recent)"

## sample: regenerate samples/sample-profile.json (import it via Settings → Import)
sample:
	node server/scripts/seed-sample.js
	@echo "→ samples/sample-profile.json — import it from Settings → Import (or on your phone)"

## seed: RESET the database and load the sample profile (destroys existing data)
seed:
	node --experimental-sqlite server/scripts/seed-sample.js --db

## clean: remove build output and temp files (keeps node_modules + data)
clean:
	rm -rf client/dist client/test/.tmp
	rm -f client/vite.config.js.timestamp-*.mjs

## distclean: clean + remove all installed dependencies
distclean: clean
	rm -rf client/node_modules server/node_modules node_modules
