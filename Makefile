COMPOSE := docker compose
SERVICE := auvtt
IMAGE := auvtt:local

.PHONY: help dev dev-lan preview preview-lan test build docker-build docker-up docker-down docker-restart docker-logs docker-ps docker-shell docker-test docker-prune

help:
	@echo "Targets:"
	@echo "  make dev            Run local dev server (localhost only)"
	@echo "  make dev-lan        Run local dev server on LAN"
	@echo "  make preview        Run local production preview (localhost only)"
	@echo "  make preview-lan    Run local production preview on LAN"
	@echo "  make test           Run test suite locally"
	@echo "  make build          Build app locally"
	@echo "  make docker-build   Build the Docker image"
	@echo "  make docker-up      Start AuVTT in Docker (detached)"
	@echo "  make docker-down    Stop and remove container"
	@echo "  make docker-restart Restart service"
	@echo "  make docker-logs    Tail container logs"
	@echo "  make docker-ps      Show service status"
	@echo "  make docker-shell   Open shell in running container"
	@echo "  make docker-test    Run test suite in container"
	@echo "  make docker-prune   Remove local image"

dev:
	npm run dev

dev-lan:
	npm run dev:lan

preview:
	npm run preview

preview-lan:
	npm run preview:lan

test:
	npm test

build:
	npm run build

docker-build:
	$(COMPOSE) build $(SERVICE)

docker-up:
	$(COMPOSE) up -d $(SERVICE)

docker-down:
	$(COMPOSE) down

docker-restart:
	$(COMPOSE) restart $(SERVICE)

docker-logs:
	$(COMPOSE) logs -f $(SERVICE)

docker-ps:
	$(COMPOSE) ps

docker-shell:
	$(COMPOSE) exec $(SERVICE) sh

docker-test:
	$(COMPOSE) run --rm $(SERVICE) npm test

docker-prune:
	docker image rm -f $(IMAGE) || true
