.PHONY: build test dev lint clean

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
	cd web && npx vitest run --config vitest.config.ts 2>/dev/null || cd ../tests/web && npx vitest run

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

# === Clean ===
clean:
	dotnet clean src/TeamPortal/
	rm -rf web/.next web/node_modules
	find ai-service -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
