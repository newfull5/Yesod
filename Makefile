.PHONY: build dev test

build: ## build frontend, embed it, produce ./yesod binary
	cd web && npm run build
	touch web/dist/.gitkeep
	go build -o yesod .

dev: ## run Go API (:8080) and Vite dev server (:5173, proxies /api)
	(trap 'kill 0' EXIT; go run . & cd web && npm run dev)

test:
	go test ./...
