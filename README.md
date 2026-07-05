# Yesod (יסוד)

Ultra-light self-hosted issue tracker for a single user.

<p align="center">
  <img src="assets/yesod_logo_512x512.png" alt="Yesod logo" width="320" />
</p>

## Run

```bash
git clone https://github.com/newfull5/Yesod.git
cd Yesod
docker compose up -d
```

Open `http://localhost:8080`.

Data is stored in `./data/yesod.db`.

## Settings

Set a password:

```bash
YESOD_PASSWORD='change-me' docker compose up -d
```

Use a custom database path when running the binary directly:

```bash
YESOD_DB=./data/yesod.db ./yesod
```

## Local Development

```bash
cd web && npm install && cd ..
make dev
```

The app runs at `http://localhost:5173` and proxies API requests to `:8080`.

## Build

```bash
make build
./yesod
```

## License

MIT

## Citation

```bibtex
@software{yesod,
  title = {Yesod},
  author = {Saechan Oh},
  year = {2026},
  url = {https://github.com/newfull5/Yesod},
  license = {MIT}
}
```
