.PHONY: dev start test format lint clean check run-portless setup

setup:
	@echo "Setting up environment..."
	cd backend && uv sync
	cd frontend && pnpm install

dev:
	concurrently "cd backend && uv run uvicorn main:app --host 127.0.0.1 --port 8126" "cd frontend && pnpm dev --port 3126"

start:
	concurrently "cd backend && uv run uvicorn main:app --host 127.0.0.1 --port 8126" "cd frontend && pnpm start --port 3126"

test:
	cd backend && uv run pytest
	cd evals && uv run python run_evals.py

format:
	cd backend && ruff format .
	cd frontend && biome format --write .

lint:
	cd backend && ruff check .
	cd frontend && biome lint .

clean:
	rm -rf backend/.venv frontend/.next frontend/node_modules backend/__pycache__ backend/.pytest_cache
	find . -type d -name "__pycache__" -exec rm -r {} +

check: format lint test

run-portless:
	portless run
