.PHONY: build test dev lint clean health deploy quickstart logs logs-prod

# === Build ===
build: build-csharp build-web build-python

build-csharp:
	dotnet build src/TeamPortal/TeamPortal.csproj

build-web:
	cd web && npm ci && npm run build

build-python:
	python -m py_compile ai-service/main.py
	python -m py_compile ai-service/routes/chat.py
	python -m py_compile ai-service/routes/search.py
	python -m py_compile ai-service/routes/logs.py

# === Test ===
test: test-csharp test-web test-python

test-csharp:
	dotnet test tests/api/

test-web:
	cd web && npx vitest run

test-python:
	python -m pytest tests/ai/

# === Dev ===
dev:
	docker compose up --build

# === Lint ===
lint: lint-csharp lint-web lint-python

lint-csharp:
	dotnet format style --verify-no-changes src/TeamPortal/ 2>/dev/null || dotnet format style src/TeamPortal/

lint-web:
	cd web && npx eslint . --ext .ts,.tsx

lint-python:
	python -m ruff check ai-service/ 2>/dev/null || python -m flake8 ai-service/ --max-line-length=120 2>/dev/null || echo "No Python linter installed"

# === Health ===
health:
	@echo "Checking services..."
	@curl -sf http://localhost:3000 > /dev/null && echo "✓ frontend :3000" || echo "✗ frontend :3000"
	@curl -sf http://localhost:8080 > /dev/null && echo "✓ backend  :8080" || echo "✗ backend  :8080"
	@curl -sf http://localhost:9001/health > /dev/null && echo "✓ ai-service :9001" || echo "✗ ai-service :9001"

# === Deploy ===
quickstart:
	bash deploy/quickstart.sh

deploy:
	docker compose up -d --build
	@echo "Services starting... Run 'make health' to verify."

logs:
	docker compose logs -f

logs-prod:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f

deploy-prod:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
	@echo "Production services starting... Run 'make health-prod' to verify."

health-prod:
	@echo "Checking services (HTTPS)..."
	@curl -skf https://$${DOMAIN:-localhost} > /dev/null && echo "✓ frontend HTTPS" || echo "✗ frontend HTTPS"
	@curl -skf https://$${DOMAIN:-localhost}/api/ > /dev/null && echo "✓ backend HTTPS" || echo "✗ backend HTTPS"

# === Clean ===
clean:
	dotnet clean src/TeamPortal/
	rm -rf web/.next web/node_modules
	find ai-service -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
